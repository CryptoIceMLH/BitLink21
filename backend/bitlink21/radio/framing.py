"""HSModem on-air frame format.

Bit-exact port of hsmodem's frame_packer.cpp / constellation.cpp /
scrambler.cpp / crc16.cpp / fec.cpp (DJ0ABR, GPL-2.0-or-later).

On-air block (258 bytes, a multiple of 2 and 3 so QPSK/8APSK symbols align):

    +--------+-----------------------------------------------+
    | header |  RS(255,223) codeword, XOR-scrambled          |
    | 3 B    |  223 B data + 32 B parity                     |
    +--------+-----------------------------------------------+

The 223 data bytes are:

    counter_lsb (1) | status (1) | payload (219) | crc16 msb, lsb (2)

status: bits 0-3 frame type, bits 4-5 first/next/last/single,
        bits 6-7 frame counter bits 8-9.

The CRC is CRC-16/MCRF4XX (reflected 0x1021, init 0xFFFF, no final XOR)
over counter + status + payload. RS is over GF(2^8) with field polynomial
0x187, first consecutive root 120, generator alpha=2 (Schifra settings).
"""

from dataclasses import dataclass
from typing import Optional

import numpy as np
import reedsolo

HEADER = bytes([0x53, 0xE1, 0xA6])
HEADER_LEN = 3
FEC_BLOCK_LEN = 255
FEC_LEN = 32
BLOCK_LEN = HEADER_LEN + FEC_BLOCK_LEN  # 258
PAYLOAD_LEN = FEC_BLOCK_LEN - FEC_LEN - 2 - 2  # 219
DATA_LEN = FEC_BLOCK_LEN - FEC_LEN  # 223

# Frame status (first/next/last/single), as used by oscardata.
STATUS_FIRST = 0
STATUS_NEXT = 1
STATUS_LAST = 2
STATUS_SINGLE = 3

# Frame types sent over the air (oscardata "statics").
TYPE_BER_TEST = 1
TYPE_IMAGE = 2
TYPE_ASCII_FILE = 3
TYPE_HTML_FILE = 4
TYPE_BINARY_FILE = 5
TYPE_AUDIO = 6
TYPE_USERINFO = 7
TYPE_EXTERNAL = 8

SCRAMBLER = np.array(
    [130, 239, 223, 19, 146, 254, 12, 86, 106, 68,
     77, 213, 243, 216, 102, 227, 108, 113, 229, 89,
     26, 64, 138, 216, 225, 121, 194, 137, 152, 64,
     51, 175, 68, 200, 37, 104, 247, 68, 193, 50,
     19, 14, 196, 81, 4, 236, 191, 249, 83, 25,
     161, 171, 167, 29, 33, 139, 7, 152, 230, 144,
     125, 206, 34, 236, 112, 78, 219, 34, 181, 161,
     7, 45, 198, 235, 62, 115, 194, 100, 209, 95,
     186, 161, 53, 10, 110, 246, 122, 246, 207, 194,
     178, 63, 232, 93, 158, 234, 231, 73, 214, 64] * 3,
    dtype=np.uint8,
)[:FEC_BLOCK_LEN]

_RS = reedsolo.RSCodec(nsym=FEC_LEN, nsize=FEC_BLOCK_LEN, fcr=120,
                       prim=0x187, generator=2, c_exp=8)


# ----------------------------------------------------------------------------
# CRC-16/MCRF4XX
# ----------------------------------------------------------------------------

def _make_crc_table() -> np.ndarray:
    table = np.zeros(256, dtype=np.uint16)
    for i in range(256):
        reg = i
        for _ in range(8):
            reg = (reg >> 1) ^ 0x8408 if reg & 1 else reg >> 1
        table[i] = reg
    return table


_CRC_TABLE = _make_crc_table()


def crc16(data: bytes) -> int:
    reg = 0xFFFF
    for b in data:
        reg = (reg >> 8) ^ int(_CRC_TABLE[(reg ^ b) & 0xFF])
    return reg


# ----------------------------------------------------------------------------
# Constellations
#
# Symbol *values* are what the frame bits map to (MSB first). Each table maps
# value -> complex point. For every modulation a rotation by one step of the
# rotational symmetry maps value v to ROTATE[v], matching hsmodem's
# rotate*syms() tables, so a receiver with an unknown carrier phase can try
# every rotation.
# ----------------------------------------------------------------------------

# 8APSK (liquid-dsp APSK8: one centre point + 7 on a ring). Point index p has
# symbol value APSK8_SYM_MAP[p]; ring points are at angle 2*pi*(p-1)/7.
APSK8_SYM_MAP = [0b000, 0b100, 0b001, 0b011, 0b010, 0b110, 0b111, 0b101]
_APSK8_RING = np.sqrt(8 / 7)


def _points_8apsk() -> np.ndarray:
    pts = np.zeros(8, dtype=np.complex64)
    for p, value in enumerate(APSK8_SYM_MAP):
        pts[value] = 0 if p == 0 else _APSK8_RING * np.exp(2j * np.pi * (p - 1) / 7)
    return pts


CONSTELLATIONS = {
    "bpsk": np.array([1, -1], dtype=np.complex64),
    # Natural (non-Gray) order: hsmodem pre-applies s ^= s >> 1 before
    # liquid's Gray-coded QPSK mapper, so value v ends up at 45 + 90*v degrees.
    "qpsk": np.exp(1j * (np.pi / 4 + np.pi / 2 * np.arange(4))).astype(np.complex64),
    "8apsk": _points_8apsk(),
}

# Rotational symmetry used by the carrier loop and the ambiguity search.
SYMMETRY = {"bpsk": 2, "qpsk": 4, "8apsk": 7}

BITS_PER_SYMBOL = {"bpsk": 1, "qpsk": 2, "8apsk": 3}


def symbols_per_block(modulation: str) -> int:
    return BLOCK_LEN * 8 // BITS_PER_SYMBOL[modulation]


def bytes_to_symbols(data: bytes, modulation: str) -> np.ndarray:
    """Split bytes into symbol values, MSB first."""
    bps = BITS_PER_SYMBOL[modulation]
    bits = np.unpackbits(np.frombuffer(bytes(data), dtype=np.uint8))
    if len(bits) % bps:
        raise ValueError(f"{len(data)} bytes do not fit whole {modulation} symbols")
    groups = bits.reshape(-1, bps)
    weights = 1 << np.arange(bps - 1, -1, -1)
    return (groups * weights).sum(axis=1).astype(np.uint8)


def symbols_to_bytes(values: np.ndarray, modulation: str) -> bytes:
    bps = BITS_PER_SYMBOL[modulation]
    values = np.asarray(values, dtype=np.uint8)
    bits = ((values[:, None] >> np.arange(bps - 1, -1, -1)) & 1).astype(np.uint8)
    return np.packbits(bits.reshape(-1)).tobytes()


def map_symbols(values: np.ndarray, modulation: str) -> np.ndarray:
    return CONSTELLATIONS[modulation][np.asarray(values, dtype=np.intp)]


def decide(symbols: np.ndarray, modulation: str) -> np.ndarray:
    """Hard decision: nearest constellation point -> symbol value."""
    pts = CONSTELLATIONS[modulation]
    d = np.abs(np.asarray(symbols)[:, None] - pts[None, :])
    return np.argmin(d, axis=1).astype(np.uint8)


# ----------------------------------------------------------------------------
# Frame packing
# ----------------------------------------------------------------------------

@dataclass
class Frame:
    frame_type: int
    status: int
    counter: int
    payload: bytes  # always PAYLOAD_LEN bytes

    @property
    def is_first(self) -> bool:
        return self.status in (STATUS_FIRST, STATUS_SINGLE)

    @property
    def is_last(self) -> bool:
        return self.status in (STATUS_LAST, STATUS_SINGLE)


def pack_frame(payload: bytes, frame_type: int, status: int, counter: int) -> bytes:
    """Build one 258-byte on-air block (header + scrambled RS codeword)."""
    if len(payload) > PAYLOAD_LEN:
        raise ValueError(f"payload is {len(payload)} bytes, max {PAYLOAD_LEN}")
    payload = bytes(payload).ljust(PAYLOAD_LEN, b"\x00")
    counter &= 0x3FF
    status_byte = ((counter >> 8) << 6) | ((status & 0x03) << 4) | (frame_type & 0x0F)
    body = bytes([counter & 0xFF, status_byte]) + payload
    crc = crc16(body)
    data = body + bytes([crc >> 8, crc & 0xFF])
    codeword = np.frombuffer(bytes(_RS.encode(data)), dtype=np.uint8)
    return HEADER + (codeword ^ SCRAMBLER).tobytes()


def unpack_block(block: bytes) -> Optional[Frame]:
    """Decode one 258-byte block. Returns None if RS or CRC fails."""
    if len(block) != BLOCK_LEN:
        return None
    codeword = np.frombuffer(block[HEADER_LEN:], dtype=np.uint8) ^ SCRAMBLER
    try:
        data = bytes(_RS.decode(codeword.tobytes())[0])
    except reedsolo.ReedSolomonError:
        return None
    body, rx_crc = data[:-2], (data[-2] << 8) | data[-1]
    if crc16(body) != rx_crc:
        return None
    status_byte = body[1]
    return Frame(
        frame_type=status_byte & 0x0F,
        status=(status_byte >> 4) & 0x03,
        counter=((status_byte >> 6) << 8) | body[0],
        payload=body[2:],
    )


def block_to_symbols(block: bytes, modulation: str) -> np.ndarray:
    return bytes_to_symbols(block, modulation)


# ----------------------------------------------------------------------------
# Header search with phase ambiguity
# ----------------------------------------------------------------------------

class HeaderSearch:
    """Finds the 3-byte header in a stream of complex symbols.

    The carrier loop leaves an ambiguity of k * 2*pi/SYMMETRY, and the
    spectrum may be mirrored (conjugated) depending on the LNB/mixer chain.
    Every combination is tried; a hit gives the hypothesis to de-rotate the
    whole frame with before converting to bytes.
    """

    def __init__(self, modulation: str, max_errors: Optional[int] = None):
        self.modulation = modulation
        self.symmetry = SYMMETRY[modulation]
        self.header_values = bytes_to_symbols(HEADER, modulation)
        self.header_len = len(self.header_values)
        if max_errors is None:
            # 24 BPSK / 12 QPSK / 8 8APSK header symbols
            max_errors = {"bpsk": 4, "qpsk": 2, "8apsk": 2}[modulation]
        self.max_errors = max_errors
        self.hypotheses = [(k, conj) for conj in (False, True) for k in range(self.symmetry)]

    def derotate(self, symbols: np.ndarray, hypothesis) -> np.ndarray:
        k, conj = hypothesis
        out = symbols * np.exp(-2j * np.pi * k / self.symmetry)
        return np.conj(out) if conj else out

    def find(self, symbols: np.ndarray, hypotheses=None):
        """Yield (index, hypothesis, errors) for every header candidate."""
        if len(symbols) < self.header_len:
            return
        from numpy.lib.stride_tricks import sliding_window_view

        for hyp in hypotheses or self.hypotheses:
            values = decide(self.derotate(symbols, hyp), self.modulation)
            windows = sliding_window_view(values, self.header_len)
            errors = (windows != self.header_values).sum(axis=1)
            for idx in np.nonzero(errors <= self.max_errors)[0]:
                yield int(idx), hyp, int(errors[idx])
