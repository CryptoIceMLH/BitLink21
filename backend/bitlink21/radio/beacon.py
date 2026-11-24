"""Satellite beacon tracker (live downlink frequency error measurement).

For QO-100 the reference is the GPS-locked 400 bit/s BPSK beacon in the
middle of the NB transponder (10489.750 MHz). Squaring a BPSK signal
removes the modulation and leaves a pure line at twice the carrier offset,
which is far more robust than peak-picking the modulated spectrum. CW
beacons are tracked directly.

The measured offset (actual - nominal) is the error of the whole receive
chain (LNB LO drift + SDR reference error) and is applied as a correction
to everything we receive.

Two channels:
- search: wide (the whole +-span), only while the beacon is not found. It
  is measured in +-SEARCH_SLICE_HZ slices: squaring the whole wide band at
  once lets in more noise (-3.5 dB at +-100 kHz).
- tracking: narrow (+-NARROW_SPAN_HZ) and centred on the beacon, from the
  first fix on. Once locked the wide channel is not processed at all.
"""

from collections import deque
from typing import Optional

import numpy as np
from scipy import fft as sp_fft
from scipy import signal as sp_signal

from .dsp import ChannelSelector, lowpass_taps


FAST_DRIFT_HZ_S = 5.0  # above this, measure twice a second while locked
HOLD_LOCK_HZ = 60.0    # once locked, stay locked within this of the prediction
# Drift rates tried when a locked beacon is suddenly not found (Hz/s)
DRIFT_HYPOTHESES_HZ_S = (-60.0, -40.0, -25.0, -12.0, 12.0, 25.0, 40.0, 60.0)
HYPOTHESIS_WINDOW_HZ = 120.0
# The QO-100 PSK beacon (400 Bd) shows weaker copies of its line exactly
# +-400 Hz away (measured live: carrier 29 dB, copies 19-20 dB). If the line
# found has a much stronger line 400 Hz beside it, that one is the carrier.
SIDE_LINE_HZ = 400.0
SIDE_LINE_MARGIN_DB = 6.0

SEARCH_SLICE_HZ = 25000.0  # one search measurement covers +-this
NARROW_SPAN_HZ = 5000.0    # tracking channel: +-this around the beacon
RECENTRE_HZ = 2000.0       # move the tracking channel when the beacon is this far off its centre


def _smooth_decimation(n: int) -> int:
    """Largest decimation <= n that splits into two stages of at most 32
    (a prime like 37 would give one long filter at the full input rate)."""
    for t in range(max(1, n), 0, -1):
        if t <= 32 or any(t % c == 0 and t // c <= 32 for c in range(2, 33)):
            return t
    return 1


def _channel(fs_in: float, offset_hz: float, min_out_rate: float, passband_hz: float) -> ChannelSelector:
    total = _smooth_decimation(int(fs_in // min_out_rate))
    return ChannelSelector(fs_in, offset_hz, min_out_rate=fs_in / (total + 0.5), passband_hz=passband_hz)


class BeaconTracker:
    def __init__(
        self,
        fs_in: float,
        offset_hz: float,
        kind: str = "psk",
        span_hz: float = 25000.0,
        integration_s: float = 1.0,
        update_interval_s: float = 0.5,
        # Pure noise reaches ~14.7 dB at the strongest bin of the squared
        # spectrum; real beacon lines are 23-30 dB (user's 60-90 cm class dish)
        min_snr_db: float = 18.0,
    ):
        if kind not in ("psk", "cw"):
            raise ValueError("beacon kind must be 'psk' or 'cw'")
        self.kind = kind
        self.span_hz = float(span_hz)
        self.min_snr_db = min_snr_db
        self.update_interval_s = update_interval_s
        self.integration_s = float(integration_s)
        # Squaring (PSK) doubles the offset of the carrier line, so a channel
        # must be at least 2 * power * span wide or a beacon far from nominal
        # aliases to a wrong frequency (a real failure: a -20.4 kHz LNB error
        # showed up as +12.6 kHz with a 66.7 kS/s channel).
        self.power = 2 if kind == "psk" else 1
        self._nominal = float(offset_hz)

        # Search channel: the whole span, measured in slices
        slice_span = min(SEARCH_SLICE_HZ, self.span_hz)
        self.wide = _channel(fs_in, offset_hz,
                             max(2.25 * (self.span_hz + 600), 2.4 * (self.power * slice_span + 1200)),
                             self.span_hz + 600)
        self.fs_wide = self.wide.fs_out
        self.span_hz = min(self.span_hz, 0.45 * self.fs_wide - 600)
        self._slice_decim = max(1, int(self.fs_wide // (2.4 * (self.power * slice_span + 1200))))
        self.fs_slice = self.fs_wide / self._slice_decim
        # Never search beyond what the (squared) slice can represent
        self.slice_span_hz = min(slice_span, 0.45 * self.fs_slice / self.power - 600)
        self.span_hz = max(self.span_hz, self.slice_span_hz)
        self._slice_taps = None
        if self._slice_decim > 1:
            self._slice_taps = lowpass_taps(self.slice_span_hz + 600, self.fs_wide, self.fs_slice / 2, 60).astype(np.float32)
        if self.span_hz <= self.slice_span_hz * 1.001:
            centres = [0.0]
        else:
            edge = self.span_hz - self.slice_span_hz
            count = int(np.ceil(2 * edge / (1.8 * self.slice_span_hz))) + 1
            centres = sorted(np.linspace(-edge, edge, count), key=abs)  # nominal first
        self._slices = [float(c) for c in centres]
        self._phasors: dict = {}

        # Tracking channel: narrow, centred on the beacon
        narrow = min(NARROW_SPAN_HZ, self.slice_span_hz)
        self.narrow = _channel(fs_in, offset_hz, 2.4 * (self.power * narrow + 1200), narrow + 600)
        self.fs_narrow = self.narrow.fs_out
        self.narrow_span_hz = min(narrow, 0.45 * self.fs_narrow / self.power - 600)
        self._narrow_centre = 0.0  # relative to nominal

        # Last `integration_s` of each channel (numpy ring, not a deque: a
        # deque of ~125k Python objects per second was a big CPU cost)
        self._wide_len = int(self.fs_wide * self.integration_s)
        self._narrow_len = int(self.fs_narrow * self.integration_s)
        self._wide_buf = np.zeros(0, dtype=np.complex64)
        self._narrow_buf = np.zeros(0, dtype=np.complex64)
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
        return self._nominal

    @nominal_offset_hz.setter
    def nominal_offset_hz(self, value: float) -> None:
        self._tune(value)
        self.reset()

    def _tune(self, nominal: float) -> None:
        self._nominal = float(nominal)
        self.wide.offset_hz = self._nominal
        self.narrow.offset_hz = self._nominal + self._narrow_centre

    def _set_narrow_centre(self, rel_hz: float, keep: bool) -> None:
        """Centre the tracking channel at ``rel_hz`` from nominal. With
        ``keep`` the samples already buffered are shifted to match (the
        mixer stays phase-continuous), so no measurement is lost."""
        delta = float(rel_hz) - self._narrow_centre
        self._narrow_centre = float(rel_hz)
        self.narrow.offset_hz = self._nominal + self._narrow_centre
        n = len(self._narrow_buf)
        if keep and n:
            k = np.arange(-n, 0)
            self._narrow_buf = (self._narrow_buf * np.exp(-2j * np.pi * delta * k / self.fs_narrow)).astype(np.complex64)
        else:
            self._narrow_buf = np.zeros(0, dtype=np.complex64)

    def seed(self, offset_hz: float) -> None:
        """Start from a known beacon offset (the last lock before a restart):
        searched first, and locked as soon as one measurement finds the beacon
        there. Not reported as locked before that (with the dish pointing at a
        wall it showed "locked" from the seed alone). If the beacon is not
        there, the misses drop the seed and the whole span is searched."""
        self.offset_hz = float(offset_hz)
        self.rate_hz_s = 0.0
        self.locked = False
        self._locked_since = None
        self._misses = 0
        self._residuals.clear()
        self._seeded = True
        self._set_narrow_centre(self.offset_hz, keep=False)

    def retarget(self, offset_hz: float) -> None:
        """Move the channels (SDR retuned / new plan) without losing the lock:
        the beacon's error relative to nominal is unchanged."""
        self._tune(offset_hz)
        self._wide_buf = np.zeros(0, dtype=np.complex64)
        self._narrow_buf = np.zeros(0, dtype=np.complex64)
        self._since_update = 0.0

    def reset(self) -> None:
        self._wide_buf = np.zeros(0, dtype=np.complex64)
        self._narrow_buf = np.zeros(0, dtype=np.complex64)
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

    def _tracking(self) -> bool:
        """Measure on the narrow channel: locked, seeded, or the beacon was
        found by the last measurement. Otherwise search the wide one."""
        return self.offset_hz is not None and (self.locked or self._seeded or self._misses == 0)

    def process(self, iq: np.ndarray) -> bool:
        """Feed SDR samples. Returns True when a new measurement was made."""
        fs_in = self.wide.fs_in
        self._since_update += len(iq) / fs_in
        self._stream_t += len(iq) / fs_in
        if not self.locked:
            y = self.wide.process(iq)
            self._wide_buf = np.concatenate([self._wide_buf, y])[-self._wide_len:]
        elif len(self._wide_buf):
            self._wide_buf = np.zeros(0, dtype=np.complex64)  # locked: no search channel
        if self.offset_hz is not None:
            y = self.narrow.process(iq)
            self._narrow_buf = np.concatenate([self._narrow_buf, y])[-self._narrow_len:]
        # Once locked, once a second is plenty for a slow drift; while the
        # frequency runs (seen live: 20-40 Hz/s while transmitting) measure
        # twice a second
        slow = abs(self.rate_hz_s) < FAST_DRIFT_HZ_S
        interval = max(self.update_interval_s, 1.0) if (self.locked and slow) else self.update_interval_s
        buf, full = (self._narrow_buf, self._narrow_len) if self._tracking() else (self._wide_buf, self._wide_len)
        if self._since_update < interval or len(buf) < full // 2:
            return False
        self._dt = self._since_update  # real time since the last measurement
        self._since_update = 0.0
        self._measure()
        if self.locked:
            self._wide_buf = np.zeros(0, dtype=np.complex64)  # search channel idle while locked
        return True

    def _line_spectrum(self, z: np.ndarray, power: int, fs: float, pad: int = 1):
        """Power spectrum and frequency axis (cached per length)."""
        n = 1 << (int(np.ceil(np.log2(len(z)))) + pad)
        key = (len(z), n, power, fs)
        cache = getattr(self, "_spec_cache", {})
        if key not in cache:
            if len(cache) > 16:
                cache.clear()
            cache[key] = (
                np.hanning(len(z)).astype(np.float32),
                np.fft.fftshift(np.fft.fftfreq(n, 1 / fs)) / power,
            )
            self._spec_cache = cache
        window, freqs = cache[key]
        spec = np.fft.fftshift(np.abs(sp_fft.fft((z * window).astype(np.complex64), n)) ** 2)
        return freqs, spec

    @staticmethod
    def _dechirp(x: np.ndarray, rate: float, fs: float) -> np.ndarray:
        """Remove a frequency ramp (Hz/s) across the window, referenced to its
        centre: a drifting beacon becomes a sharp line again."""
        if abs(rate) < 0.5:
            return x
        tt = (np.arange(len(x)) - len(x) / 2) / fs
        return (x * np.exp(-1j * np.pi * rate * tt * tt)).astype(np.complex64)

    def _find_line(self, x: np.ndarray, rate: float, centre: float, window: float, fs: float, span: float):
        """Strongest beacon line in the window after removing ``rate``
        (frequencies relative to the channel ``x`` is mixed to, which covers
        +-``span``). Returns (frequency at the window centre, SNR dB, moved)
        or (None, SNR, False); ``moved`` means it stepped off a side line onto
        the carrier 400 Hz away."""
        x = self._dechirp(x, rate, fs)
        power = 2 if self.kind == "psk" else 1
        freqs, spec = self._line_spectrum(x ** power, power, fs)
        bin_hz = freqs[1] - freqs[0]
        allowed = np.abs(freqs - centre) <= window
        allowed &= np.abs(freqs) <= span
        noise = float(np.median(spec[np.abs(freqs) <= span])) + 1e-30

        plain_freqs = plain_spec = plain_noise = None
        if self.kind == "psk":
            # The CW check only needs a coarse plain spectrum: no zero padding
            plain_freqs, plain_spec = self._line_spectrum(x, 1, fs, pad=0)
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
            return None, None, False
        moved = False
        if self.kind == "psk":
            # On a side line? The carrier is the strongest of the three lines
            # (checked beyond the search window, which is narrower than 400 Hz)
            near_bins = max(1, int(round(8.0 / bin_hz)))
            for _ in range(2):  # a side line can be 800 Hz out at worst
                best_k, best_p = k, spec[k]
                for side in (-SIDE_LINE_HZ, SIDE_LINE_HZ):
                    j = int(np.argmin(np.abs(freqs - (freqs[k] + side))))
                    lo, hi = max(j - near_bins, 1), min(j + near_bins + 1, len(spec) - 1)
                    jj = lo + int(np.argmax(spec[lo:hi]))
                    if spec[jj] > best_p and abs(freqs[jj]) <= span:
                        best_k, best_p = jj, spec[jj]
                if best_k == k or 10 * np.log10(best_p / spec[k]) < SIDE_LINE_MARGIN_DB:
                    break
                k, moved = best_k, True
        snr = float(10 * np.log10(spec[k] / noise))
        if snr < self.min_snr_db:
            return None, snr, False
        # Quadratic interpolation on the log spectrum for sub-bin accuracy
        a, b, c = np.log(spec[k - 1] + 1e-30), np.log(spec[k] + 1e-30), np.log(spec[k + 1] + 1e-30)
        denom = a - 2 * b + c
        delta = 0.5 * (a - c) / denom if denom != 0 else 0.0
        return float(freqs[k] + delta * bin_hz), snr, moved

    def _slice(self, centre_hz: float) -> np.ndarray:
        """Search slice around ``centre_hz`` (from nominal) of the wide
        buffer: mixed to DC, decimated, DC removed."""
        x = self._wide_buf
        n = len(x)
        if centre_hz != 0.0:
            key = (centre_hz, n)
            ph = self._phasors.get(key)
            if ph is None:
                if len(self._phasors) > 32:
                    self._phasors.clear()
                ph = np.exp(-2j * np.pi * centre_hz / self.fs_wide * np.arange(n)).astype(np.complex64)
                self._phasors[key] = ph
            x = x * ph
        if self._slice_taps is not None:
            d = self._slice_decim
            y = sp_signal.upfirdn(self._slice_taps, x, 1, d)
            start = (len(self._slice_taps) - 1) // 2 // d
            x = y[start: start + n // d].astype(np.complex64)
        return x - np.mean(x)

    def _measure(self) -> None:
        dt = self._dt
        predicted = None
        if self.offset_hz is not None:
            predicted = self.offset_hz + self.rate_hz_s * dt
        # Search the whole span until found, then only near the prediction
        # so a neighbouring carrier cannot pull the lock away.
        locked_search = (self.locked or self._seeded) and predicted is not None
        # Window centre lies half an integration time in the past
        half = self.integration_s / 2
        rate = self.rate_hz_s
        line = snr = None
        moved = False

        if self._tracking():
            c = self._narrow_centre
            span, fs = self.narrow_span_hz, self.fs_narrow
            x = self._narrow_buf - np.mean(self._narrow_buf)
            if locked_search:
                centre, window = predicted - rate * half - c, 300.0
            else:
                centre, window = 0.0, span
            line, snr, moved = self._find_line(x, rate, centre, window, fs, span)
            if line is None and locked_search:
                # Lost it: the receive frequency may have started running (live:
                # 20-40 Hz/s while transmitting) and smeared the line. Try drift
                # rates; the one giving a sharp line also gives the new rate.
                # Only near the expectation: the beacon's symbol-clock lines sit a
                # few hundred Hz away and must not be mistaken for it
                best = (None, None, rate, False)
                for r in DRIFT_HYPOTHESES_HZ_S:
                    f, s, mv = self._find_line(x, r, centre, HYPOTHESIS_WINDOW_HZ, fs, span)
                    if f is not None and (best[1] is None or s > best[1]):
                        best = (f, s, r, mv)
                if best[0] is not None:
                    line, snr, rate, moved = best
                    self.rate_hz_s = rate
                    predicted = self.offset_hz + rate * dt
            if line is not None:
                line += c
            view = (x, fs, c)
        else:
            # Search every slice of the wide channel; strongest line wins
            for c in self._slices:
                f, s, mv = self._find_line(self._slice(c), rate, 0.0, self.slice_span_hz,
                                           self.fs_slice, self.slice_span_hz)
                if f is not None:
                    if line is None or s > snr:
                        line, snr, moved = f + c, s, mv
                elif s is not None and line is None and (snr is None or s > snr):
                    snr = s
            view = (self._wide_buf - np.mean(self._wide_buf), self.fs_wide, 0.0)
        self.snr_db = snr

        if line is None:
            self.raw_offset_hz = None
            self._misses += 1
            if self._misses >= 4:  # ~2 s without the beacon
                self.locked = False
                self._seeded = False  # not where it was: search everything
                self._locked_since = None
                self._residuals.clear()
            elif self.offset_hz is not None:
                self.offset_hz += self.rate_hz_s * dt  # coast on the drift rate
            self._update_spectrum(*view)
            return
        self._misses = 0
        # Frequency now: the line is the window centre, half a window back
        raw = line + rate * half
        self.raw_offset_hz = raw

        if moved and self.locked:
            # Stepped off a side line onto the carrier: re-centre, stay locked
            self.offset_hz = raw
            self._residuals.clear()
            self._residuals.extend([0.0, 0.0, 0.0])
            self._seeded = False
            self._follow()
            self._update_spectrum(*view)
            return
        if self._seeded and predicted is not None and abs(raw - predicted) <= 100:
            # Seed confirmed by a real measurement: lock now (no 3-reading wait)
            self._seeded = False
            self.locked = True
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
            self._update_spectrum(*view)
            return
        if self.offset_hz is None or abs(raw - predicted) > 100:
            # First fix or a jump: restart the tracker, tracking channel on it
            self._seeded = False
            self.offset_hz = raw
            self.rate_hz_s = 0.0
            self._residuals.clear()
            self._set_narrow_centre(raw, keep=False)
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
            self.locked = len(self._residuals) >= 3 and max(self._residuals) < 15.0
        if self.locked and self._locked_since is None:
            self._locked_since = self._stream_t
        elif not self.locked:
            self._locked_since = None
        self._follow()
        self._update_spectrum(*view)

    def _follow(self) -> None:
        """Keep the tracking channel centred on the beacon as it drifts."""
        if self.offset_hz is not None and abs(self.offset_hz - self._narrow_centre) > RECENTRE_HZ:
            self._set_narrow_centre(round(self.offset_hz), keep=True)

    def _update_spectrum(self, x: np.ndarray, fs: float, centre: float) -> None:
        """Small display spectrum (+-spectrum_span_hz around the beacon);
        ``x`` is mixed to ``centre`` (from nominal)."""
        if len(x) == 0:
            return
        nfft = 1 << int(np.ceil(np.log2(fs / 10)))  # ~10 Hz bins
        seg = x[-nfft:] if len(x) >= nfft else x
        spec = np.abs(np.fft.fftshift(np.fft.fft(seg * np.hanning(len(seg)), nfft))) ** 2
        freqs = np.fft.fftshift(np.fft.fftfreq(nfft, 1 / fs)) + centre
        self.spectrum_centre_hz = round(self.offset_hz or 0.0, 1)
        sel = np.abs(freqs - self.spectrum_centre_hz) <= self.spectrum_span_hz
        db = 10 * np.log10(spec[sel] + 1e-20)
        step = max(1, len(db) // 400)
        self.spectrum = [round(float(v), 1) for v in db[::step]]
