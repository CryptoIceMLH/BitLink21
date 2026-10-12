"""Radio page: live spectrum of the SDR window (with an optional zoom) and a
VFO that turns any signal in the window into audio (USB / LSB / CW).

Runs inside the Station on the station's own samples, only while the Radio
page asks for it: the page never retunes the SDR, so it cannot fight the
BitLink21 station (the old waterfall page retuned the Pluto and stopped the
station). Frequencies from/to the page are true RF (LNB LO and the beacon's
LNB-error correction applied), so a VFO stays on its signal while the LNB
drifts.
"""

from typing import Optional

import numpy as np
from scipy import signal

from .dsp import ChannelSelector

SPECTRUM_BINS = 2048
SPECTRUM_EMIT_S = 0.05      # every SDR block (~15 frames/s at 1 MS/s)
AUDIO_RATE = 8000.0
DB_FLOOR = -140.0           # spectrum quantised as uint8 in 0.5 dB steps above this

MODES = {
    # passband (Hz, relative to the dial) and output offset for the listener
    "usb": (200.0, 2900.0),
    "lsb": (-2900.0, -200.0),
    "cw": (450.0, 950.0),    # CW heard at ~700 Hz with the dial 700 Hz below the carrier
}


def _quantise(db: np.ndarray) -> bytes:
    return np.clip(np.round((db - DB_FLOOR) * 2), 0, 255).astype(np.uint8).tobytes()


class SpectrumView:
    """Averaged power spectrum of the full window, or of a zoomed part."""

    def __init__(self, fs: float):
        self.fs = float(fs)
        self.zoom_centre_hz = 0.0  # baseband offset
        self.zoom_span_hz: Optional[float] = None  # None = full window
        self._zoom: Optional[ChannelSelector] = None
        self._acc: Optional[np.ndarray] = None
        self._n = 0
        self._t = 0.0
        self._last = -1.0

    def set_zoom(self, centre_hz: float, span_hz: Optional[float]) -> None:
        if span_hz is not None and span_hz >= 0.8 * self.fs:
            span_hz = None
        if span_hz != self.zoom_span_hz or (span_hz is not None and abs(centre_hz - self.zoom_centre_hz) > 1):
            self.zoom_centre_hz, self.zoom_span_hz = float(centre_hz), span_hz
            self._zoom = None if span_hz is None else ChannelSelector(
                self.fs, centre_hz, min_out_rate=1.25 * span_hz, passband_hz=0.55 * span_hz)
            self._acc, self._n = None, 0

    def process(self, iq: np.ndarray) -> Optional[dict]:
        self._t += len(iq) / self.fs
        x, fs = iq, self.fs
        if self._zoom is not None:
            x, fs = self._zoom.process(iq), self._zoom.fs_out
        nper = SPECTRUM_BINS if len(x) >= SPECTRUM_BINS else 1 << int(np.log2(max(len(x), 64)))
        if len(x) >= nper:
            _, p = signal.welch(x, fs=fs, nperseg=nper, return_onesided=False, detrend=False,
                                window="blackmanharris", scaling="spectrum")
            p = np.fft.fftshift(p)
            if self._acc is None or len(self._acc) != len(p):
                self._acc, self._n = np.zeros_like(p), 0
            self._acc += p
            self._n += 1
        if self._t - self._last < SPECTRUM_EMIT_S or not self._n:
            return None
        self._last = self._t
        p = self._acc / self._n
        self._acc, self._n = np.zeros_like(p), 0
        db = 10 * np.log10(p / (2048.0 ** 2) + 1e-20)  # dBFS per bin (Pluto 12-bit)
        span = fs if self._zoom is not None else self.fs
        if self._zoom is not None:  # keep only the clean part of the decimated band
            keep = np.abs(np.fft.fftshift(np.fft.fftfreq(len(db), 1 / fs))) <= self.zoom_span_hz / 2
            db, span = db[keep], self.zoom_span_hz
        return {
            "centre_offset_hz": self.zoom_centre_hz if self._zoom is not None else 0.0,
            "span_hz": float(span),
            "db_floor": DB_FLOOR,
            "bins": _quantise(db),
        }


class Vfo:
    """One receiver turning the signal at ``offset_hz`` into 8 kHz audio."""

    def __init__(self, fs: float, offset_hz: float, mode: str = "usb"):
        self.fs = float(fs)
        self.channel = ChannelSelector(self.fs, offset_hz, min_out_rate=AUDIO_RATE, passband_hz=3200.0)
        self.rate = self.channel.fs_out
        self.mode = None
        self._gain = 1.0
        self.set_mode(mode)

    def set_mode(self, mode: str) -> None:
        mode = mode if mode in MODES else "usb"
        if mode == self.mode:
            return
        lo, hi = MODES[mode]
        # Complex band-pass: low-pass of half the width, shifted to the band's centre
        n = 255
        h = signal.firwin(n, (hi - lo) / 2, fs=self.rate)
        self._h = (h * np.exp(2j * np.pi * (lo + hi) / 2 * (np.arange(n) - n // 2) / self.rate)).astype(np.complex64)
        self._zi = np.zeros(n - 1, np.complex64)
        self.mode = mode

    def set_offset(self, offset_hz: float) -> None:
        if abs(offset_hz - self.channel.offset_hz) > 0.5:
            self.channel.offset_hz = offset_hz

    def process(self, iq: np.ndarray) -> np.ndarray:
        """Audio samples (float, about +-1) at ``self.rate``."""
        y = self.channel.process(iq)
        if not len(y):
            return np.zeros(0, np.float32)
        z, self._zi = signal.lfilter(self._h, 1.0, y, zi=self._zi)
        a = z.real.astype(np.float32)
        # AGC: fast attack, slow release, per block
        peak = float(np.max(np.abs(a))) + 1e-9
        target = 0.5 / peak
        self._gain = min(target, self._gain * 1.05) if target > self._gain else target
        return np.clip(a * self._gain, -1.0, 1.0)


def rf_mapping(profile, plan, correction_hz: float):
    """(rf of baseband 0, +1 or -1): RF = rf0 + sign * baseband_offset."""
    sign = -1.0 if plan.spectral_inversion else 1.0
    if_true0 = plan.rx_center_if_hz - profile.rx_correction_hz - correction_hz
    rf0 = profile.lnb_lo_hz + sign * if_true0
    return rf0, sign
