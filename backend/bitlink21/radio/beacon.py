"""Satellite beacon tracker (live downlink frequency error measurement).

For QO-100 the reference is the GPS-locked 400 bit/s BPSK beacon in the
middle of the NB transponder (10489.750 MHz). Squaring a BPSK signal
removes the modulation and leaves a pure line at twice the carrier offset,
which is far more robust than peak-picking the modulated spectrum. CW
beacons are tracked directly.

The measured offset (actual - nominal) is the error of the whole receive
chain (LNB LO drift + SDR reference error) and is applied as a correction
to everything we receive.
"""

from collections import deque
from typing import Optional

import numpy as np

from .dsp import ChannelSelector


class BeaconTracker:
    def __init__(
        self,
        fs_in: float,
        offset_hz: float,
        kind: str = "psk",
        span_hz: float = 25000.0,
        integration_s: float = 1.0,
        update_interval_s: float = 0.5,
        min_snr_db: float = 15.0,
    ):
        if kind not in ("psk", "cw"):
            raise ValueError("beacon kind must be 'psk' or 'cw'")
        self.kind = kind
        self.span_hz = float(span_hz)
        self.min_snr_db = min_snr_db
        self.update_interval_s = update_interval_s
        # Squaring (PSK) doubles the offset of the carrier line, so the
        # channel must be at least 2 * power * span wide or a beacon far from
        # nominal aliases to a wrong frequency (a real failure: a -20.4 kHz LNB
        # error showed up as +12.6 kHz with a 66.7 kS/s channel).
        self.power = 2 if kind == "psk" else 1
        passband = self.span_hz + 600
        self.channel = ChannelSelector(
            fs_in, offset_hz,
            min_out_rate=2.4 * (self.power * self.span_hz + 1200),
            passband_hz=passband,
        )
        self.fs = self.channel.fs_out
        # Never search beyond what the (squared) channel can represent
        self.span_hz = min(self.span_hz, 0.45 * self.fs / self.power - 600)
        self._buf = deque(maxlen=int(self.fs * integration_s))
        self._since_update = 0.0

        self.offset_hz: Optional[float] = None  # tracked offset (alpha-beta filter)
        self.rate_hz_s = 0.0  # tracked drift rate
        self.raw_offset_hz: Optional[float] = None
        self.snr_db: Optional[float] = None
        self.locked = False
        self._residuals = deque(maxlen=3)
        self._misses = 0
        self._stream_t = 0.0  # seconds of input seen
        self._locked_since: Optional[float] = None
        self.spectrum: list = []
        self.spectrum_span_hz = 2000.0
        self.spectrum_centre_hz = 0.0

    @property
    def nominal_offset_hz(self) -> float:
        return self.channel.offset_hz

    @nominal_offset_hz.setter
    def nominal_offset_hz(self, value: float) -> None:
        self.channel.offset_hz = value
        self.reset()

    def reset(self) -> None:
        self._buf.clear()
        self._residuals.clear()
        self.offset_hz = None
        self.rate_hz_s = 0.0
        self.raw_offset_hz = None
        self.locked = False
        self._misses = 0
        self._locked_since = None

    def status(self) -> dict:
        return {
            "kind": self.kind,
            "locked": bool(self.locked),
            "locked_s": 0.0 if self._locked_since is None else round(self._stream_t - self._locked_since, 1),
            "offset_hz": None if self.offset_hz is None else round(float(self.offset_hz), 1),
            "raw_offset_hz": None if self.raw_offset_hz is None else round(float(self.raw_offset_hz), 1),
            "rate_hz_s": round(float(self.rate_hz_s), 2),
            "snr_db": None if self.snr_db is None else round(float(self.snr_db), 1),
            "spectrum": self.spectrum,
            "spectrum_span_hz": float(self.spectrum_span_hz),
            "spectrum_centre_hz": float(self.spectrum_centre_hz),
        }

    def process(self, iq: np.ndarray) -> bool:
        """Feed SDR samples. Returns True when a new measurement was made."""
        y = self.channel.process(iq)
        self._buf.extend(y)
        self._since_update += len(iq) / self.channel.fs_in
        self._stream_t += len(iq) / self.channel.fs_in
        if self._since_update < self.update_interval_s or len(self._buf) < self._buf.maxlen // 2:
            return False
        self._since_update = 0.0
        self._measure()
        return True

    def _line_spectrum(self, z: np.ndarray, power: int):
        n = 1 << (int(np.ceil(np.log2(len(z)))) + 2)
        spec = np.abs(np.fft.fftshift(np.fft.fft(z * np.hanning(len(z)), n))) ** 2
        freqs = np.fft.fftshift(np.fft.fftfreq(n, 1 / self.fs)) / power
        return freqs, spec

    def _measure(self) -> None:
        x = np.fromiter(self._buf, dtype=np.complex64, count=len(self._buf))
        x = x - np.mean(x)
        dt = self.update_interval_s
        power = 2 if self.kind == "psk" else 1
        freqs, spec = self._line_spectrum(x ** power, power)
        bin_hz = freqs[1] - freqs[0]

        # Search the whole span until locked, then only near the prediction
        # so a neighbouring carrier cannot pull the lock away.
        predicted = None
        if self.offset_hz is not None:
            predicted = self.offset_hz + self.rate_hz_s * dt
        window = 300.0 if (self.locked and predicted is not None) else self.span_hz
        centre = predicted if (self.locked and predicted is not None) else 0.0
        allowed = np.abs(freqs - centre) <= window
        allowed &= np.abs(freqs) <= self.span_hz
        noise = float(np.median(spec[np.abs(freqs) <= self.span_hz])) + 1e-30

        plain_freqs = plain_spec = plain_noise = None
        if self.kind == "psk":
            plain_freqs, plain_spec = self._line_spectrum(x, 1)
            plain_noise = float(np.median(plain_spec)) + 1e-30

        masked = np.where(allowed, spec, 0.0)
        k = None
        for _ in range(5):  # try the strongest few lines
            cand = int(np.argmax(masked))
            if masked[cand] <= 0:
                break
            if self.kind == "psk":
                # A BPSK beacon has a suppressed carrier: a line that is also
                # strong in the plain spectrum is a CW carrier, not the beacon.
                j = int(np.argmin(np.abs(plain_freqs - freqs[cand])))
                lo, hi = max(j - 3, 0), j + 4
                plain_snr = 10 * np.log10(np.max(plain_spec[lo:hi]) / plain_noise)
                sq_snr = 10 * np.log10(spec[cand] / noise)
                if plain_snr > sq_snr - 10:
                    masked[np.abs(freqs - freqs[cand]) < 50] = 0
                    continue
            k = cand
            break

        self.snr_db = None if k is None else float(10 * np.log10(spec[k] / noise))
        if k is None or self.snr_db < self.min_snr_db or k == 0 or k == len(spec) - 1:
            self.raw_offset_hz = None
            self._misses += 1
            if self._misses >= 4:  # ~2 s without the beacon
                self.locked = False
                self._locked_since = None
                self._residuals.clear()
            elif self.offset_hz is not None:
                self.offset_hz += self.rate_hz_s * dt  # coast on the drift rate
            self._update_spectrum(x)
            return
        self._misses = 0

        # Quadratic interpolation on the log spectrum for sub-bin accuracy
        a, b, c = np.log(spec[k - 1] + 1e-30), np.log(spec[k] + 1e-30), np.log(spec[k + 1] + 1e-30)
        denom = a - 2 * b + c
        delta = 0.5 * (a - c) / denom if denom != 0 else 0.0
        # The FFT window is centred half an integration time in the past
        raw = float(freqs[k] + delta * bin_hz) + self.rate_hz_s * self.integration_s / 2
        self.raw_offset_hz = raw

        if self.offset_hz is None or abs(raw - predicted) > 100:
            # First fix or a jump: restart the tracker
            self.offset_hz = raw
            self.rate_hz_s = 0.0
            self._residuals.clear()
        else:
            # alpha-beta filter: tracks offset and drift rate (LNB warm-up
            # drift of several Hz/s is normal)
            r = raw - predicted
            self.offset_hz = predicted + 0.5 * r
            self.rate_hz_s += 0.15 * r / dt
            self._residuals.append(abs(r))
        self.locked = len(self._residuals) >= 3 and max(self._residuals) < 15.0
        if self.locked and self._locked_since is None:
            self._locked_since = self._stream_t
        elif not self.locked:
            self._locked_since = None
        self._update_spectrum(x)

    @property
    def integration_s(self) -> float:
        return self._buf.maxlen / self.fs

    def _update_spectrum(self, x: np.ndarray) -> None:
        """Small display spectrum (+-spectrum_span_hz around the beacon)."""
        nfft = 1 << int(np.ceil(np.log2(self.fs / 10)))  # ~10 Hz bins
        seg = x[-nfft:] if len(x) >= nfft else x
        spec = np.abs(np.fft.fftshift(np.fft.fft(seg * np.hanning(len(seg)), nfft))) ** 2
        freqs = np.fft.fftshift(np.fft.fftfreq(nfft, 1 / self.fs))
        self.spectrum_centre_hz = round(self.offset_hz or 0.0, 1)
        sel = np.abs(freqs - self.spectrum_centre_hz) <= self.spectrum_span_hz
        db = 10 * np.log10(spec[sel] + 1e-20)
        step = max(1, len(db) // 400)
        self.spectrum = [round(float(v), 1) for v in db[::step]]
