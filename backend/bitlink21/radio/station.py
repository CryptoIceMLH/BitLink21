"""Ground station: profile -> beacon lock + HSModem RX/TX on one SDR stream.

Runs inside the SDR worker process. Feed it every RX buffer with
``process(iq)``; it returns a list of events (dicts) for the main process:

    {"type": "bitlink21_status", ...}      ~2 per second
    {"type": "bitlink21_frame", ...}       every decoded HSModem frame
    {"type": "bitlink21_file", ...}        every completed file
"""

import base64
import time
from typing import List, Optional

import numpy as np

from . import envelope, filetransfer, framing
from .beacon import BeaconTracker
from .demodulator import HsModemReceiver
from .modes import get_mode
from .modulator import ModulatorStream, modulate_blocks
from .profile import SatelliteProfile, make_plan

STATUS_INTERVAL_S = 0.5


class Station:
    def __init__(self, profile: SatelliteProfile, fs: float):
        self.profile = profile
        self.fs = float(fs)
        self.plan = make_plan(profile)
        self.rx_mode = get_mode(profile.rx_mode)
        self.receiver = HsModemReceiver(
            self.fs, self.rx_mode, self.plan.rx_channel_offset_hz, profile.search_span_hz
        )
        self.beacon: Optional[BeaconTracker] = None
        if profile.beacon_lock:
            self.beacon = BeaconTracker(self.fs, self.plan.beacon_offset_hz, kind=profile.beacon_kind)
        self.files = filetransfer.FileReceiver()
        self.correction_hz = 0.0
        self._last_status = 0.0
        self._events: List[dict] = []

    # ------------------------------------------------------------------ RX

    def process(self, iq: np.ndarray) -> List[dict]:
        self._events = []
        if self.beacon is not None and self.beacon.process(iq):
            if self.beacon.locked and self.beacon.offset_hz is not None:
                self.correction_hz = self.beacon.offset_hz
                self.receiver.set_nominal(self.plan.rx_channel_offset_hz + self.correction_hz)

        for frame in self.receiver.process(iq):
            self._on_frame(frame)

        now = time.time()
        if now - self._last_status >= STATUS_INTERVAL_S:
            self._last_status = now
            self._events.append(self.status_event())
        return self._events

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
        self._events.append({
            "type": "bitlink21_file",
            "timestamp": time.time(),
            "name": received.name,
            "frame_type": received.frame_type,
            "file_id": received.file_id,
            "data_b64": base64.b64encode(received.data).decode("ascii"),
            "is_envelope": envelope.is_envelope(received.data),
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
        mode = get_mode(self.plan.tx_mode)
        blocks = filetransfer.build_file_frames(name, content, frame_type)
        lead = int(mode.symbol_rate * 1.5) if lead_in else 0
        return ModulatorStream(blocks, mode, self.fs, self.plan.tx_channel_offset_hz, lead_in_symbols=lead)
