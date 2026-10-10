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


@pytest.mark.parametrize("err", [-20400.0, -24000.0, 22000.0])
def test_beacon_tracker_no_alias_across_full_span(err):
    """Regression: with a 66.7 kS/s channel a -20.4 kHz LNB error aliased to
    +12.6 kHz after squaring (live failure on QO-100, 2026-10-08)."""
    fs = 1e6
    dur = 6
    n = int(fs * dur)
    rng = np.random.default_rng(7)
    bits = rng.integers(0, 2, int(400 * dur) + 1) * 2 - 1
    bb = signal.lfilter(signal.firwin(301, 400, fs=fs), 1, np.repeat(bits, int(fs / 400))[:n])
    x = bb * np.exp(2j * np.pi * (-106e3 + err) * np.arange(n) / fs)
    x = x + 0.3 * (rng.standard_normal(n) + 1j * rng.standard_normal(n))
    bt = BeaconTracker(fs, -106e3, kind="psk", span_hz=25000)
    for i in range(0, n, 65536):
        bt.process(x[i: i + 65536].astype(np.complex64))
    assert bt.locked
    assert abs(bt.offset_hz - err) < 20.0, bt.offset_hz


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


@pytest.mark.parametrize("case,busy", [("quiet", False), ("in_channel", True), ("neighbour", False), ("weak_in_channel", True)])
def test_channel_busy_detection(case, busy):
    """Listen before talk: a signal inside our 2.7 kHz channel is busy; a
    strong station in the next channel (3 kHz away) is not."""
    fs = 600e3
    mode = get_mode(2)  # QPSK 3000: the widest common neighbour
    rng = np.random.default_rng(5)
    blocks = [framing.pack_frame(rng.bytes(219), 5, 1, i) for i in range(4)]
    chan = 20e3
    sig_offset = {"in_channel": chan + 150, "weak_in_channel": chan - 300, "neighbour": chan + 3000}.get(case)
    amp = {"in_channel": 0.5, "weak_in_channel": 0.1, "neighbour": 1.0}.get(case, 0.0)
    s = modulate_blocks(blocks, mode, fs, sig_offset or 0.0) if sig_offset else np.zeros(int(fs * 2), np.complex64)
    n = min(len(s), int(fs * 2))
    x = amp * s[:n] / (np.sqrt(np.mean(np.abs(s[:n]) ** 2)) + 1e-12)
    x = x + 0.05 * (rng.standard_normal(n) + 1j * rng.standard_normal(n))
    rx = HsModemReceiver(fs, get_mode(0), channel_offset_hz=chan, search_span_hz=3000)
    for i in range(0, n, 65536):
        rx.process(x[i: i + 65536].astype(np.complex64))
    assert rx.channel_busy() is busy, rx.channel_occupancy_db()


def _beacon_signal(fs, beacon_off, err, dur, seed=4):
    rng = np.random.default_rng(seed)
    n = int(fs * dur)
    bits = rng.integers(0, 2, int(400 * dur) + 2) * 2 - 1
    bb = signal.lfilter(signal.firwin(301, 400, fs=fs), 1, np.repeat(bits, int(fs / 400))[:n])
    x = 3 * bb * np.exp(2j * np.pi * (beacon_off + err) * np.arange(n) / fs)
    return (x + 0.05 * (rng.standard_normal(n) + 1j * rng.standard_normal(n))).astype(np.complex64)


def test_station_retune_keeps_beacon_lock():
    fs = 1e6
    prof = SatelliteProfile(sample_rate_hz=fs, rx_dial_rf_hz=10489.6e6, rx_mode=4)
    st = Station(prof, fs)
    x = _beacon_signal(fs, st.plan.beacon_offset_hz, 2500.0, 6)
    for i in range(0, len(x), 65536):
        st.process(x[i: i + 65536])
    assert st.beacon.locked
    before = st.correction_hz
    # Change channel and speed: modem retunes, SDR and beacon tracker stay
    assert st.retune(SatelliteProfile(sample_rate_hz=fs, rx_dial_rf_hz=10489.65e6, rx_mode=2))
    assert st.beacon.locked and st.correction_hz == before
    assert st.receiver.mode.index == 2
    y = _beacon_signal(fs, st.plan.beacon_offset_hz, 2500.0, 2, seed=5)
    for i in range(0, len(y), 65536):
        st.process(y[i: i + 65536])
    assert st.beacon.locked and abs(st.correction_hz - 2500.0) < 10


def test_seeded_beacon_is_locked_at_once_and_confirmed():
    fs = 1e6
    prof = SatelliteProfile(sample_rate_hz=fs, rx_dial_rf_hz=10489.6e6)
    st = Station(prof, fs, beacon_seed_hz=2510.0)
    assert st.beacon.locked and st.correction_hz == 2510.0  # before any sample
    x = _beacon_signal(fs, st.plan.beacon_offset_hz, 2500.0, 2.5)
    for i in range(0, len(x), 65536):
        st.process(x[i: i + 65536])
        assert st.beacon.locked  # never drops while confirming
    assert abs(st.correction_hz - 2500.0) < 10


def test_wrong_seed_falls_back_to_search():
    fs = 1e6
    prof = SatelliteProfile(sample_rate_hz=fs, rx_dial_rf_hz=10489.6e6)
    st = Station(prof, fs, beacon_seed_hz=-8000.0)  # LNB drifted a lot while off
    x = _beacon_signal(fs, st.plan.beacon_offset_hz, 2500.0, 10)
    for i in range(0, len(x), 65536):
        st.process(x[i: i + 65536])
    assert st.beacon.locked and abs(st.correction_hz - 2500.0) < 10


def test_beacon_tracker_follows_fast_drift_without_unlocking():
    """Regression (live 2026-10-09): the receive frequency ran at 20-40 Hz/s
    while transmitting; the tracker smeared the line, unlocked after every
    message and grabbed the beacon's symbol-clock lines 400 Hz away."""
    fs = 1e6
    dur = 24
    n = int(fs * dur)
    t = np.arange(n) / fs
    rate = np.where((t >= 8) & (t < 20), -40.0, -2.0)
    err = -4400.0 + np.cumsum(rate) / fs
    rng = np.random.default_rng(1)
    bits = rng.integers(0, 2, int(400 * dur) + 2) * 2 - 1
    bb = signal.lfilter(signal.firwin(301, 400, fs=fs), 1, np.repeat(bits, int(fs / 400))[:n])
    x = (3 * bb * np.exp(2j * np.pi * np.cumsum(70e3 + err) / fs)
         + 0.05 * (rng.standard_normal(n) + 1j * rng.standard_normal(n))).astype(np.complex64)
    bt = BeaconTracker(fs, 70e3, kind="psk", span_hz=25000)
    unlocked_after_lock = False
    for i in range(0, n, 65536):
        if bt.process(x[i: i + 65536]):
            k = min(i + 65535, n - 1)
            if t[k] > 3 and not bt.locked:
                unlocked_after_lock = True
            if 13.5 < t[k] < 19.5:  # settled on the ramp
                assert abs(bt.offset_hz - err[k]) < 10, (t[k], bt.offset_hz, err[k])
                assert abs(bt.rate_hz_s + 40) < 8
    assert not unlocked_after_lock


def test_long_bpsk_message_decodes_while_receive_frequency_runs():
    """Regression (live 2026-10-09): a 12 s BPSK message got 1 good frame
    out of 11 while the receive chain drifted ~40 Hz/s."""
    fs = 1e6
    prof = SatelliteProfile(sample_rate_hz=fs, rx_dial_rf_hz=10489.61e6, rx_mode=0)
    plan = make_plan(prof)
    mode = get_mode(0)
    name, content = envelope.encode(envelope.TYPE_TEXT, b"test", callsign="N0CALL")
    burst = modulate_blocks(filetransfer.build_file_frames(name, content), mode, fs, 0.0,
                            lead_in_symbols=int(mode.symbol_rate * 1.5))
    t_tx0 = 6.0
    n = int(fs * (t_tx0 + len(burst) / fs + 3.0))
    t = np.arange(n) / fs
    rate = np.where((t >= t_tx0) & (t < t_tx0 + len(burst) / fs), -40.0, -2.0)
    err = -4400.0 + np.cumsum(rate) / fs
    rng = np.random.default_rng(3)
    bits = rng.integers(0, 2, int(400 * t[-1]) + 3) * 2 - 1
    bb = signal.lfilter(signal.firwin(301, 400, fs=fs), 1, np.repeat(bits, int(fs / 400))[:n])
    x = 3 * bb * np.exp(2j * np.pi * np.cumsum(plan.beacon_offset_hz + err) / fs)
    seg = slice(int(t_tx0 * fs), int(t_tx0 * fs) + len(burst))
    amp = np.sqrt(10 ** 1.2 * 2 * 0.05 ** 2 * mode.symbol_rate * 1.2 / fs / np.mean(np.abs(burst) ** 2))
    x[seg] += amp * burst * np.exp(2j * np.pi * np.cumsum(plan.rx_channel_offset_hz + err) / fs)[seg]
    x = (x + 0.05 * (rng.standard_normal(n) + 1j * rng.standard_normal(n))).astype(np.complex64)
    st = Station(prof, fs)
    files = []
    for i in range(0, n, 65536):
        files += [e for e in st.process(x[i: i + 65536]) if e["type"] == "bitlink21_file"]
    assert len(files) == 1 and files[0]["is_envelope"]


@pytest.mark.parametrize("mode_idx", [6, 7])
def test_8apsk_file_survives_echo_drift(mode_idx):
    """Regression (on air 2026-10-10): 1 KB files at 8APSK 5500/6000 lost
    blocks at 17 dB while our own echo drifted ~-5..-10 Hz/s (uplink drift
    the beacon cannot see): a false fine-frequency line kicked the locked
    PLL 64 Hz off, and 10-16 Hz re-centre steps broke frames."""
    fs = 600e3
    prof = SatelliteProfile(sample_rate_hz=fs, rx_dial_rf_hz=10489.611e6, rx_mode=mode_idx,
                            tx_mode=mode_idx, beacon_lock=False)
    tx = Station(prof, fs)
    data = np.random.default_rng(7).bytes(1024)
    burst = np.concatenate(list(tx.tx_stream("f.bin", data)))
    plan = tx.plan
    n = len(burst) + int(2 * fs)
    t = np.arange(n) / fs
    x = np.zeros(n, np.complex128)
    x[int(fs): int(fs) + len(burst)] = burst
    x *= np.exp(2j * np.pi * (plan.rx_channel_offset_hz - plan.tx_channel_offset_hz + 7.0) * t
                - 1j * np.pi * 5.0 * t * t)
    rng = np.random.default_rng(mode_idx)
    n0 = np.mean(np.abs(burst) ** 2) * fs / (get_mode(mode_idx).symbol_rate * 1.2) / 10 ** 1.8
    x = (x + np.sqrt(n0 / 2) * (rng.standard_normal(n) + 1j * rng.standard_normal(n))).astype(np.complex64)
    rx = Station(prof, fs)
    files = []
    for i in range(0, n, 65536):
        files += [e for e in rx.process(x[i: i + 65536]) if e["type"] == "bitlink21_file"]
    assert len(files) == 1, (rx.receiver.frames_ok, rx.receiver.frames_failed)
