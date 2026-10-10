"""PlutoSDR worker integration of the BitLink21 station, with a fake SDR."""

import base64
import queue
import time

import numpy as np
import pytest

pytest.importorskip("psutil")
from workers.plutosdrworker import TX_CHUNK, TX_DAC_SCALE, TX_IDLE_GAIN_DB, BitLink21Runner  # noqa: E402

from bitlink21.radio import envelope  # noqa: E402
from bitlink21.radio.profile import SatelliteProfile  # noqa: E402


class FakeSdr:
    def __init__(self):
        self.tx_lo = 0
        self.tx_cyclic_buffer = True
        self.tx_hardwaregain_chan0 = -10.0
        self.tx_buffers = []
        self.gain_during_tx = []

    def tx(self, data):
        self.tx_buffers.append(len(data))
        self.gain_during_tx.append(self.tx_hardwaregain_chan0)
        assert np.max(np.abs(data)) <= 2 ** 15

    def tx_destroy_buffer(self):
        pass


def _drain(q, timeout=10.0, until=None):
    events, end = [], time.time() + timeout
    while time.time() < end:
        try:
            ev = q.get(timeout=0.2)
        except queue.Empty:
            continue
        events.append(ev)
        if until and until(ev):
            break
    return events


def test_runner_rx_emits_status_and_tx_streams_burst():
    profile = SatelliteProfile(sample_rate_hz=1e6, rx_dial_rf_hz=10489.6e6, rx_mode=9, tx_gain_db=-20.0)
    sdr, data_q, tx_q = FakeSdr(), queue.Queue(), queue.Queue()
    runner = BitLink21Runner(sdr, profile.to_dict(), data_q, tx_q)
    runner.start()
    try:
        rng = np.random.default_rng(0)
        for _ in range(12):
            runner.feed((0.01 * (rng.standard_normal(100000) + 1j * rng.standard_normal(100000))).astype(np.complex64))
        status = _drain(data_q, until=lambda e: e["type"] == "bitlink21_status")
        assert any(e["type"] == "bitlink21_status" for e in status)

        name, content = envelope.encode(envelope.TYPE_TEXT, b"test", callsign="N0CALL")
        tx_q.put({"msg_row": 7, "name": name, "content_b64": base64.b64encode(content).decode()})
        events = _drain(data_q, timeout=30, until=lambda e: e.get("type") == "bitlink21_tx_status"
                        and e.get("status") in ("sent", "failed"))
        final = [e for e in events if e.get("type") == "bitlink21_tx_status"][-1]
        assert final["status"] == "sent", final
        assert set(sdr.tx_buffers) == {TX_CHUNK}
        assert set(sdr.gain_during_tx) == {-20.0}
        assert sdr.tx_hardwaregain_chan0 == TX_IDLE_GAIN_DB  # attenuated again after the burst
        assert sdr.tx_lo == int(runner.plan.tx_lo_hz)
    finally:
        runner.stop()


def test_runner_tx_failure_still_attenuates():
    profile = SatelliteProfile(sample_rate_hz=240e3, tx_follow_rx=False, tx_dial_rf_hz=None)  # no uplink: TX blocked
    sdr, data_q, tx_q = FakeSdr(), queue.Queue(), queue.Queue()
    runner = BitLink21Runner(sdr, profile.to_dict(), data_q, tx_q)
    runner.start()
    try:
        tx_q.put({"msg_row": 1, "name": "x.txt", "content_b64": base64.b64encode(b"x").decode()})
        events = _drain(data_q, until=lambda e: e.get("status") == "failed")
        assert events[-1]["status"] == "failed"
        assert sdr.tx_buffers == []
        assert sdr.tx_hardwaregain_chan0 == TX_IDLE_GAIN_DB
    finally:
        runner.stop()


class RecordingSdr(FakeSdr):
    def __init__(self):
        super().__init__()
        self.samples = []

    def tx(self, data):
        super().tx(data)
        self.samples.append(np.array(data, dtype=np.complex64))


def test_runner_streams_multi_part_file_that_decodes():
    """The streamed (piece-by-piece) burst of a 2-part file is a valid
    HSModem signal: our own receiver gets both parts back intact."""
    from bitlink21.radio.demodulator import HsModemReceiver
    from bitlink21.radio.filetransfer import FileReceiver
    from bitlink21.radio.modes import get_mode

    fs = 240e3
    profile = SatelliteProfile(sample_rate_hz=fs, rx_dial_rf_hz=10489.6e6, rx_mode=9, tx_gain_db=-20.0)
    sdr, data_q, tx_q = RecordingSdr(), queue.Queue(), queue.Queue()
    runner = BitLink21Runner(sdr, profile.to_dict(), data_q, tx_q)
    runner._wait_for_clear_channel = lambda row: True  # no RX feed in this test
    runner.start()
    try:
        rng = np.random.default_rng(3)
        parts = [("data.bin.part1of2", rng.bytes(3000)), ("data.bin.part2of2", rng.bytes(1200))]
        tx_q.put({"msg_row": 9, "parts": [{"name": n, "content_b64": base64.b64encode(d).decode()} for n, d in parts]})
        events = _drain(data_q, timeout=60, until=lambda e: e.get("type") == "bitlink21_tx_status"
                        and e.get("status") in ("sent", "failed"))
        final = [e for e in events if e.get("type") == "bitlink21_tx_status"][-1]
        assert final["status"] == "sent", final
        assert any(e.get("type") == "bitlink21_tx_progress" for e in events)
    finally:
        runner.stop()

    x = np.concatenate(sdr.samples) / TX_DAC_SCALE
    plan = runner.plan
    rx = HsModemReceiver(fs, get_mode(plan.tx_mode), channel_offset_hz=plan.tx_channel_offset_hz, search_span_hz=3000)
    files = FileReceiver()
    got = {}
    for i in range(0, len(x), 16384):
        for frame in rx.process(x[i: i + 16384]):
            f = files.push(frame)
            if f is not None:
                got[f.name] = f.data
    assert got == dict(parts)


def test_runner_stop_mid_transmission():
    profile = SatelliteProfile(sample_rate_hz=240e3, rx_dial_rf_hz=10489.6e6, rx_mode=0, tx_gain_db=-20.0)
    sdr, data_q, tx_q = FakeSdr(), queue.Queue(), queue.Queue()
    runner = BitLink21Runner(sdr, profile.to_dict(), data_q, tx_q)
    runner._wait_for_clear_channel = lambda row: True
    runner.start()
    try:
        big = np.random.default_rng(1).bytes(20000)  # ~2.5 min at BPSK 1200
        tx_q.put({"msg_row": 5, "parts": [{"name": "big.bin", "content_b64": base64.b64encode(big).decode()}]})
        _drain(data_q, timeout=30, until=lambda e: e.get("type") == "bitlink21_tx_progress")
        t0 = time.time()
        runner.cancel(5)
        events = _drain(data_q, timeout=10, until=lambda e: e.get("type") == "bitlink21_tx_status"
                        and e.get("status") in ("stopped", "sent", "failed"))
        final = [e for e in events if e.get("type") == "bitlink21_tx_status"][-1]
        assert final["status"] == "stopped", final
        assert time.time() - t0 < 2.0
        assert sdr.tx_hardwaregain_chan0 == TX_IDLE_GAIN_DB
    finally:
        runner.stop()
