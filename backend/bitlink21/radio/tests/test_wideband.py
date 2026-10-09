"""Experimental wideband (DVB-S2) link: plan, TS encapsulation, DVB-S2 TX."""

import numpy as np
import pytest

from bitlink21.radio import wideband as wbm
from bitlink21.radio.profile import SatelliteProfile


def test_plan_tunes_channel_and_uplink():
    p = SatelliteProfile(rx_correction_hz=100.0, tx_correction_hz=-50.0)
    wb = wbm.WidebandProfile(dl_rf_hz=10494.75e6, sym_rate=333e3)
    plan = wbm.make_wb_plan(wb, p, rx_lnb_correction_hz=-20e3)
    # Downlink IF 744.75 MHz; SDR at 4 x 333k = 1.332 MS/s, LO a quarter of
    # that below; LNB error and calibration added
    assert plan.sample_rate_hz == pytest.approx(1.332e6)
    assert plan.rx_lo_hz == round(744.75e6 - 333e3)
    assert plan.rx_channel_offset_hz == pytest.approx(333e3 + 100.0 - 20e3)
    assert plan.ul_rf_hz == pytest.approx(2405.25e6)
    assert plan.tx_lo_hz + plan.tx_channel_offset_hz == pytest.approx(2405.25e6 - 50.0)
    assert plan.tx_allowed
    assert 450e3 < plan.net_bitrate < 480e3  # QPSK 3/4, short frames, pilots


def test_plan_keeps_tx_off_the_wideband_beacon():
    p = SatelliteProfile()
    plan = wbm.make_wb_plan(wbm.WidebandProfile(dl_rf_hz=10491.6e6, sym_rate=125e3), p)
    assert not plan.tx_allowed and "beacon" in plan.tx_block_reason
    with pytest.raises(ValueError):
        wbm.make_wb_plan(wbm.WidebandProfile(dl_rf_hz=10500.0e6), p)


@pytest.mark.parametrize("rs,fs", [(333e3, 1.332e6), (250e3, 1.0e6), (125e3, 1.0e6)])
def test_sample_rate_gives_even_integer_sps(rs, fs):
    from bitlink21.radio.dsp import ChannelSelector

    assert wbm.sample_rate(rs) == pytest.approx(fs)
    ch = ChannelSelector(fs, wbm.if_offset(rs), wbm.channel_rate(wbm.WidebandProfile(sym_rate=rs)), rs)
    assert ch.fs_out / rs == pytest.approx(4.0)


def test_ts_objects_roundtrip_with_loss_and_repeats():
    rng = np.random.default_rng(0)
    objs = [("a.txt", b"hello"), ("b.bin", rng.bytes(5000))]
    ts = wbm.build_ts(objs, 400e3, repeats=2)
    packets = [ts[i: i + 188] for i in range(0, len(ts), 188)]
    # Drop one packet of the first copy of b.bin: its repeat must still arrive
    b_start = next(i for i, pk in enumerate(packets)
                   if pk[1] & 0x40 and b"b.bin" in pk)
    del packets[b_start + 3]
    rx = wbm.TsObjectReceiver()
    got = []
    data = b"".join(packets)
    for i in range(0, len(data), 1000):  # arbitrary read sizes
        got += rx.push(data[i: i + 1000])
    assert got == objs  # each object once, repeats dropped


def test_ts_receiver_resyncs_after_garbage():
    ts = wbm.build_ts([("x", b"1234")], 400e3, repeats=1)
    rx = wbm.TsObjectReceiver()
    assert rx.push(b"\x00\x13garbage" + ts) == [("x", b"1234")]


def test_dvbs2_tx_symbols():
    pytest.importorskip("gnuradio.dtv")
    wb = wbm.WidebandProfile(sym_rate=333e3, modcod="qpsk3/4")
    s = wbm.dvbs2_symbols(wbm.build_ts([("x", b"y" * 10000)], wbm.net_bitrate(wb), repeats=1), wb)
    plframe, _ = wbm._frame(wb)
    assert len(s) % plframe == 0 and np.allclose(np.abs(s), 1.0, atol=1e-3)
