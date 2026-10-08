"""HSModem speed modes.

Mirrors the ``sr[]`` table in hsmodem.cpp. HSModem is an audio modem: the
soundcard rate divided by the TX interpolation factor gives the symbol rate.
All modes use an RRC pulse with roll-off 0.2 and sit on a 1500 Hz audio
carrier inside an SSB channel, i.e. the RF signal is centred 1500 Hz above
the SSB "dial" (zero-beat) frequency.
"""

from dataclasses import dataclass

RRC_ROLLOFF = 0.2
AUDIO_CARRIER_HZ = 1500.0


@dataclass(frozen=True)
class SpeedMode:
    index: int
    name: str
    modulation: str  # "bpsk" | "qpsk" | "8apsk"
    bits_per_symbol: int
    audio_rate: int
    tx_interp: int
    nominal_bps: int

    @property
    def symbol_rate(self) -> float:
        return self.audio_rate / self.tx_interp

    @property
    def bit_rate(self) -> float:
        return self.symbol_rate * self.bits_per_symbol

    @property
    def occupied_bw_hz(self) -> float:
        return self.symbol_rate * (1 + RRC_ROLLOFF)

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "name": self.name,
            "modulation": self.modulation,
            "bits_per_symbol": self.bits_per_symbol,
            "symbol_rate": self.symbol_rate,
            "bit_rate": self.bit_rate,
            "occupied_bw_hz": self.occupied_bw_hz,
        }


SPEED_MODES = [
    SpeedMode(0, "BPSK 1200", "bpsk", 1, 48000, 40, 1200),
    SpeedMode(1, "BPSK 2400", "bpsk", 1, 48000, 20, 2400),
    SpeedMode(2, "QPSK 3000", "qpsk", 2, 48000, 32, 3000),
    SpeedMode(3, "QPSK 4000", "qpsk", 2, 48000, 24, 4000),
    SpeedMode(4, "QPSK 4410", "qpsk", 2, 44100, 20, 4410),
    SpeedMode(5, "QPSK 4800", "qpsk", 2, 48000, 20, 4800),
    SpeedMode(6, "8APSK 5500", "8apsk", 3, 44100, 24, 5500),
    SpeedMode(7, "8APSK 6000", "8apsk", 3, 48000, 24, 6000),
    SpeedMode(8, "8APSK 6600", "8apsk", 3, 44100, 20, 6600),
    SpeedMode(9, "8APSK 7200", "8apsk", 3, 48000, 20, 7200),
]

DEFAULT_MODE = 4  # HSModem's default (QPSK 4410)


def get_mode(index: int) -> SpeedMode:
    if not 0 <= int(index) < len(SPEED_MODES):
        raise ValueError(f"Unknown HSModem speed mode {index}")
    return SPEED_MODES[int(index)]
