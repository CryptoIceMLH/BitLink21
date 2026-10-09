import pytest

from bitlink21.radio.profile import SatelliteProfile, make_plan


def test_tx_follows_rx_channel_through_transponder():
    plan = make_plan(SatelliteProfile(rx_dial_rf_hz=10489.600e6, rx_mode=4))
    assert plan.tx_allowed, plan.tx_block_reason
    assert plan.tx_dial_rf_hz == pytest.approx(2400.100e6)
    assert plan.tx_channel_rf_hz == pytest.approx(2400.1015e6)
    assert plan.tx_mode == 4


@pytest.mark.parametrize("dial", [10489.4995e6, 10489.7485e6, 10489.9933e6, 10490.1e6])
def test_no_frequency_limits(dial):
    # The operator picks the channel: beacons or outside the band, TX is allowed
    plan = make_plan(SatelliteProfile(rx_dial_rf_hz=dial))
    assert plan.tx_allowed and plan.tx_block_reason is None


def test_tx_blocked_only_without_uplink_frequency():
    plan = make_plan(SatelliteProfile(tx_follow_rx=False, tx_dial_rf_hz=None))
    assert not plan.tx_allowed and plan.tx_block_reason == "No uplink frequency set"


@pytest.mark.parametrize("dial", [10489.55e6, 10489.70e6, 10489.95e6])
def test_tx_lo_stays_outside_uplink_band(dial):
    p = SatelliteProfile(rx_dial_rf_hz=dial)
    plan = make_plan(p)
    lo, hi = p.uplink_band_hz
    assert not lo <= plan.tx_lo_hz <= hi
    assert abs(plan.tx_channel_offset_hz) < 0.45 * p.sample_rate_hz
    assert not plan.warnings


def test_rx_offsets_in_sdr_bandwidth_and_away_from_dc():
    p = SatelliteProfile(rx_dial_rf_hz=10489.6e6)
    plan = make_plan(p)
    assert abs(plan.beacon_offset_hz) < 0.4 * p.sample_rate_hz
    assert 20e3 < abs(plan.rx_channel_offset_hz) < 0.4 * p.sample_rate_hz
