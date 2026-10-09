"""HSModem-compatible modulator: on-air blocks -> complex baseband IQ."""

from fractions import Fraction
from math import gcd
from typing import Iterable

import numpy as np
from scipy import signal

from . import framing
from .dsp import resample, rrc_taps
from .modes import RRC_ROLLOFF, SpeedMode


class SymbolStream:
    """Pulse-shaped, resampled and frequency-shifted IQ from a symbol
    sequence, produced piece by piece.

    A whole file at a slow speed is far too big to build in memory (200 kB at
    BPSK 1200 is ~22 min, ~6 GB of IQ at 0.6 MS/s), so the burst is
    synthesised in overlapping windows of symbols: each window carries
    MARGIN extra symbols on both sides for the RRC and resampler filters and
    only its exact middle is kept. Window starts are aligned so every piece
    lands on whole output samples, so the joined stream is continuous.

    Iterate to get complex64 chunks; ``total_samples`` is known up front.
    The level is fixed (not normalised per burst): ``scale`` maps the
    typical peak to ~0.9.
    """

    MARGIN = 64        # symbols of filter history on each side
    TARGET_SEG_S = 2.0  # seconds of signal per window

    def __init__(self, symbols: np.ndarray, symbol_rate: float, sps: int, rolloff: float,
                 fs_out: float, offset_hz: float = 0.0, span_symbols: int = 30):
        self.symbols = np.asarray(symbols, dtype=np.complex64)
        self.symbol_rate = float(symbol_rate)
        self.fs_out = float(fs_out)
        self.offset_hz = float(offset_hz)
        self.sps = int(sps)
        self.taps = (rrc_taps(self.sps, rolloff, span_symbols=span_symbols) * np.sqrt(self.sps)).astype(np.float32)
        ratio = Fraction(self.fs_out / (self.symbol_rate * self.sps)).limit_denominator(10000)
        self.up, self.down = ratio.numerator, ratio.denominator
        # Symbols per alignment step: a window offset of q symbols is a whole
        # number of output samples
        q = self.down // gcd(self.sps * self.up, self.down)
        self.q = q
        self.margin = -(-self.MARGIN // q) * q
        self.seg = max(q, int(self.TARGET_SEG_S * self.symbol_rate) // q * q)
        self.out_per_sym = self.sps * self.up / self.down  # output samples per symbol
        n_sym = len(self.symbols)
        self.total_samples = int(round(-(-n_sym // q) * q * self.out_per_sym))
        self.scale = self._estimate_scale()

    def _window(self, a: int, b: int) -> np.ndarray:
        """Output samples for symbols [a, b) (a, b multiples of q)."""
        m = self.margin
        lo, hi = a - m, b + m
        s = self.symbols
        pad_lo = max(0, -lo)
        pad_hi = max(0, hi - len(s))
        win = s[max(lo, 0): min(hi, len(s))]
        if pad_lo or pad_hi:
            win = np.concatenate([np.zeros(pad_lo, np.complex64), win, np.zeros(pad_hi, np.complex64)])
        bb = signal.upfirdn(self.taps, win, up=self.sps)
        iq = signal.resample_poly(bb, self.up, self.down) if (self.up, self.down) != (1, 1) else bb
        k0 = int(round(m * self.out_per_sym))
        k1 = k0 + int(round((b - a) * self.out_per_sym))
        return iq[k0:k1].astype(np.complex64)

    def _estimate_scale(self) -> float:
        a = 0
        b = min(len(self.symbols), self.seg)
        b = -(-b // self.q) * self.q
        peak = float(np.max(np.abs(self._window(a, b)))) or 1.0
        return 0.9 / peak

    def __len__(self) -> int:
        return self.total_samples

    def __iter__(self):
        n_sym = -(-len(self.symbols) // self.q) * self.q
        step = 2 * np.pi * self.offset_hz / self.fs_out
        ramp = min(self.total_samples // 4, int(self.fs_out * 0.005))
        w = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, ramp)) if ramp > 0 else None
        pos = 0
        for a in range(0, n_sym, self.seg):
            b = min(a + self.seg, n_sym)
            iq = self._window(a, b) * self.scale
            if self.offset_hz:
                iq = iq * np.exp(1j * step * (pos + np.arange(len(iq)))).astype(np.complex64)
            # Short raised-cosine ramps avoid key clicks at burst start/end
            if w is not None:
                if pos < ramp:
                    k = min(ramp - pos, len(iq))
                    iq[:k] *= w[pos: pos + k]
                end = self.total_samples - ramp
                if pos + len(iq) > end:
                    k = max(0, end - pos)
                    iq[k:] *= w[::-1][max(0, pos - end): max(0, pos - end) + len(iq) - k]
            np.clip(iq.real, -1, 1, out=iq.real)
            np.clip(iq.imag, -1, 1, out=iq.imag)
            pos += len(iq)
            yield iq.astype(np.complex64)


class ModulatorStream(SymbolStream):
    """HSModem burst (same waveform as modulate_blocks), streamed."""

    def __init__(self, blocks, mode: SpeedMode, fs_out: float, offset_hz: float = 0.0,
                 lead_in_symbols: int = 0, tail_symbols: int = 32):
        blocks = list(blocks)
        values = np.concatenate([framing.block_to_symbols(b, mode.modulation) for b in blocks])
        symbols = framing.map_symbols(values, mode.modulation)
        if lead_in_symbols:
            filler = framing.bytes_to_symbols(framing.SCRAMBLER[:252].tobytes(), mode.modulation)
            lead = framing.map_symbols(np.resize(filler, lead_in_symbols), mode.modulation)
            symbols = np.concatenate([lead, symbols])
        symbols = np.concatenate([symbols, np.zeros(tail_symbols, dtype=np.complex64)])
        self.mode = mode
        super().__init__(symbols, mode.audio_rate / mode.tx_interp, mode.tx_interp, RRC_ROLLOFF, fs_out, offset_hz)


def modulate_blocks(
    blocks: Iterable[bytes],
    mode: SpeedMode,
    fs_out: float,
    offset_hz: float = 0.0,
    lead_in_symbols: int = 0,
    tail_symbols: int = 32,
) -> np.ndarray:
    """Modulate 258-byte blocks back-to-back into one continuous burst.

    The waveform is built exactly like hsmodem's TX (RRC, beta 0.2, at the
    mode's audio rate with an integer number of samples per symbol), then
    resampled to the SDR rate and shifted by offset_hz.

    Returns complex64 samples with peak magnitude 1.0.
    """
    values = np.concatenate([framing.block_to_symbols(b, mode.modulation) for b in blocks])
    symbols = framing.map_symbols(values, mode.modulation)
    if lead_in_symbols:
        # Lead-in of pseudo-random symbols (scrambler sequence, never contains
        # the header) so receivers can train AGC/timing/carrier first.
        filler = framing.bytes_to_symbols(framing.SCRAMBLER[:252].tobytes(), mode.modulation)
        lead = framing.map_symbols(np.resize(filler, lead_in_symbols), mode.modulation)
        symbols = np.concatenate([lead, symbols])
    symbols = np.concatenate([symbols, np.zeros(tail_symbols, dtype=np.complex64)])

    sps = mode.tx_interp
    taps = rrc_taps(sps, RRC_ROLLOFF, span_symbols=30)  # hsmodem uses m=15
    # Polyphase interpolation (same result as zero-stuffing + convolution,
    # ~sps times less work; a long BPSK burst took 2 s to build before)
    bb = signal.upfirdn((taps * np.sqrt(sps)).astype(np.float32), symbols.astype(np.complex64), up=sps)

    iq = resample(bb, mode.audio_rate, fs_out).astype(np.complex64)
    if offset_hz:
        # Block-wise rotation: one exp() per block instead of per sample
        step = 2 * np.pi * offset_hz / fs_out
        C = 65536
        n = len(iq)
        rows = -(-n // C)
        base = np.exp(1j * step * np.arange(C)).astype(np.complex64)
        starts = np.exp(1j * step * C * np.arange(rows)).astype(np.complex64)
        padded = np.zeros(rows * C, dtype=np.complex64)
        padded[:n] = iq
        iq = (padded.reshape(rows, C) * base[None, :] * starts[:, None]).reshape(-1)[:n]

    # Short raised-cosine ramps avoid key clicks at burst start/end.
    ramp = min(len(iq) // 4, int(fs_out * 0.005))
    if ramp > 0:
        w = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, ramp))
        iq[:ramp] *= w
        iq[-ramp:] *= w[::-1]

    peak = np.max(np.abs(iq)) or 1.0
    return (iq / peak).astype(np.complex64)
