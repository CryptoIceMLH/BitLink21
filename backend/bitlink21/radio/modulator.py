"""HSModem-compatible modulator: on-air blocks -> complex baseband IQ."""

from typing import Iterable

import numpy as np
from scipy import signal

from . import framing
from .dsp import resample, rrc_taps
from .modes import RRC_ROLLOFF, SpeedMode


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
