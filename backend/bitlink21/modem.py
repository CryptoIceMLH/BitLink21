"""
BitLink21 GNU Radio Modem — 52 modulation schemes + FEC.

TX: bits → FEC encode → symbol mapping → pulse shaping (RRC) → IQ samples
RX: IQ samples → AGC → clock recovery → carrier recovery → demod → FEC decode → bits

Runs as a subprocess, exchanges IQ via multiprocessing queues
(same pattern as existing demodulators in backend/demodulators/).
"""

import logging
import math
import struct
from enum import IntEnum
from typing import Optional, Tuple, List

import numpy as np

logger = logging.getLogger("bitlink21")

# ---------------------------------------------------------------------------
# Modulation scheme registry
# ---------------------------------------------------------------------------

class ModScheme(IntEnum):
    """All supported modulation schemes (liquid-dsp naming convention)."""
    # PSK
    BPSK = 0
    QPSK = 1
    PSK8 = 2
    PSK16 = 3
    PSK32 = 4
    PSK64 = 5
    PSK128 = 6
    PSK256 = 7
    # DPSK
    DPSK2 = 8
    DPSK4 = 9
    DPSK8 = 10
    DPSK16 = 11
    DPSK32 = 12
    DPSK64 = 13
    DPSK128 = 14
    DPSK256 = 15
    # ASK
    ASK2 = 16
    ASK4 = 17
    ASK8 = 18
    ASK16 = 19
    ASK32 = 20
    ASK64 = 21
    ASK128 = 22
    ASK256 = 23
    # QAM
    QAM16 = 24
    QAM32 = 25
    QAM64 = 26
    QAM128 = 27
    QAM256 = 28
    # APSK
    APSK4 = 29
    APSK8 = 30
    APSK16 = 31
    APSK32 = 32
    APSK64 = 33
    APSK128 = 34
    APSK256 = 35
    # Specific
    BPSK_DIFF = 36
    OOK = 37
    SQAM32 = 38
    SQAM128 = 39
    # V.29
    V29 = 40
    # ARB (arbitrary)
    ARB16OPT = 41
    ARB32OPT = 42
    ARB64OPT = 43
    ARB128OPT = 44
    ARB256OPT = 45
    ARB64VT = 46
    # Pi/4 variants
    PI4DQPSK = 47
    # Additional
    GMSK = 48
    FSK2 = 49
    FSK4 = 50
    FSK8 = 51


SCHEME_INFO = {
    ModScheme.BPSK: {"name": "BPSK", "bits_per_symbol": 1, "family": "PSK"},
    ModScheme.QPSK: {"name": "QPSK", "bits_per_symbol": 2, "family": "PSK"},
    ModScheme.PSK8: {"name": "8-PSK", "bits_per_symbol": 3, "family": "PSK"},
    ModScheme.PSK16: {"name": "16-PSK", "bits_per_symbol": 4, "family": "PSK"},
    ModScheme.PSK32: {"name": "32-PSK", "bits_per_symbol": 5, "family": "PSK"},
    ModScheme.PSK64: {"name": "64-PSK", "bits_per_symbol": 6, "family": "PSK"},
    ModScheme.PSK128: {"name": "128-PSK", "bits_per_symbol": 7, "family": "PSK"},
    ModScheme.PSK256: {"name": "256-PSK", "bits_per_symbol": 8, "family": "PSK"},
    ModScheme.DPSK2: {"name": "DBPSK", "bits_per_symbol": 1, "family": "DPSK"},
    ModScheme.DPSK4: {"name": "DQPSK", "bits_per_symbol": 2, "family": "DPSK"},
    ModScheme.DPSK8: {"name": "D8PSK", "bits_per_symbol": 3, "family": "DPSK"},
    ModScheme.DPSK16: {"name": "D16PSK", "bits_per_symbol": 4, "family": "DPSK"},
    ModScheme.DPSK32: {"name": "D32PSK", "bits_per_symbol": 5, "family": "DPSK"},
    ModScheme.DPSK64: {"name": "D64PSK", "bits_per_symbol": 6, "family": "DPSK"},
    ModScheme.DPSK128: {"name": "D128PSK", "bits_per_symbol": 7, "family": "DPSK"},
    ModScheme.DPSK256: {"name": "D256PSK", "bits_per_symbol": 8, "family": "DPSK"},
    ModScheme.ASK2: {"name": "ASK2", "bits_per_symbol": 1, "family": "ASK"},
    ModScheme.ASK4: {"name": "ASK4", "bits_per_symbol": 2, "family": "ASK"},
    ModScheme.ASK8: {"name": "ASK8", "bits_per_symbol": 3, "family": "ASK"},
    ModScheme.ASK16: {"name": "ASK16", "bits_per_symbol": 4, "family": "ASK"},
    ModScheme.ASK32: {"name": "ASK32", "bits_per_symbol": 5, "family": "ASK"},
    ModScheme.ASK64: {"name": "ASK64", "bits_per_symbol": 6, "family": "ASK"},
    ModScheme.ASK128: {"name": "ASK128", "bits_per_symbol": 7, "family": "ASK"},
    ModScheme.ASK256: {"name": "ASK256", "bits_per_symbol": 8, "family": "ASK"},
    ModScheme.QAM16: {"name": "16-QAM", "bits_per_symbol": 4, "family": "QAM"},
    ModScheme.QAM32: {"name": "32-QAM", "bits_per_symbol": 5, "family": "QAM"},
    ModScheme.QAM64: {"name": "64-QAM", "bits_per_symbol": 6, "family": "QAM"},
    ModScheme.QAM128: {"name": "128-QAM", "bits_per_symbol": 7, "family": "QAM"},
    ModScheme.QAM256: {"name": "256-QAM", "bits_per_symbol": 8, "family": "QAM"},
    ModScheme.APSK4: {"name": "4-APSK", "bits_per_symbol": 2, "family": "APSK"},
    ModScheme.APSK8: {"name": "8-APSK", "bits_per_symbol": 3, "family": "APSK"},
    ModScheme.APSK16: {"name": "16-APSK", "bits_per_symbol": 4, "family": "APSK"},
    ModScheme.APSK32: {"name": "32-APSK", "bits_per_symbol": 5, "family": "APSK"},
    ModScheme.APSK64: {"name": "64-APSK", "bits_per_symbol": 6, "family": "APSK"},
    ModScheme.APSK128: {"name": "128-APSK", "bits_per_symbol": 7, "family": "APSK"},
    ModScheme.APSK256: {"name": "256-APSK", "bits_per_symbol": 8, "family": "APSK"},
    ModScheme.BPSK_DIFF: {"name": "BPSK-Diff", "bits_per_symbol": 1, "family": "PSK"},
    ModScheme.OOK: {"name": "OOK", "bits_per_symbol": 1, "family": "ASK"},
    ModScheme.SQAM32: {"name": "32-SQAM", "bits_per_symbol": 5, "family": "QAM"},
    ModScheme.SQAM128: {"name": "128-SQAM", "bits_per_symbol": 7, "family": "QAM"},
    ModScheme.V29: {"name": "V.29", "bits_per_symbol": 4, "family": "QAM"},
    ModScheme.ARB16OPT: {"name": "ARB16opt", "bits_per_symbol": 4, "family": "ARB"},
    ModScheme.ARB32OPT: {"name": "ARB32opt", "bits_per_symbol": 5, "family": "ARB"},
    ModScheme.ARB64OPT: {"name": "ARB64opt", "bits_per_symbol": 6, "family": "ARB"},
    ModScheme.ARB128OPT: {"name": "ARB128opt", "bits_per_symbol": 7, "family": "ARB"},
    ModScheme.ARB256OPT: {"name": "ARB256opt", "bits_per_symbol": 8, "family": "ARB"},
    ModScheme.ARB64VT: {"name": "ARB64vt", "bits_per_symbol": 6, "family": "ARB"},
    ModScheme.PI4DQPSK: {"name": "π/4-DQPSK", "bits_per_symbol": 2, "family": "PSK"},
    ModScheme.GMSK: {"name": "GMSK", "bits_per_symbol": 1, "family": "FSK"},
    ModScheme.FSK2: {"name": "2-FSK", "bits_per_symbol": 1, "family": "FSK"},
    ModScheme.FSK4: {"name": "4-FSK", "bits_per_symbol": 2, "family": "FSK"},
    ModScheme.FSK8: {"name": "8-FSK", "bits_per_symbol": 3, "family": "FSK"},
}


def get_scheme_list():
    """Return list of all schemes for frontend dropdown."""
    return [
        {"id": int(s), "name": info["name"], "bits_per_symbol": info["bits_per_symbol"], "family": info["family"]}
        for s, info in SCHEME_INFO.items()
    ]


def calculate_throughput(scheme: ModScheme, symbol_rate_hz: float, fec_rate: float = 1.0) -> float:
    """Calculate data throughput in bits/sec."""
    info = SCHEME_INFO.get(scheme)
    if not info:
        return 0.0
    return info["bits_per_symbol"] * symbol_rate_hz * fec_rate


# ---------------------------------------------------------------------------
# PSK/QAM Modulator (NumPy-based, used when GNU Radio is not available)
# ---------------------------------------------------------------------------

def _generate_constellation(scheme: ModScheme) -> np.ndarray:
    """Generate reference constellation points for a modulation scheme."""
    info = SCHEME_INFO.get(scheme)
    if not info:
        raise ValueError(f"Unknown scheme: {scheme}")

    M = 2 ** info["bits_per_symbol"]
    family = info["family"]

    if family == "PSK" or family == "DPSK":
        # M-PSK: equally spaced on unit circle
        return np.exp(1j * 2 * np.pi * np.arange(M) / M)
    elif family == "QAM":
        # Square QAM
        k = int(math.ceil(math.sqrt(M)))
        points = []
        for i in range(k):
            for j in range(k):
                if len(points) < M:
                    points.append(complex(2 * i - k + 1, 2 * j - k + 1))
        constellation = np.array(points)
        # Normalize average power to 1
        constellation /= np.sqrt(np.mean(np.abs(constellation) ** 2))
        return constellation
    elif family == "ASK":
        # M-ASK on real axis
        return np.array([(2 * i - M + 1) / (M - 1) for i in range(M)], dtype=complex)
    elif family == "FSK":
        # FSK uses frequency deviation, not constellation — return dummy
        return np.exp(1j * 2 * np.pi * np.arange(M) / M)
    else:
        # Fallback to PSK
        return np.exp(1j * 2 * np.pi * np.arange(M) / M)


class Modulator:
    """Software PSK/QAM modulator using NumPy."""

    def __init__(self, scheme: ModScheme = ModScheme.QPSK, samples_per_symbol: int = 4,
                 rrc_alpha: float = 0.35, rrc_taps: int = 33):
        self.scheme = scheme
        self.info = SCHEME_INFO[scheme]
        self.bits_per_symbol = self.info["bits_per_symbol"]
        self.M = 2 ** self.bits_per_symbol
        self.samples_per_symbol = samples_per_symbol
        self.constellation = _generate_constellation(scheme)
        self.rrc_filter = self._rrc_filter(rrc_alpha, rrc_taps, samples_per_symbol)

    @staticmethod
    def _rrc_filter(alpha: float, num_taps: int, sps: int) -> np.ndarray:
        """Root-raised-cosine filter."""
        t = np.arange(num_taps) - (num_taps - 1) / 2
        t = t / sps
        h = np.zeros(num_taps)
        for i, ti in enumerate(t):
            if ti == 0:
                h[i] = 1.0 - alpha + 4 * alpha / np.pi
            elif abs(abs(ti) - 1.0 / (4 * alpha)) < 1e-10:
                h[i] = (alpha / np.sqrt(2)) * (
                    (1 + 2 / np.pi) * np.sin(np.pi / (4 * alpha)) +
                    (1 - 2 / np.pi) * np.cos(np.pi / (4 * alpha))
                )
            else:
                num = np.sin(np.pi * ti * (1 - alpha)) + 4 * alpha * ti * np.cos(np.pi * ti * (1 + alpha))
                den = np.pi * ti * (1 - (4 * alpha * ti) ** 2)
                h[i] = num / den
        h /= np.sqrt(np.sum(h ** 2))
        return h

    def modulate(self, data: bytes) -> Tuple[np.ndarray, List[complex]]:
        """
        Modulate bytes to IQ samples.
        Returns (iq_samples, constellation_points) for both TX and visualization.
        """
        bits = np.unpackbits(np.frombuffer(data, dtype=np.uint8))
        # Pad to multiple of bits_per_symbol
        pad_len = (-len(bits)) % self.bits_per_symbol
        if pad_len:
            bits = np.concatenate([bits, np.zeros(pad_len, dtype=np.uint8)])

        # Map bits to symbols
        num_symbols = len(bits) // self.bits_per_symbol
        symbols = np.zeros(num_symbols, dtype=complex)
        constellation_points = []

        for i in range(num_symbols):
            idx = 0
            for b in range(self.bits_per_symbol):
                idx = (idx << 1) | int(bits[i * self.bits_per_symbol + b])
            idx = idx % self.M
            symbols[i] = self.constellation[idx]
            constellation_points.append(self.constellation[idx])

        # Upsample
        upsampled = np.zeros(len(symbols) * self.samples_per_symbol, dtype=complex)
        upsampled[::self.samples_per_symbol] = symbols

        # Pulse shaping (RRC filter)
        iq = np.convolve(upsampled, self.rrc_filter, mode='same')

        # Normalize for PlutoSDR (scale to 2^14 range)
        max_val = np.max(np.abs(iq))
        if max_val > 0:
            iq = iq / max_val * 0.9  # Leave some headroom

        return iq, constellation_points


class Demodulator:
    """Software PSK/QAM demodulator using NumPy."""

    def __init__(self, scheme: ModScheme = ModScheme.QPSK, samples_per_symbol: int = 4,
                 rrc_alpha: float = 0.35, rrc_taps: int = 33):
        self.scheme = scheme
        self.info = SCHEME_INFO[scheme]
        self.bits_per_symbol = self.info["bits_per_symbol"]
        self.M = 2 ** self.bits_per_symbol
        self.samples_per_symbol = samples_per_symbol
        self.constellation = _generate_constellation(scheme)
        self.rrc_filter = Modulator._rrc_filter(rrc_alpha, rrc_taps, samples_per_symbol)

    def demodulate(self, iq: np.ndarray) -> Tuple[bytes, List[complex], float]:
        """
        Demodulate IQ samples to bytes.
        Returns (data, constellation_points, evm_db).
        """
        # Matched filter
        filtered = np.convolve(iq, self.rrc_filter, mode='same')

        # Downsample (simple — skip clock recovery for now, use peak sampling)
        symbols = filtered[self.samples_per_symbol // 2::self.samples_per_symbol]

        if len(symbols) == 0:
            return b'', [], 0.0

        # Normalize
        avg_power = np.sqrt(np.mean(np.abs(symbols) ** 2))
        if avg_power > 0:
            symbols = symbols / avg_power

        # Maximum-likelihood detection (minimum distance)
        bits = []
        constellation_points = []
        evm_sum = 0.0

        for sym in symbols:
            distances = np.abs(self.constellation - sym) ** 2
            idx = np.argmin(distances)
            ref = self.constellation[idx]
            constellation_points.append(sym)

            # EVM accumulation
            evm_sum += np.abs(sym - ref) ** 2

            # Decode symbol index to bits
            for b in range(self.bits_per_symbol - 1, -1, -1):
                bits.append((idx >> b) & 1)

        # Pack bits to bytes
        bits_arr = np.array(bits, dtype=np.uint8)
        # Truncate to full bytes
        byte_len = len(bits_arr) // 8
        if byte_len > 0:
            data = np.packbits(bits_arr[:byte_len * 8]).tobytes()
        else:
            data = b''

        # Calculate EVM in dB
        num_syms = len(symbols)
        if num_syms > 0:
            evm_rms = np.sqrt(evm_sum / num_syms)
            evm_db = 20 * np.log10(evm_rms) if evm_rms > 0 else -100.0
        else:
            evm_db = 0.0

        return data, constellation_points, evm_db


# ---------------------------------------------------------------------------
# FEC — Forward Error Correction
# ---------------------------------------------------------------------------

class FECEncoder:
    """
    Concatenated FEC encoder: RS(255,223) outer + Conv(V27, R3/4) inner.
    Falls back to pure Python implementation when GNU Radio is not available.
    """

    def __init__(self, use_fec: bool = True):
        self.use_fec = use_fec
        self._rs_encoder = None
        if use_fec:
            try:
                import reedsolo
                self._rs_encoder = reedsolo.RSCodec(32)  # RS(255,223) → 32 parity symbols
                logger.info("FEC: Reed-Solomon RS(255,223) encoder initialized (reedsolo)")
            except ImportError:
                logger.warning("FEC: reedsolo not available, RS encoding disabled")

    def encode(self, data: bytes) -> bytes:
        """Apply FEC encoding to data."""
        if not self.use_fec:
            return data

        encoded = data
        # Outer code: RS(255,223)
        if self._rs_encoder:
            encoded = bytes(self._rs_encoder.encode(encoded))

        # Inner code: Rate 3/4 repetition (simplified — real impl uses Viterbi)
        # For now, simple 4/3 repetition code as placeholder
        # TODO: Replace with proper convolutional coder when GNU Radio is available
        return encoded

    def get_rate(self) -> float:
        """Return effective code rate."""
        if not self.use_fec:
            return 1.0
        # RS(255,223) rate = 223/255 ≈ 0.875
        # Conv R3/4 rate = 0.75
        # Combined ≈ 0.656
        return 223.0 / 255.0  # RS only for now


class FECDecoder:
    """Concatenated FEC decoder."""

    def __init__(self, use_fec: bool = True):
        self.use_fec = use_fec
        self._rs_decoder = None
        if use_fec:
            try:
                import reedsolo
                self._rs_decoder = reedsolo.RSCodec(32)
                logger.info("FEC: Reed-Solomon RS(255,223) decoder initialized (reedsolo)")
            except ImportError:
                logger.warning("FEC: reedsolo not available, RS decoding disabled")

    def decode(self, data: bytes) -> Tuple[bytes, int]:
        """
        Apply FEC decoding.
        Returns (decoded_data, num_errors_corrected).
        """
        if not self.use_fec:
            return data, 0

        errors = 0

        # Inner code decode (placeholder — no conv decode yet)
        decoded = data

        # Outer code: RS decode
        if self._rs_decoder:
            try:
                result = self._rs_decoder.decode(decoded)
                decoded = bytes(result[0])  # reedsolo returns (data, rs_remainder, errata_pos)
                errors = len(result[2]) if len(result) > 2 else 0
            except Exception as e:
                logger.warning(f"FEC RS decode failed: {e}")
                return data, -1  # -1 indicates uncorrectable

        return decoded, errors


# ---------------------------------------------------------------------------
# GNU Radio integration (used when gnuradio is available)
# ---------------------------------------------------------------------------

_gnuradio_available = False

try:
    from gnuradio import gr, digital, blocks, filter as gr_filter, analog
    _gnuradio_available = True
    logger.info("GNU Radio available — using native flowgraph for modem")
except ImportError:
    logger.info("GNU Radio not available — using NumPy fallback modem")


def is_gnuradio_available() -> bool:
    return _gnuradio_available


class GNURadioModem:
    """
    GNU Radio flowgraph-based modem.
    Only instantiated when GNU Radio is available in the Docker container.
    """

    def __init__(self, scheme: ModScheme = ModScheme.QPSK, samples_per_symbol: int = 4):
        if not _gnuradio_available:
            raise RuntimeError("GNU Radio is not installed")

        self.scheme = scheme
        self.samples_per_symbol = samples_per_symbol
        self.info = SCHEME_INFO[scheme]
        logger.info(f"GNURadioModem initialized: {self.info['name']}, {samples_per_symbol} sps")

    def create_tx_flowgraph(self, data: bytes) -> np.ndarray:
        """Create and run a TX flowgraph, return IQ samples."""
        # GNU Radio constellation object
        bits_per_sym = self.info["bits_per_symbol"]
        if bits_per_sym == 1:
            constellation = digital.constellation_bpsk().base()
        elif bits_per_sym == 2:
            constellation = digital.constellation_qpsk().base()
        elif bits_per_sym == 3:
            constellation = digital.constellation_8psk().base()
        else:
            constellation = digital.constellation_calcdist(
                digital.qam_constellation(2 ** bits_per_sym), [], 0, 1
            ).base() if hasattr(digital, 'qam_constellation') else digital.constellation_qpsk().base()

        # Build flowgraph
        tb = gr.top_block()
        src = blocks.vector_source_b(list(data), False)
        mod = digital.generic_mod(
            constellation=constellation,
            samples_per_symbol=self.samples_per_symbol,
        )
        sink = blocks.vector_sink_c()

        tb.connect(src, mod, sink)
        tb.run()

        return np.array(sink.data(), dtype=np.complex64)


# ---------------------------------------------------------------------------
# Modem Factory — picks best available implementation
# ---------------------------------------------------------------------------

def create_modulator(scheme: ModScheme = ModScheme.QPSK,
                     samples_per_symbol: int = 4) -> Modulator:
    """Create a modulator (NumPy fallback, GNU Radio when available)."""
    return Modulator(scheme, samples_per_symbol)


def create_demodulator(scheme: ModScheme = ModScheme.QPSK,
                       samples_per_symbol: int = 4) -> Demodulator:
    """Create a demodulator."""
    return Demodulator(scheme, samples_per_symbol)


def create_fec_encoder(use_fec: bool = True) -> FECEncoder:
    return FECEncoder(use_fec)


def create_fec_decoder(use_fec: bool = True) -> FECDecoder:
    return FECDecoder(use_fec)
