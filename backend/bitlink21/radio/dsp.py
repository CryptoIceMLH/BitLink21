"""Streaming DSP building blocks (NumPy/SciPy, state carried across buffers)."""

from fractions import Fraction

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view
from scipy import signal


def rrc_taps(sps: float, beta: float, span_symbols: int = 14) -> np.ndarray:
    """Root-raised-cosine impulse response, unit energy.

    sps may be fractional. span_symbols is the total filter length in symbols.
    """
    n_half = int(np.ceil(span_symbols * sps / 2))
    t = np.arange(-n_half, n_half + 1) / sps
    h = np.zeros_like(t)
    for i, ti in enumerate(t):
        if abs(ti) < 1e-9:
            h[i] = 1 - beta + 4 * beta / np.pi
        elif beta > 0 and abs(abs(4 * beta * ti) - 1) < 1e-9:
            h[i] = beta / np.sqrt(2) * (
                (1 + 2 / np.pi) * np.sin(np.pi / (4 * beta))
                + (1 - 2 / np.pi) * np.cos(np.pi / (4 * beta))
            )
        else:
            h[i] = (
                np.sin(np.pi * ti * (1 - beta))
                + 4 * beta * ti * np.cos(np.pi * ti * (1 + beta))
            ) / (np.pi * ti * (1 - (4 * beta * ti) ** 2))
    return h / np.sqrt(np.sum(h ** 2))


def lowpass_taps(pass_hz: float, fs: float, stop_hz: float, atten_db: float = 60) -> np.ndarray:
    """Kaiser low-pass, flat up to pass_hz and atten_db down from stop_hz."""
    stop_hz = min(stop_hz, fs / 2)
    if stop_hz <= pass_hz:
        raise ValueError(f"stop edge {stop_hz} must be above pass edge {pass_hz}")
    numtaps, beta = signal.kaiserord(atten_db, (stop_hz - pass_hz) / (fs / 2))
    numtaps |= 1  # odd length, integer group delay
    return signal.firwin(numtaps, (pass_hz + stop_hz) / 2, window=("kaiser", beta), fs=fs)


class Nco:
    """Phase-continuous complex mixer: out = x * exp(-j*2*pi*f*t)."""

    def __init__(self, fs: float, freq_hz: float = 0.0):
        self.fs = fs
        self.freq_hz = freq_hz
        self._phase = 0.0

    def mix(self, x: np.ndarray) -> np.ndarray:
        if self.freq_hz == 0.0:
            return x
        step = 2 * np.pi * self.freq_hz / self.fs
        ph = self._phase + step * np.arange(len(x))
        self._phase = float((self._phase + step * len(x)) % (2 * np.pi))
        return x * np.exp(-1j * ph).astype(np.complex64)


class FirDecimator:
    """Streaming FIR filter + integer decimation (D=1 gives a plain filter).

    Only the output samples that are kept get computed, so the cost is
    len(taps) * N / D multiply-adds per block.
    """

    def __init__(self, taps: np.ndarray, decim: int = 1):
        self.taps_rev = np.asarray(taps, dtype=np.complex64)[::-1].copy()
        self.decim = int(decim)
        self.ntaps = len(taps)
        self._hist = np.zeros(self.ntaps - 1, dtype=np.complex64)
        self._next = self.ntaps - 1  # index (in hist+block coords) of next output

    @property
    def delay(self) -> float:
        """Group delay in input samples."""
        return (self.ntaps - 1) / 2

    def process(self, x: np.ndarray) -> np.ndarray:
        ext = np.concatenate([self._hist, np.asarray(x, dtype=np.complex64)])
        last = len(ext) - 1
        if self._next > last:
            out = np.zeros(0, dtype=np.complex64)
        else:
            idx = np.arange(self._next, last + 1, self.decim)
            windows = sliding_window_view(ext, self.ntaps)
            out = windows[idx - (self.ntaps - 1)] @ self.taps_rev
            self._next = int(idx[-1]) + self.decim
        keep = self.ntaps - 1
        self._next -= len(ext) - keep
        self._hist = ext[len(ext) - keep:] if keep else ext[:0]
        return out.astype(np.complex64)


class ChannelSelector:
    """Mix a channel to DC and decimate it in up to two FIR stages.

    The output rate is fs_in / (d1 * d2), chosen to be just above
    min_out_rate so the downstream symbol timing loop sees at least
    ~4 samples per symbol.
    """

    def __init__(self, fs_in: float, offset_hz: float, min_out_rate: float, passband_hz: float):
        total = max(1, int(fs_in // min_out_rate))
        # Split the decimation so the first (wide) stage stays cheap.
        d1 = 1
        for cand in range(min(total, 32), 0, -1):
            if total % cand == 0 and total // cand <= 32:
                d1 = cand
                break
        d2 = total // d1
        self.fs_in = fs_in
        self.decim = d1 * d2
        self.fs_out = fs_in / self.decim
        self.nco = Nco(fs_in, offset_hz)

        fs1 = fs_in / d1
        stages = []
        if d1 > 1:
            # Pass the final channel; only the bands that would alias onto it
            # after decimating by d1 must be suppressed here.
            stop = max(fs1 - passband_hz, passband_hz + 100)
            stages.append(FirDecimator(lowpass_taps(passband_hz, fs_in, stop, 50), d1))
        if d2 > 1 or d1 == 1:
            stop = max(self.fs_out / 2, passband_hz + 50)
            stages.append(FirDecimator(lowpass_taps(passband_hz, fs1, stop, 60), d2))
        self.stages = stages

    @property
    def offset_hz(self) -> float:
        return self.nco.freq_hz

    @offset_hz.setter
    def offset_hz(self, value: float) -> None:
        self.nco.freq_hz = float(value)

    def process(self, x: np.ndarray) -> np.ndarray:
        y = self.nco.mix(np.asarray(x, dtype=np.complex64))
        for stage in self.stages:
            y = stage.process(y)
        return y


def resample(x: np.ndarray, fs_in: float, fs_out: float) -> np.ndarray:
    """One-shot rational resampling (for building TX bursts)."""
    if fs_in == fs_out:
        return np.asarray(x)
    ratio = Fraction(fs_out / fs_in).limit_denominator(10000)
    return signal.resample_poly(x, ratio.numerator, ratio.denominator)


def wrap_phase(x):
    return (x + np.pi) % (2 * np.pi) - np.pi
