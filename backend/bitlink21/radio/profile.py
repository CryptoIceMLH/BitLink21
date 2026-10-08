"""Satellite / station profile and frequency plan.

Like blocksat-cli's receiver configuration: the operator enters a few
satellite and station facts (downlink frequencies, LNB LO, beacon) and the
plan works out every SDR frequency from them.

Frequencies are in Hz. "RF" means at the satellite (downlink or uplink),
"IF" means at the SDR after the LNB / before the upconverter.
"""

from dataclasses import asdict, dataclass, field
from typing import List, Optional

from .modes import AUDIO_CARRIER_HZ, RRC_ROLLOFF, get_mode


@dataclass
class SatelliteProfile:
    name: str = "QO-100 NB"
    # Downlink
    lnb_lo_hz: float = 9750.0e6
    # Calibrated receive offset (IF domain): the LNB's LO error plus SDR
    # reference error, as measured by the beacon lock and saved by the user.
    # Beacon tracking then only has to follow drift around this value.
    rx_correction_hz: float = 0.0
    beacon_rf_hz: float = 10489.750e6
    beacon_kind: str = "psk"  # "psk" (QO-100 middle beacon) or "cw"
    beacon_lock: bool = True
    # Data channel. dial_rf_hz is the SSB zero-beat ("dial") frequency the
    # way HSModem users quote it; the HSModem signal is centred 1500 Hz above.
    rx_dial_rf_hz: float = 10489.9933e6  # AMSAT-DL multimedia beacon
    rx_mode: int = 9
    search_span_hz: float = 3000.0
    # Uplink (transponder translation: downlink = uplink + translation)
    translation_hz: float = 8089.500e6
    uplink_lo_hz: float = 0.0  # upconverter LO, 0 = SDR transmits on RF directly
    uplink_band_hz: List[float] = field(default_factory=lambda: [2400.000e6, 2400.500e6])
    tx_dial_rf_hz: Optional[float] = None  # uplink dial; None = TX disabled
    tx_mode: int = 4
    tx_gain_db: float = -30.0
    tx_correction_hz: float = 0.0  # manual uplink frequency correction
    # SDR
    sample_rate_hz: float = 1.0e6
    rx_gain_db: float = 50.0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "SatelliteProfile":
        known = {k: v for k, v in (data or {}).items() if k in cls.__dataclass_fields__}
        return cls(**known)


# Built-in presets (users can save their own)
PRESETS = {
    "qo100-nb": SatelliteProfile(),
}


@dataclass
class FrequencyPlan:
    rx_center_if_hz: float
    spectral_inversion: bool
    beacon_offset_hz: float
    rx_channel_offset_hz: float
    tx_lo_hz: Optional[float]
    tx_channel_offset_hz: Optional[float]
    rx_channel_rf_hz: float
    tx_channel_rf_hz: Optional[float]
    warnings: List[str]

    def to_dict(self) -> dict:
        return asdict(self)


def _rf_to_if(rf: float, lo: float) -> float:
    return abs(rf - lo)


def make_plan(p: SatelliteProfile) -> FrequencyPlan:
    warnings: List[str] = []
    fs = p.sample_rate_hz
    usable = 0.4 * fs  # keep signals inside +-40% of the sample rate

    # LO above RF (e.g. C band) mirrors the spectrum. Offsets below are in the
    # IF domain, which is what the SDR's IQ samples represent; the mirrored
    # modulation is handled by the receiver's conjugate hypotheses.
    inversion = p.lnb_lo_hz > p.beacon_rf_hz

    rx_rf = p.rx_dial_rf_hz + AUDIO_CARRIER_HZ
    beacon_if = _rf_to_if(p.beacon_rf_hz, p.lnb_lo_hz)
    rx_if = _rf_to_if(rx_rf, p.lnb_lo_hz)
    centre_if = (beacon_if + rx_if) / 2 if p.beacon_lock else rx_if + 0.1 * fs
    # Keep the SDR's DC spur away from the data channel
    if abs(rx_if - centre_if) < 20e3:
        centre_if = rx_if - 50e3
    beacon_off = beacon_if - centre_if
    rx_off = rx_if - centre_if
    if p.beacon_lock and abs(beacon_off) > usable:
        warnings.append(
            f"Beacon and data channel are {abs(beacon_if - rx_if) / 1e3:.0f} kHz apart; "
            f"increase the sample rate above {abs(beacon_if - rx_if) / 0.8 / 1e6:.2f} MS/s"
        )
    if abs(rx_off) > usable:
        warnings.append("Data channel is outside the usable SDR bandwidth")

    tx_lo = tx_off = tx_rf = None
    if p.tx_dial_rf_hz:
        tx_rf = p.tx_dial_rf_hz + AUDIO_CARRIER_HZ + p.tx_correction_hz
        tx_if = tx_rf - p.uplink_lo_hz if p.uplink_lo_hz else tx_rf
        band_lo, band_hi = p.uplink_band_hz
        if not band_lo <= tx_rf <= band_hi:
            warnings.append("TX frequency is outside the uplink band")
        mode = get_mode(p.tx_mode)
        half_bw = mode.symbol_rate * (1 + RRC_ROLLOFF) / 2
        # Put the TX LO (and its leakage / image) below the uplink band so
        # nothing but our signal lands on the transponder.
        band_lo_if = band_lo - p.uplink_lo_hz if p.uplink_lo_hz else band_lo
        tx_lo = min(band_lo_if - 50e3, tx_if - 100e3)
        if tx_if - tx_lo + half_bw > usable:
            tx_lo = tx_if - usable + half_bw
            warnings.append(
                "TX LO could not be placed below the uplink band at this sample rate; "
                "LO leakage may appear on the transponder. Increase the sample rate."
            )
        tx_off = tx_if - tx_lo

    return FrequencyPlan(
        rx_center_if_hz=centre_if,
        spectral_inversion=inversion,
        beacon_offset_hz=beacon_off + p.rx_correction_hz,
        rx_channel_offset_hz=rx_off + p.rx_correction_hz,
        tx_lo_hz=tx_lo,
        tx_channel_offset_hz=tx_off,
        rx_channel_rf_hz=rx_rf,
        tx_channel_rf_hz=tx_rf,
        warnings=warnings,
    )
