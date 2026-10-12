"""Radio page: spectrum on a true RF scale, VFO audio, and the transponder
rise used to first find the satellite."""

import base64

import numpy as np
from scipy import signal

from bitlink21.radio.alignment import TRANSPONDER_RF_HZ, TransponderRise
from bitlink21.radio.profile import SatelliteProfile
from bitlink21.radio.station import Station

FS = 1e6


def _station():
    prof = SatelliteProfile(sample_rate_hz=FS, rx_dial_rf_hz=10489.610e6, beacon_lock=False)
    return Station(prof, FS)


def _feed(st, x):
    events = []
    for i in range(0, len(x), 65536):
        events += st.process(x[i:i + 65536])
    return events


def test_spectrum_shows_a_carrier_at_its_true_rf():
    st = _station()
    rf = 10489.700e6
    off = st.baseband_of_rf(rf)
    n = int(1.5 * FS)
    rng = np.random.default_rng(0)
    x = (300 * np.exp(2j * np.pi * off * np.arange(n) / FS)
         + 5 * (rng.standard_normal(n) + 1j * rng.standard_normal(n))).astype(np.complex64)
    st.keep_radio(60)
    frames = [e for e in _feed(st, x) if e["type"] == "bitlink21_spectrum"]
    assert len(frames) >= 15  # ~15 per second
    f = frames[-1]
    bins = np.frombuffer(base64.b64decode(f["bins_b64"]), np.uint8)
    k = int(np.argmax(bins))
    rf_peak = f["rf_centre_hz"] + f["rf_sign"] * (k + 0.5 - len(bins) / 2) * f["span_hz"] / len(bins)
    assert abs(rf_peak - rf) < 2 * f["span_hz"] / len(bins)
    # zoomed on the carrier: finer bins, still at its true RF
    st.keep_radio(60, zoom_rf_hz=rf, zoom_span_hz=20e3)
    f = [e for e in _feed(st, x) if e["type"] == "bitlink21_spectrum"][-1]
    bins = np.frombuffer(base64.b64decode(f["bins_b64"]), np.uint8)
    k = int(np.argmax(bins))
    rf_peak = f["rf_centre_hz"] + f["rf_sign"] * (k + 0.5 - len(bins) / 2) * f["span_hz"] / len(bins)
    assert f["span_hz"] == 20e3 and abs(rf_peak - rf) < 30


def test_vfo_usb_turns_a_carrier_1khz_above_the_dial_into_a_1khz_tone():
    st = _station()
    dial = 10489.650e6
    off = st.baseband_of_rf(dial + 1000.0)
    n = int(1.2 * FS)
    x = (300 * np.exp(2j * np.pi * off * np.arange(n) / FS)).astype(np.complex64)
    for mode, expect_tone in (("usb", True), ("lsb", False)):
        st.keep_radio(60, vfo_rf_hz=dial, vfo_mode=mode)
        st.vfo = None  # fresh receiver per mode
        st.keep_radio(60, vfo_rf_hz=dial, vfo_mode=mode)
        audio = np.concatenate([np.frombuffer(base64.b64decode(e["pcm_b64"]), "<i2")
                                for e in _feed(st, x) if e["type"] == "bitlink21_audio"]).astype(float)
        a = audio[len(audio) // 3:]
        f, p = signal.welch(a, fs=st.vfo.rate, nperseg=1024)
        if expect_tone:
            assert abs(f[np.argmax(p)] - 1000) < 20 and np.sqrt(np.mean(a ** 2)) > 3000
        else:
            assert np.sqrt(np.mean(a ** 2)) < 0.2 * 32767 or abs(f[np.argmax(p)] - 1000) > 300


def test_transponder_rise_sees_the_noise_bump_and_nothing_without_it():
    st = _station()
    lo, hi = (st.baseband_of_rf(f) for f in TRANSPONDER_RF_HZ)
    rng = np.random.default_rng(1)
    n = 1 << 18
    floor = (rng.standard_normal(n) + 1j * rng.standard_normal(n)) * 10
    band = signal.firwin(801, [(hi - lo) / 2], fs=FS)
    hump = signal.lfilter(band, 1, (rng.standard_normal(n) + 1j * rng.standard_normal(n)) * 14)
    hump = hump * np.exp(2j * np.pi * (lo + hi) / 2 * np.arange(n) / FS)
    for x, lo_db, hi_db in ((floor, -0.7, 0.7), (floor + hump, 2.0, 12.0)):
        r = TransponderRise(FS)
        for i in range(0, n, 65536):
            v = r.process(x[i:i + 65536].astype(np.complex64), lo, hi)
        assert lo_db < v < hi_db, v
