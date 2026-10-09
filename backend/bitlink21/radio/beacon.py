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
from scipy import fft as sp_fft

from .dsp import ChannelSelector


FAST_DRIFT_HZ_S = 5.0  # above this, measure twice a second while locked
HOLD_LOCK_HZ = 60.0    # once locked, stay locked within this of the prediction
# Drift rates tried when a locked beacon is suddenly not found (Hz/s)
DRIFT_HYPOTHESES_HZ_S = (-60.0, -40.0, -25.0, -12.0, 12.0, 25.0, 40.0, 60.0)
HYPOTHESIS_WINDOW_HZ = 120.0


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
        # Last `integration_s` of channel samples (numpy ring, not a deque:
        # a deque of ~125k Python objects per second was a big CPU cost)
        self._buf_len = int(self.fs * integration_s)
        self._buf = np.zeros(0, dtype=np.complex64)
        self._since_update = 0.0
        self._dt = update_interval_s

        self.offset_hz: Optional[float] = None  # tracked offset (alpha-beta filter)
        self.rate_hz_s = 0.0  # tracked drift rate
        self.raw_offset_hz: Optional[float] = None
        self.snr_db: Optional[float] = None
        self.locked = False
        self._residuals = deque(maxlen=3)
        self._misses = 0
        self._stream_t = 0.0  # seconds of input seen
        self._locked_since: Optional[float] = None
        self._seeded = False
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

    def seed(self, offset_hz: float) -> None:
        """Start from a known beacon offset (the last lock before a restart):
        treated as locked straight away and confirmed by the next measurements.
        If the beacon is not there any more (> 300 Hz away), the misses unlock
        the tracker and it searches the whole span as usual."""
        self.offset_hz = float(offset_hz)
        self.rate_hz_s = 0.0
        self.locked = True
        self._locked_since = None  # counts once a measurement confirms it
        self._misses = 0
        self._residuals.clear()
        self._seeded = True

    def retarget(self, offset_hz: float) -> None:
        """Move the channel (SDR retuned / new plan) without losing the lock:
        the beacon's error relative to nominal is unchanged."""
        self.channel.offset_hz = offset_hz
        self._buf = np.zeros(0, dtype=np.complex64)
        self._since_update = 0.0

    def reset(self) -> None:
        self._buf = np.zeros(0, dtype=np.complex64)
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
        self._buf = np.concatenate([self._buf, y])[-self._buf_len:]
        self._since_update += len(iq) / self.channel.fs_in
        self._stream_t += len(iq) / self.channel.fs_in
        # Once locked, once a second is plenty for a slow drift; while the
        # frequency runs (seen live: 20-40 Hz/s while transmitting) measure
        # twice a second
        slow = abs(self.rate_hz_s) < FAST_DRIFT_HZ_S
        interval = max(self.update_interval_s, 1.0) if (self.locked and slow) else self.update_interval_s
        if self._since_update < interval or len(self._buf) < self._buf_len // 2:
            return False
        self._dt = self._since_update  # real time since the last measurement
        self._since_update = 0.0
        self._measure()
        return True

    def _line_spectrum(self, z: np.ndarray, power: int, pad: int = 1):
        """Power spectrum and frequency axis (cached per length)."""
        n = 1 << (int(np.ceil(np.log2(len(z)))) + pad)
        key = (len(z), n, power)
        cache = getattr(self, "_spec_cache", {})
        if key not in cache:
            cache[key] = (
                np.hanning(len(z)).astype(np.float32),
                np.fft.fftshift(np.fft.fftfreq(n, 1 / self.fs)) / power,
            )
            self._spec_cache = cache
        window, freqs = cache[key]
        spec = np.fft.fftshift(np.abs(sp_fft.fft((z * window).astype(np.complex64), n)) ** 2)
        return freqs, spec

    def _dechirp(self, x: np.ndarray, rate: float) -> np.ndarray:
        """Remove a frequency ramp (Hz/s) across the window, referenced to its
        centre: a drifting beacon becomes a sharp line again."""
        if abs(rate) < 0.5:
            return x
        tt = (np.arange(len(x)) - len(x) / 2) / self.fs
        return (x * np.exp(-1j * np.pi * rate * tt * tt)).astype(np.complex64)

    def _find_line(self, x: np.ndarray, rate: float, centre: float, window: float):
        """Strongest beacon line in the window after removing ``rate``.
        Returns (frequency at the window centre, SNR dB) or (None, SNR)."""
        x = self._dechirp(x, rate)
        power = 2 if self.kind == "psk" else 1
        freqs, spec = self._line_spectrum(x ** power, power)
        bin_hz = freqs[1] - freqs[0]
        allowed = np.abs(freqs - centre) <= window
        allowed &= np.abs(freqs) <= self.span_hz
        noise = float(np.median(spec[np.abs(freqs) <= self.span_hz])) + 1e-30

        plain_freqs = plain_spec = plain_noise = None
        if self.kind == "psk":
            # The CW check only needs a coarse plain spectrum: no zero padding
            plain_freqs, plain_spec = self._line_spectrum(x, 1, pad=0)
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
                # Judged by how concentrated the plain power is (noise
                # removed): a CW carrier sits in a few bins, the 400 Bd BPSK
                # beacon spreads over hundreds. Comparing levels instead
                # rejected a strong real beacon and locked onto its clock lines.
                j = int(np.argmin(np.abs(plain_freqs - freqs[cand])))
                lo, hi = max(j - 3, 0), j + 4
                near = np.abs(plain_freqs - plain_freqs[j]) < 500.0
                core = float(np.sum(plain_spec[lo:hi])) - (hi - lo) * plain_noise
                total = float(np.sum(plain_spec[near])) - int(np.count_nonzero(near)) * plain_noise
                if total > 0 and core / total > 0.3:
                    masked[np.abs(freqs - freqs[cand]) < 50] = 0
                    continue
            k = cand
            break
        if k is None or k == 0 or k == len(spec) - 1:
            return None, None
        snr = float(10 * np.log10(spec[k] / noise))
        if snr < self.min_snr_db:
            return None, snr
        # Quadratic interpolation on the log spectrum for sub-bin accuracy
        a, b, c = np.log(spec[k - 1] + 1e-30), np.log(spec[k] + 1e-30), np.log(spec[k + 1] + 1e-30)
        denom = a - 2 * b + c
        delta = 0.5 * (a - c) / denom if denom != 0 else 0.0
        return float(freqs[k] + delta * bin_hz), snr

    def _measure(self) -> None:
        x = self._buf
        x = x - np.mean(x)
        dt = self._dt

        # Search the whole span until locked, then only near the prediction
        # so a neighbouring carrier cannot pull the lock away.
        predicted = None
        if self.offset_hz is not None:
            predicted = self.offset_hz + self.rate_hz_s * dt
        locked_search = self.locked and predicted is not None
        window = 300.0 if locked_search else self.span_hz
        # Window centre lies half an integration time in the past
        half = self.integration_s / 2
        centre = (predicted - self.rate_hz_s * half) if locked_search else 0.0

        rate = self.rate_hz_s
        line, snr = self._find_line(x, rate, centre, window)
        if line is None and locked_search:
            # Lost it: the receive frequency may have started running (live:
            # 20-40 Hz/s while transmitting) and smeared the line. Try drift
            # rates; the one giving a sharp line also gives the new rate.
            # Only near the expectation: the beacon's symbol-clock lines sit a
            # few hundred Hz away and must not be mistaken for it
            best = (None, None, rate)
            for r in DRIFT_HYPOTHESES_HZ_S:
                f, s = self._find_line(x, r, centre, HYPOTHESIS_WINDOW_HZ)
                if f is not None and (best[1] is None or s > best[1]):
                    best = (f, s, r)
            if best[0] is not None:
                line, snr, rate = best
                self.rate_hz_s = rate
                predicted = self.offset_hz + rate * dt
        self.snr_db = snr

        if line is None:
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
        # Frequency now: the line is the window centre, half a window back
        raw = line + rate * half
        self.raw_offset_hz = raw

        if self._seeded and predicted is not None and abs(raw - predicted) <= 100:
            # Seed confirmed by a real measurement: keep the lock
            self._seeded = False
            self._residuals.extend([0.0, 0.0])
        if locked_search and not self._seeded and abs(raw - predicted) > 100:
            # A single far-off reading while locked is not trusted (a symbol-
            # clock line or interference): count it as a miss
            self.raw_offset_hz = None
            self._misses += 1
            if self._misses >= 4:
                self.locked = False
                self._locked_since = None
                self._residuals.clear()
            else:
                self.offset_hz += self.rate_hz_s * dt
            self._update_spectrum(x)
            return
        if self.offset_hz is None or abs(raw - predicted) > 100:
            # First fix or a jump: restart the tracker
            self._seeded = False
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
        if self.locked and self._residuals:
            # Keep the lock while the beacon stays near the prediction; a fast
            # drift onset briefly misses by tens of Hz until the rate settles
            self.locked = self._residuals[-1] < HOLD_LOCK_HZ
        else:
            self.locked = (len(self._residuals) >= 3 and max(self._residuals) < 15.0) or self._seeded
        if self.locked and self._locked_since is None:
            self._locked_since = self._stream_t
        elif not self.locked:
            self._locked_since = None
        self._update_spectrum(x)

    @property
    def integration_s(self) -> float:
        return self._buf_len / self.fs

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
