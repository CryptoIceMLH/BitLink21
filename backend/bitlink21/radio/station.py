"""Ground station: profile -> beacon lock + HSModem RX/TX on one SDR stream.

Runs inside the SDR worker process. Feed it every RX buffer with
``process(iq)``; it returns a list of events (dicts) for the main process:

    {"type": "bitlink21_status", ...}      ~2 per second
    {"type": "bitlink21_frame", ...}       every decoded HSModem frame
    {"type": "bitlink21_file", ...}        every completed file
    {"type": "bitlink21_align", ...}       ~10 per second while dish alignment runs
"""

import base64
import time
from typing import List, Optional

import numpy as np

from . import envelope, filetransfer, framing
from .alignment import TRANSPONDER_RF_HZ, AlignmentMeter, TransponderRise
from .beacon import BeaconTracker
from .demodulator import HsModemReceiver
from .modes import get_mode
from . import hyperlink
from .modulator import ModulatorStream, ResampledStream, modulate_blocks
from .profile import SatelliteProfile, make_plan
from .viewer import SpectrumView, Vfo, rf_mapping

STATUS_INTERVAL_S = 0.5
# How far from nominal the beacon is searched. The user's LNB error ranged
# -4..-25.5 kHz; at +-25 kHz the true line fell outside the search and the
# tracker locked a side line 400 Hz inside it (live, 2026-10-10).
BEACON_SPAN_HZ = 40000.0


class Station:
    def __init__(self, profile: SatelliteProfile, fs: float, beacon_seed_hz: Optional[float] = None,
                 centre_if_hz: Optional[float] = None):
        self.profile = profile
        self.fs = float(fs)
        self.plan = make_plan(profile, centre_if_hz=centre_if_hz)
        self.receiver = self._make_receiver(profile, self.plan)
        self.beacon: Optional[BeaconTracker] = None
        if profile.beacon_lock:
            self.beacon = BeaconTracker(self.fs, self.plan.beacon_offset_hz, kind=profile.beacon_kind,
                                        span_hz=BEACON_SPAN_HZ)
        self.files = filetransfer.FileReceiver()
        self.correction_hz = 0.0
        self.align: Optional[AlignmentMeter] = None  # dish alignment meter, only while asked for
        self._align_until = 0.0
        self._rise: Optional[TransponderRise] = None
        # Radio page (spectrum + VFO audio), only while asked for
        self.view: Optional[SpectrumView] = None
        self.vfo: Optional[Vfo] = None
        self._vfo_rf_hz: Optional[float] = None
        self._radio_until = 0.0
        self._last_status = 0.0
        self._events: List[dict] = []
        if self.beacon is not None and beacon_seed_hz is not None:
            # Restarted: carry on from the last beacon lock instead of searching
            self.beacon.seed(beacon_seed_hz)
            self.correction_hz = float(beacon_seed_hz)
            self.receiver.set_nominal(self.plan.rx_channel_offset_hz + self.correction_hz)

    def _make_receiver(self, profile: SatelliteProfile, plan):
        if profile.rx_mode == hyperlink.HYPERLINK_MODE:
            return hyperlink.HyperLinkReceiver(self.fs, plan.rx_channel_offset_hz)
        return HsModemReceiver(self.fs, get_mode(profile.rx_mode), plan.rx_channel_offset_hz, profile.search_span_hz)

    @property
    def hyperlink(self) -> bool:
        return isinstance(self.receiver, hyperlink.HyperLinkReceiver)

    def retune(self, profile: SatelliteProfile) -> bool:
        """New channel / speed with the SDR left where it is: only the modem
        retunes; the beacon tracker keeps its lock. Returns False when the new
        channel does not fit the current SDR tuning (a restart is needed)."""
        plan = make_plan(profile, centre_if_hz=self.plan.rx_center_if_hz)
        usable = 0.4 * self.fs
        if (profile.sample_rate_hz != self.profile.sample_rate_hz or profile.beacon_lock != self.profile.beacon_lock
                or profile.lnb_lo_hz != self.profile.lnb_lo_hz or profile.beacon_rf_hz != self.profile.beacon_rf_hz
                or abs(plan.rx_channel_offset_hz) > usable or plan.warnings
                or abs(plan.rx_channel_offset_hz - profile.rx_correction_hz) < 20e3):  # DC spur
            return False
        self.profile, self.plan = profile, plan
        self.receiver = self._make_receiver(profile, plan)
        self.receiver.set_nominal(plan.rx_channel_offset_hz + self.correction_hz)
        if self.beacon is not None and abs(self.beacon.nominal_offset_hz - plan.beacon_offset_hz) > 0.5:
            self.beacon.retarget(plan.beacon_offset_hz)  # rx_correction changed
        self.files = filetransfer.FileReceiver()
        return True

    # ------------------------------------------------------------------ RX

    def process(self, iq: np.ndarray) -> List[dict]:
        self._events = []
        if self.beacon is not None and self.beacon.process(iq):
            if self.beacon.locked and self.beacon.offset_hz is not None:
                self.correction_hz = self.beacon.offset_hz
                self.receiver.set_nominal(self.plan.rx_channel_offset_hz + self.correction_hz)
            self.receiver.drift_hz_s = self.beacon.rate_hz_s if self.beacon.locked else 0.0

        if self.hyperlink:
            for name, data in self.receiver.process(iq):
                self._emit_file(name, framing.TYPE_BINARY_FILE, 0, data)
        else:
            for frame in self.receiver.process(iq):
                self._on_frame(frame)

        now = time.time()
        if self.align is not None:
            if now > self._align_until:
                self.align = None  # the alignment page stopped asking
                self._rise = None
            else:
                self._run_align(iq)
        if self.view is not None:
            if now > self._radio_until:
                self.view = self.vfo = None  # the radio page stopped asking
            else:
                self._run_radio(iq)
        if now - self._last_status >= STATUS_INTERVAL_S:
            self._last_status = now
            self._events.append(self.status_event())
        return self._events

    def keep_align(self, seconds: float) -> None:
        """Run the dish alignment meter for the next `seconds` (renewed by the
        alignment page while it is open; stops by itself afterwards)."""
        self._align_until = time.time() + float(seconds)
        if self.align is None:
            self.align = AlignmentMeter(self.fs, self._beacon_position())
            self._rise = TransponderRise(self.fs)

    # ------------------------------------------------------------ radio page

    def rf_mapping(self):
        """(RF at baseband 0, +-1): true RF of any point in the window."""
        return rf_mapping(self.profile, self.plan, self.correction_hz)

    def baseband_of_rf(self, rf_hz: float) -> float:
        rf0, sign = self.rf_mapping()
        return (rf_hz - rf0) * sign

    def keep_radio(self, seconds: float, zoom_rf_hz: Optional[float] = None, zoom_span_hz: Optional[float] = None,
                   vfo_rf_hz: Optional[float] = None, vfo_mode: str = "usb") -> None:
        """Run the radio page's spectrum (and VFO audio when ``vfo_rf_hz`` is
        given) for the next ``seconds``; renewed by the page while open. The
        SDR is never retuned from here."""
        self._radio_until = time.time() + float(seconds)
        if self.view is None:
            self.view = SpectrumView(self.fs)
        centre = self.baseband_of_rf(zoom_rf_hz) if zoom_rf_hz else 0.0
        self.view.set_zoom(centre, float(zoom_span_hz) if zoom_span_hz else None)
        self._vfo_rf_hz = float(vfo_rf_hz) if vfo_rf_hz else None
        if self._vfo_rf_hz is None:
            self.vfo = None
        elif self.vfo is None:
            self.vfo = Vfo(self.fs, self.baseband_of_rf(self._vfo_rf_hz), vfo_mode)
        else:
            self.vfo.set_mode(vfo_mode)

    def _run_radio(self, iq: np.ndarray) -> None:
        if self.vfo is not None:
            self.vfo.set_offset(self.baseband_of_rf(self._vfo_rf_hz))  # follows the LNB drift
            audio = self.vfo.process(iq)
            if len(audio):
                self._events.append({
                    "type": "bitlink21_audio",
                    "rate": self.vfo.rate,
                    "pcm_b64": base64.b64encode((audio * 32767).astype("<i2").tobytes()).decode("ascii"),
                })
        frame = self.view.process(iq)
        if frame is None:
            return
        rf0, sign = self.rf_mapping()
        b = self.beacon
        frame["bins_b64"] = base64.b64encode(frame.pop("bins")).decode("ascii")
        frame.update({
            "type": "bitlink21_spectrum",
            "timestamp": time.time(),
            "rf_centre_hz": rf0 + sign * frame["centre_offset_hz"],
            "rf_sign": sign,
            "window_rf_hz": sorted([rf0 - self.fs / 2, rf0 + self.fs / 2]),
            "sample_rate": self.fs,
            "beacon_rf_hz": self.profile.beacon_rf_hz,
            "beacon_locked": bool(b is not None and b.locked),
            "channel_rf_hz": self.plan.rx_channel_rf_hz,
            "transponder_rf_hz": list(TRANSPONDER_RF_HZ),
            "vfo_rf_hz": self._vfo_rf_hz,
        })
        self._events.append(frame)

    def _beacon_position(self) -> float:
        b = self.beacon
        if b is not None and b.offset_hz is not None:
            return self.plan.beacon_offset_hz + b.offset_hz
        if b is not None and b.raw_offset_hz is not None:
            return self.plan.beacon_offset_hz + b.raw_offset_hz
        return self.plan.beacon_offset_hz + self.correction_hz

    def _run_align(self, iq: np.ndarray) -> None:
        self.align.set_centre(self._beacon_position())
        lo, hi = (self.baseband_of_rf(f) for f in TRANSPONDER_RF_HZ)
        rise = self._rise.process(iq, lo, hi) if self._rise is not None else None
        reading = self.align.process(iq, self.fs)
        if reading is None:
            return
        reading["transponder_rise_db"] = None if rise is None else round(rise, 2)
        b = self.beacon
        reading.update({
            "type": "bitlink21_align",
            "timestamp": time.time(),
            "beacon_state": "locked" if b is not None and b.locked else
                            ("found" if b is not None and b.raw_offset_hz is not None else "searching"),
            "lnb_error_hz": None if b is None or b.offset_hz is None else round(float(b.offset_hz), 1),
        })
        self._events.append(reading)

    def status_event(self) -> dict:
        rx = self.receiver.status()
        rx["constellation"] = self.receiver.constellation
        return {
            "type": "bitlink21_status",
            "timestamp": time.time(),
            "profile": self.profile.name,
            "plan": self.plan.to_dict(),
            "correction_hz": round(float(self.correction_hz), 1),
            "beacon": self.beacon.status() if self.beacon else None,
            "modem": rx,
            "file_progress": self.files.progress(),
            "channel": self.channel_status(),
        }

    def channel_status(self) -> dict:
        level = self.receiver.channel_occupancy_db()
        return {"level_db": level,
                "busy": level is not None and level >= self.receiver.BUSY_SNR_DB}

    def _on_frame(self, frame: framing.Frame) -> None:
        self._events.append({
            "type": "bitlink21_frame",
            "timestamp": time.time(),
            "frame_type": frame.frame_type,
            "status": frame.status,
            "counter": frame.counter,
        })
        received = self.files.push(frame)
        if received is None:
            return
        self._emit_file(received.name, received.frame_type, received.file_id, received.data)

    def _emit_file(self, name: str, frame_type: int, file_id: int, data: bytes) -> None:
        self._events.append({
            "type": "bitlink21_file",
            "timestamp": time.time(),
            "name": name,
            "frame_type": frame_type,
            "file_id": file_id,
            "data_b64": base64.b64encode(data).decode("ascii"),
            "is_envelope": envelope.is_envelope(data),
        })

    # ------------------------------------------------------------------ TX

    def build_tx_burst(self, name: str, content: bytes, frame_type: int = framing.TYPE_BINARY_FILE) -> np.ndarray:
        """Modulate a file into IQ for the SDR TX buffer (TX LO from the plan)."""
        if not self.plan.tx_allowed or self.plan.tx_channel_offset_hz is None:
            raise RuntimeError(f"TX blocked: {self.plan.tx_block_reason or 'no uplink frequency'}")
        mode = get_mode(self.plan.tx_mode)
        blocks = filetransfer.build_file_frames(name, content, frame_type)
        lead = int(mode.symbol_rate * 1.5)  # 1.5 s training for receivers
        return modulate_blocks(blocks, mode, self.fs, self.plan.tx_channel_offset_hz, lead_in_symbols=lead)

    def tx_stream(self, name: str, content: bytes, frame_type: int = framing.TYPE_BINARY_FILE,
                  lead_in: bool = True) -> ModulatorStream:
        """Like build_tx_burst, but generated piece by piece while sending
        (a large file at a slow speed would not fit in memory)."""
        if not self.plan.tx_allowed or self.plan.tx_channel_offset_hz is None:
            raise RuntimeError(f"TX blocked: {self.plan.tx_block_reason or 'no uplink frequency'}")
        if self.plan.tx_mode == hyperlink.HYPERLINK_MODE:
            return ResampledStream(hyperlink.burst(name, content), hyperlink.TX_RATE, self.fs,
                                   self.plan.tx_channel_offset_hz)
        mode = get_mode(self.plan.tx_mode)
        blocks = filetransfer.build_file_frames(name, content, frame_type)
        lead = int(mode.symbol_rate * 1.5) if lead_in else 0
        return ModulatorStream(blocks, mode, self.fs, self.plan.tx_channel_offset_hz, lead_in_symbols=lead)
