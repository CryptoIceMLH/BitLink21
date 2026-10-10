"""Dish alignment meter on the QO-100 narrowband PSK beacon (10489.750 MHz).

Measured on a live capture (2026-10-10): the beacon is split-phase coded
BPSK, 400 bit/s = 800 chips/s; 99 % of its power lies within +-700 Hz with a
dip at the centre, and its 10 kHz slot is empty from 1.5 to 4.5 kHz each
side. So, like a satellite meter:

- C/N0 from channel power: all power within +-750 Hz minus the noise
  density from the empty guard bands. The data cannot change total power,
  so this is steady (0.4 dB per 65 ms block live, ~0.3 dB smoothed), where a
  peak or narrow-band reading jumps by 2+ dB with the modulation.
- MER after demodulating the 800 chip/s BPSK (every 0.5 s): link quality,
  also shows interference or LNB phase noise that a power reading misses.

The meter follows the beacon tracker's frequency every block.
"""

from fractions import Fraction
from typing import Optional

import numpy as np
from scipy import signal

from .dsp import ChannelSelector

FULL_SCALE = 2048.0          # Pluto 12-bit samples
HALF_BW_HZ = 750.0           # beacon channel (99 % of its power within +-700 Hz)
NOISE_BAND_HZ = (1500.0, 4500.0)
CHIP_RATE = 800.0
SLOT_HZ = 4800.0             # spectrum shown: +-4.8 kHz around the beacon
SPECTRUM_BINS = 96
EMIT_S = 0.05              # every SDR block (~15/s at 1 MS/s)
MER_S = 0.5
SMOOTH = 0.35                # per-block EMA on powers (~0.15 s at 65 ms blocks)


def _db(v: float) -> float:
    return float(10 * np.log10(max(v, 1e-30)))


class AlignmentMeter:
    def __init__(self, fs_in: float, centre_hz: float):
        # 12.5 kHz out: 1 MS/s -> 80 = 16 x 5 and 0.6 MS/s -> 48 = 16 x 3,
        # two cheap filter stages (a prime decimation would cost ~10x more)
        self.channel = ChannelSelector(fs_in, centre_hz, min_out_rate=12500, passband_hz=5000)
        self.fs = self.channel.fs_out
        fr = Fraction(CHIP_RATE * 8 / self.fs).limit_denominator(1000)
        self._up, self._down = fr.numerator, fr.denominator
        self._c: Optional[float] = None
        self._n0: Optional[float] = None
        self._psd: Optional[np.ndarray] = None
        self._mer_buf = np.zeros(0, np.complex64)
        self.mer_db: Optional[float] = None
        self._t = 0.0
        self._last_emit = -1.0
        self._last_mer = 0.0

    def set_centre(self, centre_hz: float) -> None:
        if abs(centre_hz - self.channel.offset_hz) > 0.5:
            self.channel.offset_hz = centre_hz  # phase-continuous mixer

    def process(self, iq: np.ndarray, fs_in: float) -> Optional[dict]:
        """Feed one SDR block; returns a reading every EMIT_S."""
        self._t += len(iq) / fs_in
        y = self.channel.process(iq)
        if len(y) < 64:
            return None
        f, p = signal.welch(y, fs=self.fs, nperseg=min(256, len(y)), return_onesided=False, detrend=False)
        f, p = np.fft.fftshift(f), np.fft.fftshift(p)
        df = f[1] - f[0]
        noise = (np.abs(f) > NOISE_BAND_HZ[0]) & (np.abs(f) < NOISE_BAND_HZ[1])
        n0 = float(np.median(p[noise])) + 1e-30
        inband = np.abs(f) <= HALF_BW_HZ
        c = max(float(p[inband].sum() * df - n0 * inband.sum() * df), 0.0)
        a = SMOOTH
        self._c = c if self._c is None else self._c + a * (c - self._c)
        self._n0 = n0 if self._n0 is None else self._n0 + a * (n0 - self._n0)
        self._psd = p if self._psd is None or len(self._psd) != len(p) else self._psd + 0.5 * (p - self._psd)
        self._freqs = f

        self._mer_buf = np.concatenate([self._mer_buf, y])[-int(self.fs * MER_S):]
        if self._t - self._last_mer >= MER_S and len(self._mer_buf) >= int(self.fs * MER_S) - 1:
            self._last_mer = self._t
            mer = self._mer(self._mer_buf)
            # one 0.5 s MER varies ~1 dB: smooth over a few
            self.mer_db = mer if mer is None or self.mer_db is None else self.mer_db + 0.4 * (mer - self.mer_db)

        if self._t - self._last_emit < EMIT_S:
            return None
        self._last_emit = self._t
        return self.reading()

    def reading(self) -> dict:
        c, n0 = self._c or 0.0, self._n0 or 1e-30
        cn0 = _db(c / n0) if c > 0 else None
        sel = np.abs(self._freqs) <= SLOT_HZ
        spec = self._psd[sel] / n0
        # fixed bins over +-SLOT_HZ, in 0.5 dB steps above the noise (0..80 = 0..40 dB)
        edges = np.linspace(-SLOT_HZ, SLOT_HZ, SPECTRUM_BINS + 1)
        idx = np.clip(np.searchsorted(edges, self._freqs[sel]) - 1, 0, SPECTRUM_BINS - 1)
        bins = np.zeros(SPECTRUM_BINS)
        np.maximum.at(bins, idx, spec)
        bins = np.clip(np.round(2 * 10 * np.log10(np.maximum(bins, 1e-3))), 0, 80).astype(int)
        return {
            "cn0_dbhz": None if cn0 is None else round(cn0, 2),
            "cn_db": None if cn0 is None else round(float(cn0 - 10 * np.log10(2 * HALF_BW_HZ)), 2),
            "mer_db": None if self.mer_db is None else round(self.mer_db, 1),
            "beacon_dbfs": round(_db(c / FULL_SCALE ** 2), 1) if c > 0 else None,
            "noise_dbfs_hz": round(_db(n0 / FULL_SCALE ** 2), 1),
            "spectrum": bins.tolist(),
            "spectrum_span_hz": SLOT_HZ,
        }

    def _mer(self, z: np.ndarray) -> Optional[float]:
        """MER of the 800 chip/s BPSK: squaring for the carrier, envelope
        line for chip timing, phase per 40 chips."""
        sps = 8
        u = signal.resample_poly(z.astype(np.complex128), self._up, self._down)
        fs_s = CHIP_RATE * sps
        n = 1 << (int(np.ceil(np.log2(len(u)))) + 2)
        sq = np.abs(np.fft.fft(u ** 2 * np.hanning(len(u)), n))
        fq = np.fft.fftfreq(n, 1 / fs_s)
        near = np.abs(fq) < 150  # tracker keeps the beacon within a few Hz
        if not near.any() or sq[near].max() < 8 * np.median(sq):
            return None  # no beacon to demodulate
        u = u * np.exp(-1j * np.pi * fq[near][np.argmax(sq[near])] * np.arange(len(u)) / fs_s)
        m = np.convolve(u, np.ones(sps) / sps, mode="same")
        e = np.abs(m) ** 2
        ph = np.angle(np.sum(e * np.exp(-2j * np.pi * np.arange(len(e)) / sps)))
        t0 = (-ph / (2 * np.pi)) * sps % sps
        idx = t0 + np.arange(int((len(m) - sps - 2 - t0) / sps)) * sps
        i0 = idx.astype(int)
        mu = idx - i0
        s = ((1 - mu) * m[i0] + mu * m[i0 + 1])[20:-20]
        L = 40
        nch = len(s) // L
        if nch < 2:
            return None
        s = s[: nch * L].reshape(nch, L)
        phs = np.unwrap(np.angle(np.sum(s ** 2, axis=1))) / 2
        s = (s * np.exp(-1j * phs)[:, None]).reshape(-1)
        amp = np.mean(np.abs(s.real))
        d = np.sign(s.real) * amp
        return _db(np.mean(np.abs(d) ** 2) / np.mean(np.abs(s - d) ** 2))
