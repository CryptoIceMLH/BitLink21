"""HyperLink: BitLink21's own fast narrowband data mode.

One fixed design for one fixed station setup (Pluto+ with a beacon-locked
receiver), in the same 2.7 kHz channel as HSModem, carrying the same
BitLink21 messages and files:

    OFDM      54 sub-carriers, 50 Hz apart (48 data + 6 pilots), 20 ms symbols
              with a 2 ms guard; brick-wall spectrum 2.7 kHz wide
    16-QAM    4 bits per data sub-carrier (Gray coded)
    LDPC      one fixed rate-2/3 code, 1920-bit blocks (1280 data bits),
              soft-decision min-sum decoding
    Pilots    every symbol: phase, drift and timing tracked by the receiver

Net rate ~5.8 kbit/s while sending data (HSModem "Fast" QPSK 4410 carries
~3.9 kbit/s after its Reed-Solomon code).

A transmission (burst):

    P1 P1   repeated-half preamble: detection + fine frequency
    P2      known symbol on all sub-carriers: exact timing + channel
    H       header (block count), BPSK, repeated
    D ...   10 OFDM symbols per LDPC block
    0       one empty symbol (flushes the receiver)

The payload is one self-checking object (name + data + CRC32), so messages
and files reach the station exactly like HSModem files do.
"""

import struct
import zlib
from functools import lru_cache
from itertools import combinations
from typing import List, Optional, Tuple

import numpy as np

from .dsp import ChannelSelector

# ------------------------------------------------------------------ waveform
SPACING_HZ = 50.0
SYMBOL_S = 1 / SPACING_HZ            # 20 ms useful part
GUARD_S = 0.002                      # cyclic prefix
HALF = 27                            # sub-carriers -27..27 without 0
CARRIERS = [k for k in range(-HALF, HALF + 1) if k != 0]
PILOTS = [-25, -15, -5, 5, 15, 25]
DATA = [k for k in CARRIERS if k not in PILOTS]
PILOT_VALUES = np.array([1, -1, 1, 1, -1, 1], dtype=np.complex64)
TX_RATE = 8000.0                     # baseband rate the burst is built at

# ------------------------------------------------------------------ coding
N_BITS = 1920
K_BITS = 1280
BLOCK_BYTES = K_BITS // 8            # 160 data bytes per block
SYMS_PER_BLOCK = N_BITS // (4 * len(DATA))  # 10 OFDM symbols per block
MAX_BLOCKS = 4095
OBJ_MAGIC = b"BL21HL\x01"

QAM_LEVELS = np.array([-3, -1, 1, 3], dtype=np.float32) / np.sqrt(10)
# Gray code per axis: bits (b0 b1) -> level index
_GRAY = {(0, 0): 0, (0, 1): 1, (1, 1): 2, (1, 0): 3}
_LEVEL_BITS = np.array([[0, 0], [0, 1], [1, 1], [1, 0]], dtype=np.uint8)  # level index -> bits


def mode_info() -> dict:
    """What the UI and airtime estimate need about the mode."""
    sym_rate = len(DATA) / (SYMBOL_S + GUARD_S)  # QAM symbols per second
    return {
        "index": HYPERLINK_MODE, "name": "HyperLink", "modulation": "ofdm-16qam",
        "bits_per_symbol": 4, "symbol_rate": sym_rate,
        "bit_rate": round(sym_rate * 4 * K_BITS / N_BITS),
        "occupied_bw_hz": len(CARRIERS) * SPACING_HZ,
    }


HYPERLINK_MODE = 10  # speed-mode index (HSModem uses 0-9)


# ------------------------------------------------------------------ LDPC
class Ldpc:
    """Fixed IRA (repeat-accumulate) LDPC code, n=1920, k=1280.

    H = [A | T]: A has 3 ones per data column (no 4-cycles), T is the
    dual-diagonal accumulator, so encoding is a running XOR."""

    def __init__(self, n: int = N_BITS, k: int = K_BITS, seed: int = 21):
        m = n - k
        self.n, self.k, self.m = n, k, m
        rng = np.random.default_rng(seed)
        target = 3 * k // m
        fill = np.zeros(m, dtype=int)
        used = {(r, r + 1) for r in range(m - 1)}  # parity accumulator pairs
        rows_of = []
        for _ in range(k):
            for _attempt in range(500):
                pool = np.flatnonzero(fill <= max(fill.min(), target - 1))
                if len(pool) < 3:
                    pool = np.argsort(fill + rng.random(m))[:12]
                rows = rng.choice(pool, 3, replace=False)
                pairs = {tuple(sorted(p)) for p in combinations(rows.tolist(), 2)}
                if not pairs & used:
                    break
            used |= pairs
            fill[rows] += 1
            rows_of.append(sorted(rows.tolist()))
        self.A = np.zeros((m, k), dtype=np.uint8)
        for c, rows in enumerate(rows_of):
            self.A[rows, c] = 1
        # check -> variable lists (data columns + parity accumulator)
        checks = []
        for r in range(m):
            v = np.flatnonzero(self.A[r]).tolist() + [k + r] + ([k + r - 1] if r else [])
            checks.append(v)
        d = max(len(c) for c in checks)
        self.cols = np.full((m, d), -1, dtype=np.int64)
        for r, c in enumerate(checks):
            self.cols[r, : len(c)] = c
        self.mask = self.cols >= 0
        self.cols_safe = np.where(self.mask, self.cols, 0)
        self.cols_valid = self.cols[self.mask]
        self._A32 = self.A.astype(np.int32)

    def encode(self, data_bits: np.ndarray) -> np.ndarray:
        t = (self._A32 @ data_bits.astype(np.int32)) & 1
        parity = np.bitwise_xor.accumulate(t.astype(np.uint8))
        return np.concatenate([data_bits.astype(np.uint8), parity])

    def decode(self, llr: np.ndarray, iterations: int = 40, alpha: float = 0.8):
        """Normalized min-sum. llr > 0 means bit 0. Returns (bits, ok)."""
        llr = llr.astype(np.float64)
        R = np.zeros(self.cols.shape)
        rows = np.arange(self.m)
        bits = (llr < 0).astype(np.uint8)
        for _ in range(iterations):
            total = llr + np.bincount(self.cols_valid, weights=R[self.mask], minlength=self.n)
            Q = total[self.cols_safe] - R
            Q[~self.mask] = 1e9
            sgn = np.where(Q < 0, -1.0, 1.0)
            prod = np.prod(sgn, axis=1, keepdims=True)
            a = np.abs(Q)
            i1 = np.argmin(a, axis=1)
            m1 = a[rows, i1]
            a[rows, i1] = np.inf
            m2 = a.min(axis=1)
            mins = np.where(np.arange(a.shape[1])[None, :] == i1[:, None], m2[:, None], m1[:, None])
            R = alpha * prod * sgn * mins
            R[~self.mask] = 0.0
            total = llr + np.bincount(self.cols_valid, weights=R[self.mask], minlength=self.n)
            bits = (total < 0).astype(np.uint8)
            synd = np.bitwise_xor.reduce(np.where(self.mask, bits[self.cols_safe], 0), axis=1)
            if not synd.any():
                return bits[: self.k], True
        return bits[: self.k], False


@lru_cache(maxsize=1)
def code() -> Ldpc:
    return Ldpc()


@lru_cache(maxsize=1)
def interleaver() -> np.ndarray:
    return np.random.default_rng(1921).permutation(N_BITS)


# ------------------------------------------------------------------ 16-QAM
_PAIR_TO_LEVEL = np.array([_GRAY[(0, 0)], _GRAY[(0, 1)], _GRAY[(1, 0)], _GRAY[(1, 1)]])


def qam_map(bits: np.ndarray) -> np.ndarray:
    b = bits.reshape(-1, 4).astype(np.int64)
    idx_i = _PAIR_TO_LEVEL[b[:, 0] * 2 + b[:, 1]]
    idx_q = _PAIR_TO_LEVEL[b[:, 2] * 2 + b[:, 3]]
    return (QAM_LEVELS[idx_i] + 1j * QAM_LEVELS[idx_q]).astype(np.complex64)


def qam_llr(z: np.ndarray) -> np.ndarray:
    """Max-log LLRs (positive = bit 0) for equalized 16-QAM symbols."""
    out = np.zeros((len(z), 4))
    for axis, vals in ((0, z.real), (2, z.imag)):
        d2 = (vals[:, None] - QAM_LEVELS[None, :]) ** 2  # distance to each level
        for b in range(2):
            ones = _LEVEL_BITS[:, b] == 1
            out[:, axis + b] = d2[:, ones].min(axis=1) - d2[:, ~ones].min(axis=1)
    return out.reshape(-1) * 10.0


# ------------------------------------------------------------------ objects
def pack_object(name: str, data: bytes) -> bytes:
    nameb = name.encode("ascii", "replace")[:255]
    return (OBJ_MAGIC + bytes([len(nameb)]) + nameb
            + struct.pack(">II", len(data), zlib.crc32(data) & 0xFFFFFFFF) + data)


def unpack_object(raw: bytes) -> Optional[Tuple[str, bytes]]:
    n = len(OBJ_MAGIC)
    if raw[:n] != OBJ_MAGIC or len(raw) < n + 1:
        return None
    ln = raw[n]
    head = n + 1 + ln + 8
    if len(raw) < head:
        return None
    size, crc = struct.unpack(">II", raw[head - 8: head])
    data = raw[head: head + size]
    if len(data) != size or zlib.crc32(data) & 0xFFFFFFFF != crc:
        return None
    return raw[n + 1: n + 1 + ln].decode("ascii", "replace"), data


def _crc8(bits: np.ndarray) -> int:
    crc = 0
    for b in bits:
        crc ^= int(b) << 7
        crc = ((crc << 1) ^ 0x07) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc


def header_bits(nblocks: int) -> np.ndarray:
    body = np.array([(nblocks >> (11 - i)) & 1 for i in range(12)] + [0, 0, 0, 1], dtype=np.uint8)
    crc = _crc8(body)
    return np.concatenate([body, np.array([(crc >> (7 - i)) & 1 for i in range(8)], dtype=np.uint8)])


def parse_header(bits: np.ndarray) -> Optional[int]:
    body, crc = bits[:16], bits[16:24]
    if _crc8(body) != int("".join(str(int(b)) for b in crc), 2) or list(body[12:16]) != [0, 0, 0, 1]:
        return None
    n = int("".join(str(int(b)) for b in body[:12]), 2)
    return n if 0 < n <= MAX_BLOCKS else None


# ------------------------------------------------------------------ symbols
def _pn(seed: int, n: int) -> np.ndarray:
    return np.where(np.random.default_rng(seed).random(n) < 0.5, -1.0, 1.0).astype(np.complex64)


@lru_cache(maxsize=1)
def preamble_values():
    p1 = {k: v for k, v in zip([k for k in CARRIERS if k % 2 == 0], _pn(7, len(CARRIERS)) * np.sqrt(2))}
    p2 = dict(zip(CARRIERS, _pn(11, len(CARRIERS))))
    return p1, p2


def _symbol_time(values: dict, fs: float) -> np.ndarray:
    """One OFDM symbol (with guard) at sample rate fs from {carrier: value}."""
    n = int(round(fs * SYMBOL_S))
    g = int(round(fs * GUARD_S))
    spec = np.zeros(n, dtype=np.complex64)
    for k, v in values.items():
        spec[k % n] = v
    t = np.fft.ifft(spec) * np.sqrt(n)
    return np.concatenate([t[-g:], t]).astype(np.complex64)


def burst(name: str, data: bytes) -> np.ndarray:
    """Complex baseband (TX_RATE) for one object, peak ~0.9."""
    obj = pack_object(name, data)
    nblocks = -(-len(obj) // BLOCK_BYTES)
    if nblocks > MAX_BLOCKS:
        raise ValueError("too large for one HyperLink transmission")
    obj = obj + b"\x00" * (nblocks * BLOCK_BYTES - len(obj))
    p1, p2 = preamble_values()
    pilots = dict(zip(PILOTS, PILOT_VALUES))
    syms = [_symbol_time(p1, TX_RATE), _symbol_time(p1, TX_RATE), _symbol_time(p2, TX_RATE)]
    hb = header_bits(nblocks)
    hb2 = np.concatenate([hb, hb])
    syms.append(_symbol_time({**pilots, **dict(zip(DATA, (1 - 2 * hb2.astype(np.float32)).astype(np.complex64)))}, TX_RATE))
    ldpc, perm = code(), interleaver()
    bits = np.unpackbits(np.frombuffer(obj, dtype=np.uint8))
    for b in range(nblocks):
        cw = ldpc.encode(bits[b * K_BITS:(b + 1) * K_BITS])[perm]
        q = qam_map(cw).reshape(SYMS_PER_BLOCK, len(DATA))
        for row in q:
            syms.append(_symbol_time({**pilots, **dict(zip(DATA, row))}, TX_RATE))
    syms.append(np.zeros_like(syms[0]))
    x = np.concatenate(syms)
    # OFDM has a high crest factor: clip the rare peaks, keep the level up
    rms = float(np.sqrt(np.mean(np.abs(x) ** 2)))
    x = x / (3.2 * rms)
    mag = np.abs(x)
    over = mag > 0.9
    x[over] *= 0.9 / mag[over]
    return x.astype(np.complex64)


def airtime_s(nbytes: int) -> float:
    blocks = -(-(nbytes + 80) // BLOCK_BYTES)
    return (5 + blocks * SYMS_PER_BLOCK) * (SYMBOL_S + GUARD_S)


# ------------------------------------------------------------------ receiver
SEARCHING, ACQUIRED, LOCKED = "searching", "acquired", "locked"


class HyperLinkReceiver:
    """Receives HyperLink bursts in the channel at ``channel_offset_hz``.

    process() returns completed objects as (name, data)."""

    CHANNEL_BW_HZ = len(CARRIERS) * SPACING_HZ
    BUSY_SNR_DB = 6.0

    def __init__(self, fs_in: float, channel_offset_hz: float = 0.0):
        self.mode = _ModeView()
        # Channel rate: an integer decimation giving a multiple of 500 Hz >= 8 kHz
        d = int(fs_in // 8000)
        while d > 1 and (fs_in / d) % 500:
            d -= 1
        self.fs = fs_in / d
        self.channel = ChannelSelector(fs_in, channel_offset_hz, min_out_rate=self.fs * (1 - 1e-9),
                                       passband_hz=self.CHANNEL_BW_HZ / 2 + 150)
        self.fs = self.channel.fs_out
        self.n = int(round(self.fs * SYMBOL_S))
        self.g = int(round(self.fs * GUARD_S))
        self.step = self.n + self.g
        self.bins = np.array([k % self.n for k in CARRIERS])
        self.data_bins = np.array([k % self.n for k in DATA])
        self.pilot_bins = np.array([k % self.n for k in PILOTS])
        self.data_idx = np.array([CARRIERS.index(k) for k in DATA])
        self.pilot_idx = np.array([CARRIERS.index(k) for k in PILOTS])
        p1, p2 = preamble_values()
        self._p2_ref = np.array([p2[k] for k in CARRIERS], dtype=np.complex64)
        self._p2_time = _symbol_time(p2, self.fs)
        self._carriers = np.array(CARRIERS, dtype=np.float64)

        self.drift_hz_s = 0.0
        self.state = SEARCHING
        self.signal_detected = False
        self.snr_db: Optional[float] = None
        self.mer_db: Optional[float] = None
        self.frames_ok = 0
        self.frames_failed = 0
        self.last_frame_at = None
        self.constellation: list = []
        self._deferred_nominal: Optional[float] = None
        self._buf = np.zeros(0, dtype=np.complex64)
        self._base = 0  # absolute index of _buf[0]
        self._reset_burst()

    # --------------------------------------------------------- control

    def _reset_burst(self):
        self.state = SEARCHING
        self._ptr = None          # absolute index of the next symbol (start of guard)
        self._cfo = 0.0           # Hz removed from the burst
        self._nco_phase = 0.0
        self._H = None
        self._nblocks = 0
        self._llrs: List[np.ndarray] = []
        self._blocks: List[bytes] = []
        self._symbols_in_block = 0
        self._block_syms: List[np.ndarray] = []
        if self._deferred_nominal is not None:
            self.set_nominal(self._deferred_nominal)

    def set_nominal(self, offset_hz: float) -> None:
        """Move the channel (beacon correction). During a burst it waits."""
        if self.state != SEARCHING:
            self._deferred_nominal = float(offset_hz)
            return
        self._deferred_nominal = None
        if abs(offset_hz - self.channel.offset_hz) >= 2.0:
            self.channel.offset_hz = float(offset_hz)

    @property
    def residual_offset_hz(self) -> float:
        return self._cfo

    def status(self) -> dict:
        return {
            "state": self.state,
            "mode": mode_info(),
            "signal_detected": bool(self.signal_detected),
            "snr_db": None if self.snr_db is None else round(float(self.snr_db), 1),
            "mer_db": None if self.mer_db is None else round(float(self.mer_db), 1),
            "offset_hz": round(float(self._cfo), 1),
            "frames_ok": int(self.frames_ok),
            "frames_failed": int(self.frames_failed),
            "last_frame_at": self.last_frame_at,
            "sps": 0.0,
        }

    def channel_occupancy_db(self) -> Optional[float]:
        x = self._buf[-int(self.fs * 0.5):]
        if len(x) < int(self.fs * 0.5):
            return None
        from scipy import signal as sps

        f, p = sps.welch(x, fs=self.fs, nperseg=min(512, len(x)), return_onesided=False, detrend=False)
        inband = np.abs(f) <= self.CHANNEL_BW_HZ / 2
        outside = (np.abs(f) > self.CHANNEL_BW_HZ / 2 + 200) & (np.abs(f) < 0.45 * self.fs)
        if not np.any(outside):
            return None
        floor = float(np.median(p[outside])) + 1e-30
        excess = float(np.mean(p[inband])) / floor - 1.0
        return round(float(10 * np.log10(excess)), 1) if excess > 0 else -99.0

    def channel_busy(self) -> bool:
        level = self.channel_occupancy_db()
        return bool(level is not None and level >= self.BUSY_SNR_DB)

    # --------------------------------------------------------- processing

    def process(self, iq: np.ndarray) -> List[Tuple[str, bytes]]:
        y = self.channel.process(iq)
        if self.state != SEARCHING and self.drift_hz_s:
            # beacon-measured drift moves our channel too
            self._cfo += self.drift_hz_s * len(iq) / self.channel.fs_in
        self._buf = np.concatenate([self._buf, y])
        out: List[Tuple[str, bytes]] = []
        while True:
            if self.state == SEARCHING:
                if not self._search():
                    break
            else:
                if not self._next_symbol(out):
                    break
        # keep the buffer bounded
        keep_from = (self._ptr - self._base) if self._ptr is not None else len(self._buf) - 6 * self.step
        keep_from = max(0, min(keep_from, len(self._buf) - 6 * self.step))
        if keep_from > 0:
            self._buf = self._buf[keep_from:]
            self._base += keep_from
        return out

    def _search(self) -> bool:
        """Look for the P1 preamble; on success set up timing and frequency."""
        L = self.n // 2
        need = 6 * self.step
        if len(self._buf) < need:
            return False
        r = self._buf
        prod = np.conj(r[:-L]) * r[L:]
        P = np.cumsum(np.concatenate([[0], prod]))
        E = np.cumsum(np.concatenate([[0], np.abs(r[L:]) ** 2]))
        span = len(prod) - L
        if span <= 0:
            return False
        Pd = P[L:L + span] - P[:span]
        Ed = E[L:L + span] - E[:span] + 1e-20
        M = np.abs(Pd) ** 2 / Ed ** 2
        k = int(np.argmax(M))
        self.signal_detected = bool(M[k] > 0.6)
        if M[k] < 0.75 or k > span - 4 * self.step:
            # nothing (or too close to the end to check): drop old samples
            drop = max(0, len(self._buf) - 5 * self.step)
            self._buf = self._buf[drop:]
            self._base += drop
            return False
        cfo = float(np.angle(Pd[k])) * self.fs / (2 * np.pi * L)
        # Exact start: correlate with the known P2 symbol after the two P1s
        t = np.arange(len(r)) / self.fs
        rc = r * np.exp(-2j * np.pi * cfo * t)
        lo = max(0, k)
        hi = min(len(rc) - self.step, k + 4 * self.step)
        if hi <= lo:
            return False
        seg = rc[lo: hi + self.step]
        c = np.abs(np.correlate(seg, self._p2_time, mode="valid"))
        j = int(np.argmax(c))
        norm = np.sqrt(np.sum(np.abs(self._p2_time) ** 2) * np.sum(np.abs(seg[j: j + self.step]) ** 2)) + 1e-20
        if c[j] / norm < 0.5:
            drop = k + self.step
            self._buf = self._buf[drop:]
            self._base += drop
            return False
        p2_start = self._base + lo + j
        self._cfo = cfo
        self._nco_phase = 2 * np.pi * cfo * p2_start / self.fs
        self._ptr = p2_start
        self.state = ACQUIRED
        self._stage = "p2"
        return True

    def _fft(self, start: int) -> Optional[np.ndarray]:
        i = start - self._base + self.g
        if i < 0 or i + self.n > len(self._buf):
            return None
        # Continuous phase: the frequency correction may change between
        # symbols, so accumulate phase instead of using absolute time
        w = 2 * np.pi * self._cfo / self.fs
        ph = self._nco_phase + w * self.g
        x = self._buf[i: i + self.n] * np.exp(-1j * (ph + w * np.arange(self.n)))
        self._nco_phase += w * self.step
        Y = np.fft.fft(x) / np.sqrt(self.n)
        return Y[self.bins]

    def _next_symbol(self, out) -> bool:
        Y = self._fft(self._ptr)
        if Y is None:
            return False
        self._ptr += self.step
        if self._stage == "p2":
            H = Y / self._p2_ref
            # flat channel: smooth across neighbouring carriers
            k = np.ones(5) / 5
            self._H = np.convolve(H, k, mode="same")
            self._H[:2], self._H[-2:] = H[:2], H[-2:]
            err = Y - self._H * self._p2_ref
            s = np.mean(np.abs(self._H) ** 2)
            self.snr_db = float(10 * np.log10(s / (np.mean(np.abs(err) ** 2) + 1e-20)))
            self._stage = "header"
            return True
        Z = self._equalize(Y)
        if self._stage == "header":
            soft = -np.real(Z[self.data_idx])  # BPSK: +1 = bit 0
            comb = soft[:24] + soft[24:48]
            nb = parse_header((comb > 0).astype(np.uint8))
            if nb is None:
                self._reset_burst()
                return True
            self._nblocks = nb
            self.state = LOCKED
            self._stage = "data"
            return True
        # data symbol
        d = Z[self.data_idx]
        self._block_syms.append(d)
        if len(self._block_syms) == SYMS_PER_BLOCK:
            syms = np.concatenate(self._block_syms)
            self._block_syms = []
            self._decode_block(syms)
            self.constellation = [[round(float(v.real) * 1.6, 3), round(float(v.imag) * 1.6, 3)]
                                  for v in syms[::3][:200]]
            if len(self._blocks) == self._nblocks:
                raw = b"".join(self._blocks)
                obj = unpack_object(raw)
                if obj is not None:
                    out.append(obj)
                self._reset_burst()
        return True

    def _equalize(self, Y: np.ndarray) -> np.ndarray:
        Z = Y / self._H
        p = Z[self.pilot_idx] * np.conj(PILOT_VALUES)
        # Common phase and timing slope from the pilots
        ph = np.unwrap(np.angle(p))
        kk = self._carriers[self.pilot_idx]
        slope, intercept = np.polyfit(kk, ph, 1)
        Z = Z * np.exp(-1j * (intercept + slope * self._carriers))
        # Track the remaining frequency error (phase moving symbol to symbol)
        self._cfo += 0.25 * intercept / (2 * np.pi * (SYMBOL_S + GUARD_S))
        # Timing drift: a slope of 2*pi*SPACING*dt per carrier
        dt = slope / (2 * np.pi * SPACING_HZ)
        if abs(dt * self.fs) > 0.6:
            self._ptr += int(np.round(dt * self.fs))
        # keep the reference rotating with the corrections we applied
        self._H = self._H * np.exp(1j * (intercept + slope * self._carriers))
        return Z

    def _decode_block(self, syms: np.ndarray) -> None:
        llr = qam_llr(syms)
        perm = interleaver()
        deint = np.empty_like(llr)
        deint[perm] = llr
        bits, ok = code().decode(deint)
        if ok:
            self.frames_ok += 1
        else:
            self.frames_failed += 1
        import time as _t

        self.last_frame_at = _t.time()
        self._blocks.append(np.packbits(bits).tobytes())
        err = []
        for z in syms:
            nearest = QAM_LEVELS[np.argmin(np.abs(z.real - QAM_LEVELS))] + 1j * QAM_LEVELS[np.argmin(np.abs(z.imag - QAM_LEVELS))]
            err.append(abs(z - nearest) ** 2)
        self.mer_db = float(10 * np.log10(1.0 / (np.mean(err) + 1e-12)))


class _ModeView:
    """Looks like a SpeedMode for code that reads receiver.mode."""
    index = HYPERLINK_MODE
    name = "HyperLink"

    def to_dict(self):
        return mode_info()
