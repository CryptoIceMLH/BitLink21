"""Over-the-air simulations: modulator -> impaired channel -> receiver."""

import numpy as np
import pytest
from scipy import signal

from bitlink21.radio import envelope, filetransfer, framing
from bitlink21.radio.beacon import BeaconTracker
from bitlink21.radio.demodulator import HsModemReceiver
from bitlink21.radio.modes import get_mode
from bitlink21.radio.modulator import modulate_blocks
from bitlink21.radio.profile import SatelliteProfile, make_plan
from bitlink21.radio.station import Station

FS = 240e3
CHAN = 30e3


def _channel(tx, mode, offset, esn0_db, drift=0.0, conj=False, seed=0):
    rng = np.random.default_rng(seed)
    pad = np.zeros(int(FS * 0.5), np.complex64)
    x = np.concatenate([pad, tx, pad])
    t = np.arange(len(x)) / FS
    x = x * np.exp(2j * np.pi * np.cumsum(CHAN + offset + drift * t) / FS + 0.3j)
    if conj:
        x = np.conj(x)
    n0 = np.mean(np.abs(tx) ** 2) * (FS / mode.symbol_rate) / 10 ** (esn0_db / 10)
    x = x + np.sqrt(n0 / 2) * (rng.standard_normal(len(x)) + 1j * rng.standard_normal(len(x)))
    return x.astype(np.complex64)


def _decode(x, mode, conj=False):
    rx = HsModemReceiver(FS, mode, channel_offset_hz=-CHAN if conj else CHAN, search_span_hz=3000)
    counters = set()
    for i in range(0, len(x), 16384):
        counters |= {f.counter for f in rx.process(x[i: i + 16384])}
    return rx, counters


@pytest.mark.parametrize("mode_idx", range(10))
def test_all_modes_acquire_offset_and_drift(mode_idx):
    mode = get_mode(mode_idx)
    rng = np.random.default_rng(mode_idx)
    blocks = [framing.pack_frame(rng.bytes(219), 5, 1, i) for i in range(8)]
    tx = modulate_blocks(blocks, mode, FS * (1 + 50e-6), lead_in_symbols=int(mode.symbol_rate * 1.5))
    x = _channel(tx, mode, offset=1234.0, esn0_db=20, drift=2.0)
    rx, counters = _decode(x, mode)
    assert len(counters) >= 7, f"{mode.name}: decoded {sorted(counters)}"


@pytest.mark.parametrize("mode_idx", [1, 5, 9])
def test_mirrored_spectrum(mode_idx):
    mode = get_mode(mode_idx)
    blocks = [framing.pack_frame(bytes([i]) * 219, 5, 1, i) for i in range(6)]
    tx = modulate_blocks(blocks, mode, FS, lead_in_symbols=int(mode.symbol_rate * 1.5))
    x = _channel(tx, mode, offset=-700.0, esn0_db=20, conj=True)
    _, counters = _decode(x, mode, conj=True)
    assert len(counters) >= 5


def test_beacon_tracker_follows_drifting_psk_beacon():
    fs = 1e6
    dur = 12
    n = int(fs * dur)
    rng = np.random.default_rng(3)
    bits = rng.integers(0, 2, int(400 * dur) + 1) * 2 - 1
    bb = signal.lfilter(signal.firwin(301, 400, fs=fs), 1, np.repeat(bits, int(fs / 400))[:n])
    t = np.arange(n) / fs
    err = 3200 + 1.0 * t
    x = bb * np.exp(2j * np.pi * np.cumsum(50e3 + err) / fs)
    x = x + 0.3 * (rng.standard_normal(n) + 1j * rng.standard_normal(n))
    bt = BeaconTracker(fs, 50e3, kind="psk", span_hz=5000)
    for i in range(0, n, 65536):
        bt.process(x[i: i + 65536].astype(np.complex64))
    assert bt.locked
    assert abs(bt.offset_hz - err[-1]) < 5.0


def test_station_end_to_end_with_beacon_lock():
    fs = 1e6
    prof = SatelliteProfile(rx_mode=4, sample_rate_hz=fs, rx_dial_rf_hz=10489.6e6)
    plan = make_plan(prof)
    mode = get_mode(prof.rx_mode)
    name, content = envelope.encode(envelope.TYPE_BITCOIN_TX, b"\x02\x00" * 120, callsign="N0CALL")
    blocks = filetransfer.build_file_frames(name, content)

    rng = np.random.default_rng(9)
    burst = modulate_blocks(blocks, mode, fs, lead_in_symbols=int(mode.symbol_rate * 1.5))
    dur = 3.0 + len(burst) / fs + 1.5
    n = int(fs * dur)
    t = np.arange(n) / fs
    lnb = 2500.0 + 2.0 * t
    bits = rng.integers(0, 2, int(400 * dur) + 2) * 2 - 1
    bb = signal.lfilter(signal.firwin(301, 400, fs=fs), 1, np.repeat(bits, int(fs / 400))[:n])
    x = 3 * bb * np.exp(2j * np.pi * np.cumsum(plan.beacon_offset_hz + lnb) / fs)
    seg = slice(int(3.0 * fs), int(3.0 * fs) + len(burst))
    x[seg] += 0.5 * burst * np.exp(2j * np.pi * np.cumsum(plan.rx_channel_offset_hz + lnb) / fs)[seg]
    x += 0.02 * (rng.standard_normal(n) + 1j * rng.standard_normal(n))
    x = x.astype(np.complex64)

    st = Station(prof, fs)
    files = []
    for i in range(0, n, 65536):
        files += [e for e in st.process(x[i: i + 65536]) if e["type"] == "bitlink21_file"]
    assert st.beacon.locked and abs(st.correction_hz - lnb[-1]) < 10
    assert len(files) == 1 and files[0]["is_envelope"]
