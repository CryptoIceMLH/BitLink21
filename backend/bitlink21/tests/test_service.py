"""BitLink21 service: worker events -> store / relay / Socket.IO, and TX requests."""

import asyncio
import base64
import queue

import pytest

from bitlink21 import service as service_mod
from bitlink21.radio import envelope, filetransfer, framing
from bitlink21.store import Store


class FakeSio:
    def __init__(self):
        self.events = []

    async def emit(self, event, data=None, **kwargs):
        self.events.append((event, data))


@pytest.fixture
def svc(tmp_path, monkeypatch):
    test_store = Store(str(tmp_path / "bitlink21.db"))
    monkeypatch.setattr(service_mod, "store", test_store)
    s = service_mod.BitLink21Service()
    s.sio = FakeSio()
    fake = {"sdr_id": "pluto-1", "config_queue": queue.Queue(), "tx_queue": queue.Queue()}
    monkeypatch.setattr(s, "_find_pluto", lambda: fake)
    s.fake_pluto = fake
    yield s
    asyncio.run(test_store.close())


def _file_event(content: bytes, name: str):
    """What the worker Station emits after reassembling a file off air."""
    blocks = filetransfer.build_file_frames(name, content)
    rx = filetransfer.FileReceiver()
    got = [rx.push(framing.unpack_block(b)) for b in blocks]
    f = next(g for g in got if g is not None)
    return {
        "type": "bitlink21_file", "name": f.name, "frame_type": f.frame_type, "file_id": f.file_id,
        "data_b64": base64.b64encode(f.data).decode(), "is_envelope": envelope.is_envelope(f.data),
    }


def test_received_text_message_is_stored_and_emitted(svc):
    async def run():
        await svc.ensure_ready()
        name, data = envelope.encode(envelope.TYPE_TEXT, b"hello via QO-100", callsign="dl1abc")
        await svc.handle_worker_event("pluto-1", _file_event(data, name))
        # A repeated transmission of the same message is ignored
        await svc.handle_worker_event("pluto-1", _file_event(data, name))
        return await svc.list_messages()

    msgs = asyncio.run(run())
    assert len(msgs) == 1
    assert msgs[0]["body_text"] == "hello via QO-100" and msgs[0]["callsign"] == "DL1ABC"
    assert [e for e, _ in svc.sio.events].count("bitlink21:message") == 1


def test_bitcoin_relay_is_opt_in(svc):
    async def run():
        await svc.ensure_ready()
        name, data = envelope.encode(envelope.TYPE_BITCOIN_TX, b"\x02" * 120, callsign="n0call")
        await svc.handle_worker_event("pluto-1", _file_event(data, name))
        return await svc.list_messages()

    msg = asyncio.run(run())[0]
    assert msg["relay_status"] == "disabled"


def test_encrypted_message_unlocks_when_passphrase_is_set(svc):
    async def run():
        await svc.ensure_ready()
        name, data = envelope.encode(envelope.TYPE_TEXT, b"secret", callsign="dl1abc", passphrase="pw")
        await svc.handle_worker_event("pluto-1", _file_event(data, name))
        before = (await svc.list_messages())[0]
        await svc.update_settings({"passphrase": "pw"})
        after = (await svc.list_messages())[0]
        return before, after

    before, after = asyncio.run(run())
    assert before["locked"] and before["body_text"] is None
    assert not after["locked"] and after["body_text"] == "secret"


def test_other_hsmodem_files_are_kept_as_files(svc):
    async def run():
        await svc.ensure_ready()
        await svc.handle_worker_event("pluto-1", _file_event(b"<html>qo100info</html>", "qo100info.html"))
        return await svc.list_files(), await svc.list_messages()

    files, msgs = asyncio.run(run())
    assert files[0]["name"] == "qo100info.html" and not msgs


def test_tx_is_refused_until_enabled_then_queued(svc):
    async def run():
        await svc.ensure_ready()
        svc.station_sdr_id = "pluto-1"
        with pytest.raises(RuntimeError, match="Transmit is switched off"):
            await svc.send_message(envelope.TYPE_TEXT, b"hi")
        await svc.update_settings({"tx_enabled": True, "callsign": "dl1abc"})
        # Default channel is the multimedia beacon: TX must be refused there
        with pytest.raises(RuntimeError, match="beacon segment"):
            await svc.send_message(envelope.TYPE_TEXT, b"hi")
        await svc.update_settings({"profile": {"rx_dial_rf_hz": 10489.600e6}})
        return await svc.send_message(envelope.TYPE_TEXT, b"hi")

    row = asyncio.run(run())
    assert row["status"] == "queued" and row["direction"] == "tx"
    req = svc.fake_pluto["tx_queue"].get_nowait()
    assert req["msg_row"] == row["id"]
    content = base64.b64decode(req["content_b64"])
    assert envelope.decode(content).body == b"hi"


def test_own_message_heard_back_is_confirmed_and_corrects_tx(svc):
    async def run():
        await svc.ensure_ready()
        svc.station_sdr_id = "pluto-1"
        await svc.update_settings({"tx_enabled": True, "callsign": "dl1abc",
                                   "profile": {"rx_dial_rf_hz": 10489.600e6}})
        sent = await svc.send_message(envelope.TYPE_TEXT, b"ping")
        req = svc.fake_pluto["tx_queue"].get_nowait()
        content = base64.b64decode(req["content_b64"])
        # The station hears its own signal 120 Hz high on the (beacon-corrected) downlink
        svc.last_status = {"modem": {"offset_hz": 120.0}}
        await svc.handle_worker_event("pluto-1", _file_event(content, req["name"]))
        return sent, await svc.list_messages()

    sent, msgs = asyncio.run(run())
    assert len(msgs) == 1  # no duplicate rx copy of our own message
    assert msgs[0]["id"] == sent["id"] and msgs[0]["status"] == "confirmed"
    assert msgs[0]["echo_offset_hz"] == 120.0
    assert svc.settings["profile"]["tx_correction_hz"] == -120.0
    commands = []
    while not svc.fake_pluto["config_queue"].empty():
        commands.append(svc.fake_pluto["config_queue"].get_nowait())
    updates = [c["bitlink21_tx_update"] for c in commands if "bitlink21_tx_update" in c]
    assert updates and updates[-1]["tx_correction_hz"] == -120.0


def test_lightning_invoice_validation():
    with pytest.raises(ValueError):
        service_mod.validate_payload(envelope.TYPE_LIGHTNING_INVOICE, b"not an invoice")
    service_mod.validate_payload(envelope.TYPE_LIGHTNING_INVOICE, b"lnbc2500u1pvjluezpp5qqq")
