"""Dish alignment meter: C/N0 by channel power on a beacon-like signal
(800 chip/s BPSK), steady per reading, and it stops when no longer asked."""

import numpy as np
from scipy import signal

from bitlink21.radio.alignment import AlignmentMeter
from bitlink21.radio.profile import SatelliteProfile
from bitlink21.radio.station import Station

FS = 600e3


def _beacon(n, offset_hz, cn0_dbhz, seed=0):
    rng = np.random.default_rng(seed)
    chips = rng.integers(0, 2, int(n / FS * 800) + 2) * 2 - 1
    bb = np.repeat(chips, int(FS / 800))[:n].astype(float)
    bb = signal.lfilter(signal.firwin(801, 700, fs=FS), 1, bb)
    sig = bb / np.sqrt(np.mean(bb ** 2)) * 200.0  # power 4e4 (Pluto units)
    t = np.arange(n) / FS
    n0 = 4e4 / 10 ** (cn0_dbhz / 10)  # noise density per Hz
    noise = np.sqrt(n0 * FS / 2) * (rng.standard_normal(n) + 1j * rng.standard_normal(n))
    return (sig * np.exp(2j * np.pi * offset_hz * t) + noise).astype(np.complex64)


def test_cn0_by_channel_power_is_right_and_steady():
    x = _beacon(int(6 * FS), 69250.0, 44.0)
    m = AlignmentMeter(FS, 69250.0)
    vals, r = [], None
    for i in range(0, len(x), 39321):  # ~65 ms blocks like the SDR
        out = m.process(x[i:i + 39321], FS)
        if out:
            r = out
            if i > FS:
                vals.append(r["cn0_dbhz"])
    vals = np.array(vals)
    assert abs(vals.mean() - 44.0) < 0.7, vals.mean()
    assert vals.std() < 0.4, vals.std()
    assert r["mer_db"] is not None and r["mer_db"] > 8
    assert len(r["spectrum"]) == 96 and max(r["spectrum"]) > 16  # beacon > 8 dB above the noise per bin


def test_station_meter_runs_only_while_asked():
    prof = SatelliteProfile(sample_rate_hz=FS, rx_dial_rf_hz=10489.610e6)
    st = Station(prof, FS)
    x = _beacon(int(2 * FS), st.plan.beacon_offset_hz, 44.0)
    assert not any(e["type"] == "bitlink21_align" for e in st.process(x[:65536]))
    st.keep_align(60)
    events = []
    for i in range(0, len(x), 65536):
        events += st.process(x[i:i + 65536])
    readings = [e for e in events if e["type"] == "bitlink21_align"]
    assert readings and {"cn0_dbhz", "mer_db", "beacon_state", "spectrum"} <= set(readings[-1])
    st.keep_align(-1)  # the page stopped asking
    st.process(x[:65536])
    assert st.align is None
