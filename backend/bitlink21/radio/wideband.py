"""Wideband (experimental): BitLink21 messages and files over DVB-S2 on the
QO-100 wideband transponder.

Same content as the narrowband link (BitLink21 envelopes and plain files),
much faster pipe: at 333 kS/s QPSK 3/4 about 470 kbit/s, ~70x Robust NB.

TX: each object (message or file) is wrapped into MPEG-TS packets on one PID
(``pack_object`` / ``ts_packets``), DVB-S2 encoded by GNU Radio's gr-dtv
(BCH + LDPC + PL framing, short frames, pilots on) and streamed through the
same pulse shaping / resampling code as the narrowband modem.

RX: the SDR stream is cut down to the channel and piped to gr-dvbs2rx's
``dvbs2-rx`` (DVB-S2 demodulator/decoder); its TS output is parsed back into
objects by ``TsObjectReceiver``.
"""

import struct
import zlib
from dataclasses import asdict, dataclass
from typing import List, Optional, Tuple

import numpy as np

from .modulator import SymbolStream
from .profile import SatelliteProfile

# QO-100 wideband transponder (AMSAT-DL band plan)
WB_DOWNLINK_HZ = (10491.0e6, 10499.0e6)
# Keep clear of the 1.5 MS/s DVB-S2 beacon at 10491.5 MHz
WB_TX_ALLOWED_DL_HZ = (10492.5e6, 10499.0e6)
WB_UPLINK_HZ = (2401.5e6, 2409.5e6)

SYMBOL_RATES = (125e3, 250e3, 333e3)
MODCODS = ("qpsk1/2", "qpsk2/3", "qpsk3/4", "qpsk4/5", "qpsk5/6", "8psk2/3", "8psk3/4", "8psk5/6")
ROLLOFF = 0.35

# dvbs2-rx's own symbol synchronizer needs an even integer number of samples
# per symbol, so the channel is handed over at exactly SPS_RX samples/symbol;
# the SDR runs at an integer multiple of that (>= MIN_SAMPLE_RATE).
SPS_RX = 4
MIN_SAMPLE_RATE = 1.0e6


def sample_rate(sym_rate: float) -> float:
    """SDR sample rate in wideband mode for a symbol rate."""
    d = int(np.ceil(MIN_SAMPLE_RATE / (SPS_RX * sym_rate) - 1e-9))
    return SPS_RX * sym_rate * max(1, d)


def if_offset(sym_rate: float) -> float:
    """Channel distance from the LO (keeps the LO leakage / DC spike out)."""
    return 0.25 * sample_rate(sym_rate)

TS_PACKET = 188
TS_PAYLOAD = 184
TS_PID = 0x0B21
NULL_PACKET = bytes([0x47, 0x1F, 0xFF, 0x10]) + b"\xff" * TS_PAYLOAD
OBJ_MAGIC = b"BL21WB\x01"
LEAD_IN_S = 1.5        # minimum null-packet lead-in so receivers can lock
LEAD_IN_FRAMES = 40    # ... and at least this many PL frames (slow rates)
RX_FREQ_EST_PERIOD = 8  # dvbs2-rx coarse frequency estimate every N frames
TAIL_S = 0.3      # flushes the last frames out of the encoder


@dataclass
class WidebandProfile:
    dl_rf_hz: float = 10494.75e6     # downlink channel centre
    sym_rate: float = 333e3
    modcod: str = "qpsk3/4"
    pilots: bool = True
    frame: str = "short"

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Optional[dict]) -> "WidebandProfile":
        data = data or {}
        known = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        wb = cls(**known)
        wb.validate()
        return wb

    def validate(self) -> None:
        if self.modcod not in MODCODS:
            raise ValueError(f"Unknown MODCOD {self.modcod}")
        if not 50e3 <= self.sym_rate <= 333e3:
            raise ValueError("Symbol rate must be 50-333 kS/s")
        if self.frame not in ("short", "normal"):
            raise ValueError("Frame size must be short or normal")


def _rate(modcod: str) -> Tuple[str, int, int]:
    """'qpsk3/4' -> ('qpsk', 3, 4)"""
    mod, frac = modcod[:-3], modcod[-3:]
    num, den = frac.split("/")
    return mod, int(num), int(den)


# DVB-S2 short frame: BCH-coded data bits per frame (EN 302 307 Table 5b)
_KBCH_SHORT = {(1, 2): 7032, (2, 3): 10632, (3, 4): 11712, (4, 5): 12432, (5, 6): 13152}
_KBCH_NORMAL = {(1, 2): 32208, (2, 3): 43040, (3, 4): 48408, (4, 5): 51648, (5, 6): 53840}


def _frame(wb: WidebandProfile) -> Tuple[int, int]:
    """(PL frame length in symbols, data bits per frame)"""
    mod, num, den = _rate(wb.modcod)
    bits_per_sym = 2 if mod == "qpsk" else 3
    n_ldpc = 16200 if wb.frame == "short" else 64800
    kbch = (_KBCH_SHORT if wb.frame == "short" else _KBCH_NORMAL)[(num, den)]
    slots = n_ldpc // bits_per_sym // 90
    plframe = 90 + slots * 90 + (36 * ((slots - 1) // 16) if wb.pilots else 0)
    return plframe, kbch - 80  # BBHEADER


def net_bitrate(wb: WidebandProfile) -> float:
    """Useful data rate (bit/s) for the profile (BBHEADER overhead included)."""
    plframe, data_bits = _frame(wb)
    return wb.sym_rate * data_bits / plframe


def lead_in_s(wb: WidebandProfile) -> float:
    plframe, _ = _frame(wb)
    return max(LEAD_IN_S, LEAD_IN_FRAMES * plframe / wb.sym_rate)


@dataclass
class WidebandPlan:
    rx_lo_hz: float
    rx_channel_offset_hz: float
    tx_lo_hz: Optional[float]
    tx_channel_offset_hz: Optional[float]
    dl_rf_hz: float
    ul_rf_hz: float
    occupied_bw_hz: float
    net_bitrate: float
    sample_rate_hz: float
    tx_allowed: bool
    tx_block_reason: Optional[str]

    def to_dict(self) -> dict:
        return asdict(self)


def make_wb_plan(wb: WidebandProfile, p: SatelliteProfile, rx_lnb_correction_hz: float = 0.0) -> WidebandPlan:
    """Frequencies for wideband mode. ``rx_lnb_correction_hz`` is the receive
    chain error last measured on the NB beacon (the WB channel is out of reach
    of the NB beacon at this sample rate, so it is carried over)."""
    bw = wb.sym_rate * (1 + ROLLOFF)
    lo, hi = WB_DOWNLINK_HZ
    if not lo + bw / 2 <= wb.dl_rf_hz <= hi - bw / 2:
        raise ValueError(f"Channel must be inside the wideband transponder ({lo / 1e6:.1f}-{hi / 1e6:.1f} MHz)")

    nominal_if = wb.dl_rf_hz - p.lnb_lo_hz if p.lnb_lo_hz < wb.dl_rf_hz else p.lnb_lo_hz - wb.dl_rf_hz
    off = if_offset(wb.sym_rate)
    rx_lo = float(round(nominal_if - off))
    rx_off = nominal_if - rx_lo + p.rx_correction_hz + rx_lnb_correction_hz

    reason = None
    tlo, thi = WB_TX_ALLOWED_DL_HZ
    if not tlo + bw / 2 <= wb.dl_rf_hz <= thi - bw / 2:
        reason = (f"Transmit only between {tlo / 1e6:.1f} and {thi / 1e6:.1f} MHz "
                  "(clear of the wideband beacon)")
    ul = wb.dl_rf_hz - p.translation_hz
    ulo, uhi = WB_UPLINK_HZ
    if reason is None and not ulo + bw / 2 <= ul <= uhi - bw / 2:
        reason = "Uplink outside the wideband uplink band"
    tx_rf = ul + p.tx_correction_hz
    tx_if = tx_rf - p.uplink_lo_hz if p.uplink_lo_hz else tx_rf
    tx_lo = float(round(tx_if - off))
    return WidebandPlan(
        rx_lo_hz=rx_lo, rx_channel_offset_hz=rx_off,
        tx_lo_hz=tx_lo, tx_channel_offset_hz=tx_if - tx_lo,
        dl_rf_hz=wb.dl_rf_hz, ul_rf_hz=ul, occupied_bw_hz=bw,
        net_bitrate=net_bitrate(wb), sample_rate_hz=sample_rate(wb.sym_rate),
        tx_allowed=reason is None, tx_block_reason=reason,
    )


# ---------------------------------------------------------------- MPEG-TS


def pack_object(name: str, data: bytes) -> bytes:
    """One message or file as a self-checking object."""
    nameb = name.encode("ascii", "replace")[:255]
    return (OBJ_MAGIC + bytes([len(nameb)]) + nameb + struct.pack(">II", len(data), zlib.crc32(data) & 0xFFFFFFFF)
            + data)


def ts_packets(obj: bytes, cc: int = 0) -> Tuple[List[bytes], int]:
    """Split an object into TS packets on TS_PID (PUSI marks the start).
    Returns the packets and the next continuity counter."""
    out = []
    for i in range(0, len(obj), TS_PAYLOAD):
        chunk = obj[i: i + TS_PAYLOAD]
        pusi = 0x40 if i == 0 else 0x00
        hdr = bytes([0x47, pusi | (TS_PID >> 8), TS_PID & 0xFF, 0x10 | (cc & 0x0F)])
        out.append(hdr + chunk + b"\xff" * (TS_PAYLOAD - len(chunk)))
        cc = (cc + 1) & 0x0F
    return out, cc


def build_ts(objects: List[Tuple[str, bytes]], net_rate: float, repeats: int = 2, lead_s: float = LEAD_IN_S) -> bytes:
    """Lead-in nulls + every object ``repeats`` times + tail nulls."""
    per_s = max(1, int(net_rate / (TS_PACKET * 8)))
    packets = [NULL_PACKET] * int(lead_s * per_s)
    cc = 0
    for _ in range(repeats):
        for name, data in objects:
            pk, cc = ts_packets(pack_object(name, data), cc)
            packets += pk
    packets += [NULL_PACKET] * max(8, int(TAIL_S * per_s))
    return b"".join(packets)


class TsObjectReceiver:
    """Rebuilds objects from a (possibly gappy) TS stream."""

    def __init__(self):
        self._buf = b""
        self._cur: Optional[bytearray] = None
        self._cc: Optional[int] = None
        self._seen = {}  # (name, crc) -> time, to drop the repeat
        self.packets = 0
        self.objects = 0

    def push(self, data: bytes) -> List[Tuple[str, bytes]]:
        self._buf += data
        out = []
        while len(self._buf) >= TS_PACKET:
            if self._buf[0] != 0x47:
                k = self._buf.find(b"\x47", 1)
                self._buf = self._buf[k:] if k > 0 else b""
                continue
            pkt, self._buf = self._buf[:TS_PACKET], self._buf[TS_PACKET:]
            self.packets += 1
            pid = ((pkt[1] & 0x1F) << 8) | pkt[2]
            if pid != TS_PID:
                continue
            pusi, cc = bool(pkt[1] & 0x40), pkt[3] & 0x0F
            if pusi:
                self._cur = bytearray(pkt[4:])
            elif self._cur is not None and self._cc is not None and cc == (self._cc + 1) & 0x0F:
                self._cur += pkt[4:]
            else:
                self._cur = None  # lost a packet: wait for the next object
            self._cc = cc
            if self._cur is not None:
                done = self._complete()
                if done is not None:
                    out.append(done)
        return out

    def _complete(self) -> Optional[Tuple[str, bytes]]:
        cur = self._cur
        n = len(OBJ_MAGIC)
        if len(cur) < n + 1:
            return None
        if bytes(cur[:n]) != OBJ_MAGIC:
            self._cur = None
            return None
        name_len = cur[n]
        head = n + 1 + name_len + 8
        if len(cur) < head:
            return None
        size, crc = struct.unpack(">II", bytes(cur[head - 8: head]))
        if len(cur) < head + size:
            return None
        self._cur = None
        data = bytes(cur[head: head + size])
        if zlib.crc32(data) & 0xFFFFFFFF != crc:
            return None
        name = bytes(cur[n + 1: n + 1 + name_len]).decode("ascii", "replace")
        key = (name, crc)
        if key in self._seen:
            return None  # the repeat of an object we already have
        self._seen[key] = True
        if len(self._seen) > 256:
            self._seen.pop(next(iter(self._seen)))
        self.objects += 1
        return name, data


# ---------------------------------------------------------------- DVB-S2 TX


def dvbs2_symbols(ts: bytes, wb: WidebandProfile) -> np.ndarray:
    """DVB-S2 PL frames (complex symbols at the symbol rate) for a TS stream,
    using GNU Radio gr-dtv."""
    from gnuradio import blocks, dtv, gr

    mod, num, den = _rate(wb.modcod)
    rate = getattr(dtv, f"C{num}_{den}")
    constellation = dtv.MOD_QPSK if mod == "qpsk" else dtv.MOD_8PSK
    frame = dtv.FECFRAME_SHORT if wb.frame == "short" else dtv.FECFRAME_NORMAL
    pilots = dtv.PILOTS_ON if wb.pilots else dtv.PILOTS_OFF

    tb = gr.top_block()
    src = blocks.vector_source_b(np.frombuffer(ts, dtype=np.uint8).tolist(), False)
    bbheader = dtv.dvb_bbheader_bb(dtv.STANDARD_DVBS2, frame, rate, dtv.RO_0_35, dtv.INPUTMODE_NORMAL,
                                   dtv.INBAND_OFF, 168, 4000000)
    bbscrambler = dtv.dvb_bbscrambler_bb(dtv.STANDARD_DVBS2, frame, rate)
    bch = dtv.dvb_bch_bb(dtv.STANDARD_DVBS2, frame, rate)
    ldpc = dtv.dvb_ldpc_bb(dtv.STANDARD_DVBS2, frame, rate, dtv.MOD_OTHER)
    interleaver = dtv.dvbs2_interleaver_bb(frame, rate, constellation)
    modulator = dtv.dvbs2_modulator_bc(frame, rate, constellation, dtv.INTERPOLATION_OFF)
    physical = dtv.dvbs2_physical_cc(frame, rate, constellation, pilots, 0)
    sink = blocks.vector_sink_c()
    tb.connect(src, bbheader, bbscrambler, bch, ldpc, interleaver, modulator, physical, sink)
    tb.run()
    s = np.asarray(sink.data(), dtype=np.complex64)
    # gr-dtv's PL framer zero-stuffs (2x interpolation for its own half-band
    # filter); we do our own pulse shaping, so keep the symbols only
    if len(s) > 1 and np.mean(np.abs(s[1::2])) < 1e-6:
        s = s[0::2]
    return s


def rx_args(wb: WidebandProfile, fs: float, ts_fd: int = 1) -> List[str]:
    """dvbs2-rx command line: IQ (fc32) on stdin, MPEG-TS on ``ts_fd``.
    Note dvbs2-rx logs (incl. the JSON metrics lines) go to stdout, so the
    TS should get its own descriptor."""
    return [
        "dvbs2-rx", "--source", "fd", "--in-fd", "0", "--in-iq-format", "fc32",
        "--samp-rate", f"{fs:.0f}", "--sym-rate", f"{wb.sym_rate:.0f}",
        "-m", wb.modcod.upper(), "--frame-size", wb.frame, "-p", "on" if wb.pilots else "off",
        "-r", f"{ROLLOFF}", "--pl-freq-est-period", str(RX_FREQ_EST_PERIOD),
        "--sink", "fd", "--out-fd", str(ts_fd), "--log-all", "--log-period", "1",
    ]


def channel_rate(wb: WidebandProfile) -> float:
    """Sample rate handed to dvbs2-rx: exactly SPS_RX samples per symbol
    (the SDR rate is an integer multiple; tiny margin against float error)."""
    return SPS_RX * wb.sym_rate * (1 - 1e-9)


def dvbs2_stream(objects: List[Tuple[str, bytes]], wb: WidebandProfile, fs_out: float,
                 offset_hz: float) -> SymbolStream:
    """IQ stream (pulse-shaped, at the SDR rate) carrying the objects."""
    ts = build_ts(objects, net_bitrate(wb), lead_s=lead_in_s(wb))
    symbols = dvbs2_symbols(ts, wb)
    # A few dummy symbols so the RRC tail is flushed
    symbols = np.concatenate([symbols, np.zeros(64, np.complex64)])
    return SymbolStream(symbols, wb.sym_rate, 4, ROLLOFF, fs_out, offset_hz)
