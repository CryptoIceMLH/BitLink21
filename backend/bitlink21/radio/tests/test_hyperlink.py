"""HyperLink: LDPC, OFDM burst round trip, station end to end."""

import base64

import numpy as np
import pytest
from scipy import signal

from bitlink21.radio import envelope
from bitlink21.radio import hyperlink as hl
from bitlink21.radio.modulator import ResampledStream
from bitlink21.radio.profile import SatelliteProfile
from bitlink21.radio.station import Station


def test_ldpc_encodes_and_corrects_errors():
    code = hl.code()
    rng = np.random.default_rng(0)
    data = rng.integers(0, 2, hl.K_BITS).astype(np.uint8)
    cw = code.encode(data)
    synd = np.bitwise_xor.reduce(np.where(code.mask, cw[code.cols_safe], 0), axis=1)
    assert not synd.any()  # a valid codeword
    # 2 % hard errors (the code fixes ~3 %; with soft 16-QAM LLRs it does better)
    llr = np.where(cw == 0, 2.0, -2.0) + 0.0
    flip = rng.random(hl.N_BITS) < 0.02
    llr[flip] *= -1
    bits, ok = code.decode(llr)
    assert ok and np.array_equal(bits, data)


def test_header_roundtrip_and_rejects_garbage():
    assert hl.parse_header(hl.header_bits(123)) == 123
    bad = hl.header_bits(123)
    bad[3] ^= 1
    assert hl.parse_header(bad) is None


def test_burst_is_loud_but_stays_inside_its_channel():
    """Clip-and-filter: average level close to the single-carrier modes,
    nothing leaking into the neighbouring channels (the old hard clip put
    splatter only ~18 dB down)."""
    x = hl.burst("f.bin", np.random.default_rng(3).bytes(3000))
    assert np.max(np.abs(x)) <= 0.9 + 1e-6
    assert 10 * np.log10(np.mean(np.abs(x) ** 2)) > -9.0  # old hard clip: -10.1 dBFS
    f, p = signal.welch(x, fs=hl.TX_RATE, nperseg=1024, return_onesided=False)
    inband = np.mean(p[np.abs(f) <= 1350])
    assert 10 * np.log10(np.max(p[(np.abs(f) > 1600) & (np.abs(f) < 3500)]) / inband) < -50


def _through_channel(bb, fs, chan, snr_db, cfo=0.0, drift=0.0, seed=1):
    rng = np.random.default_rng(seed)
    x = np.concatenate(list(ResampledStream(bb, hl.TX_RATE, fs, chan + cfo)))
    t = np.arange(len(x)) / fs
    if drift:
        x = x * np.exp(1j * np.pi * drift * t * t)
    n0 = np.mean(np.abs(x) ** 2) * fs / hl.mode_info()["occupied_bw_hz"] / 10 ** (snr_db / 10)
    sig = np.concatenate([np.zeros(int(0.8 * fs), np.complex64), x, np.zeros(int(0.4 * fs), np.complex64)])
    return (sig + np.sqrt(n0 / 2) * (rng.standard_normal(len(sig)) + 1j * rng.standard_normal(len(sig)))).astype(np.complex64)


@pytest.mark.parametrize("snr,cfo,drift", [(14, 0.0, 0.0), (14, 30.0, 0.0), (14, 0.0, -40.0)])
def test_burst_roundtrip(snr, cfo, drift):
    fs, chan = 600e3, 40e3
    data = np.random.default_rng(3).bytes(3000)
    sig = _through_channel(hl.burst("f.bin", data), fs, chan, snr, cfo, drift)
    rx = hl.HyperLinkReceiver(fs, chan)
    got = []
    for i in range(0, len(sig), 65536):
        got += rx.process(sig[i: i + 65536])
    assert got == [("f.bin", data)], (rx.frames_ok, rx.frames_failed, rx.snr_db)


def test_station_sends_and_receives_hyperlink_through_beacon_drift():
    fs = 600e3
    prof = SatelliteProfile(sample_rate_hz=fs, rx_dial_rf_hz=10489.61e6, rx_mode=hl.HYPERLINK_MODE)
    tx = Station(prof, fs)
    name, content = envelope.encode(envelope.TYPE_TEXT, b"hello via HyperLink", callsign="N0CALL")
    burst = np.concatenate(list(tx.tx_stream(name, content)))
    plan = tx.plan
    rng = np.random.default_rng(2)
    pre = int(5 * fs)
    n = pre + len(burst) + int(fs)
    t = np.arange(n) / fs
    rate = np.where((t > 5) & (t < 5 + len(burst) / fs), -30.0, -2.0)
    err = -26400.0 + np.cumsum(rate) / fs  # beyond the old 25 kHz beacon search
    bits = rng.integers(0, 2, int(400 * t[-1]) + 3) * 2 - 1
    bb = signal.lfilter(signal.firwin(301, 400, fs=fs), 1, np.repeat(bits, int(fs / 400))[:n])
    x = 3 * bb * np.exp(2j * np.pi * np.cumsum(plan.beacon_offset_hz + err) / fs)
    seg = slice(pre, pre + len(burst))
    x[seg] += 0.35 * burst * np.exp(2j * np.pi * np.cumsum(
        plan.rx_channel_offset_hz - plan.tx_channel_offset_hz + err) / fs)[seg]
    x = (x + 0.05 * (rng.standard_normal(n) + 1j * rng.standard_normal(n))).astype(np.complex64)
    rx = Station(prof, fs)
    files = []
    for i in range(0, n, 65536):
        files += [e for e in rx.process(x[i: i + 65536]) if e["type"] == "bitlink21_file"]
    assert rx.beacon.locked and abs(rx.correction_hz - err[-1]) < 20
    assert len(files) == 1 and envelope.decode(base64.b64decode(files[0]["data_b64"])).body == b"hello via HyperLink"
