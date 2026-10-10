"""Lightning with LND: lndconnect parsing, connect, decode received invoices,
pay on request (once, fee capped), request a payment and see it settle.
A fake LND REST server stands in for the node."""

import asyncio
import base64
import json
import queue

import pytest
from aiohttp import web

from bitlink21 import lnd
from bitlink21 import service as service_mod
from bitlink21.radio import envelope, filetransfer, framing
from bitlink21.store import Store

MACAROON = bytes(range(32))
INVOICE = "lnbc2500u1pfakeinvoicefromanotherstation"


class FakeLnd:
    def __init__(self):
        self.calls = []
        self.invoices = {}
        self.pay_status = "SUCCEEDED"

    def app(self):
        app = web.Application()
        app.router.add_get("/v1/getinfo", self.getinfo)
        app.router.add_get("/v1/balance/channels", self.balance)
        app.router.add_get("/v1/payreq/{req}", self.payreq)
        app.router.add_post("/v1/invoices", self.add_invoice)
        app.router.add_get("/v1/invoice/{hash}", self.lookup)
        app.router.add_post("/v2/router/send", self.send)
        return app

    def _auth(self, request):
        self.calls.append((request.method, request.path))
        if request.headers.get("Grpc-Metadata-macaroon") != MACAROON.hex():
            raise web.HTTPForbidden(text=json.dumps({"message": "verification failed"}))

    async def getinfo(self, request):
        self._auth(request)
        return web.json_response({"alias": "umbrel", "identity_pubkey": "02ab", "synced_to_chain": True,
                                  "num_active_channels": 3, "chains": [{"chain": "bitcoin", "network": "mainnet"}]})

    async def balance(self, request):
        self._auth(request)
        return web.json_response({"local_balance": {"sat": "150000"}})

    async def payreq(self, request):
        self._auth(request)
        return web.json_response({"num_satoshis": "250000", "description": "coffee via QO-100",
                                  "destination": "03cd", "payment_hash": "aa" * 32,
                                  "timestamp": str(int(__import__("time").time())), "expiry": "3600"})

    async def add_invoice(self, request):
        self._auth(request)
        body = await request.json()
        r_hash = bytes([len(self.invoices) + 1]) * 32
        self.invoices[r_hash.hex()] = {"state": "OPEN", "value": body["value"], "memo": body["memo"]}
        return web.json_response({"payment_request": f"lnbc{body['value']}n1pourinvoice",
                                  "r_hash": base64.b64encode(r_hash).decode()})

    async def lookup(self, request):
        self._auth(request)
        inv = self.invoices[request.match_info["hash"]]
        return web.json_response({"state": inv["state"], "amt_paid_sat": inv["value"] if inv["state"] == "SETTLED" else "0",
                                  "settle_date": "1700000000" if inv["state"] == "SETTLED" else "0"})

    async def send(self, request):
        self._auth(request)
        self.last_send = await request.json()
        lines = [{"result": {"status": "IN_FLIGHT"}}]
        if self.pay_status == "SUCCEEDED":
            lines.append({"result": {"status": "SUCCEEDED", "payment_preimage": "bb" * 32, "fee_sat": "3", "value_sat": "250000"}})
        else:
            lines.append({"result": {"status": "FAILED", "failure_reason": "FAILURE_REASON_NO_ROUTE"}})
        return web.Response(text="\n".join(json.dumps(x) for x in lines))


class FakeSio:
    def __init__(self):
        self.events = []

    async def emit(self, event, data=None, **kwargs):
        self.events.append((event, data))


def _file_event(content: bytes, name: str):
    blocks = filetransfer.build_file_frames(name, content)
    rx = filetransfer.FileReceiver()
    f = next(g for g in (rx.push(framing.unpack_block(b)) for b in blocks) if g is not None)
    return {"type": "bitlink21_file", "name": f.name, "frame_type": f.frame_type, "file_id": f.file_id,
            "data_b64": base64.b64encode(f.data).decode(), "is_envelope": envelope.is_envelope(f.data)}


@pytest.fixture
def env(tmp_path, monkeypatch):
    test_store = Store(str(tmp_path / "bitlink21.db"))
    monkeypatch.setattr(service_mod, "store", test_store)
    s = service_mod.BitLink21Service()
    s.sio = FakeSio()
    fake = {"sdr_id": "pluto-1", "config_queue": queue.Queue(), "tx_queue": queue.Queue()}
    monkeypatch.setattr(s, "_find_pluto", lambda: fake)
    s.fake_pluto = fake
    yield s, FakeLnd()
    asyncio.run(test_store.close())


async def _serve(fake):
    runner = web.AppRunner(fake.app())
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    return runner, f"http://127.0.0.1:{port}"


def test_parse_lndconnect():
    der = b"\x30\x82\x01\x0a" + bytes(range(200))
    link = ("lndconnect://umbrel.local:8080?cert=" + base64.urlsafe_b64encode(der).decode().rstrip("=")
            + "&macaroon=" + base64.urlsafe_b64encode(MACAROON).decode().rstrip("="))
    cfg = lnd.parse_lndconnect(link)
    assert cfg["rest_url"] == "https://umbrel.local:8080"
    assert cfg["macaroon_hex"] == MACAROON.hex()
    assert cfg["cert_pem"].startswith("-----BEGIN CERTIFICATE-----")
    assert base64.b64decode("".join(cfg["cert_pem"].splitlines()[1:-1])) == der
    with pytest.raises(ValueError):
        lnd.parse_lndconnect("https://umbrel.local:8080")
    assert lnd.default_fee_limit_sat(250000) == 2500 and lnd.default_fee_limit_sat(100) == 10


def test_connect_decode_and_pay_once(env):
    svc, fake = env

    async def run():
        runner, url = await _serve(fake)
        try:
            await svc.ensure_ready()
            with pytest.raises(RuntimeError, match="LND 403"):
                await svc.lightning_connect({"lnd_rest_url": url, "macaroon_hex": "00" * 32})
            info = await svc.lightning_connect({"lnd_rest_url": url, "macaroon_hex": MACAROON.hex()})
            assert info["alias"] == "umbrel" and info["active_channels"] == 3 and info["spendable_sat"] == 150000
            pub = svc.public_settings()["lightning"]
            assert pub["macaroon_set"] and "macaroon_hex" not in pub  # secret never sent to the browser

            # an invoice arrives over the satellite: our node decodes it, nothing is paid
            name, data = envelope.encode(envelope.TYPE_LIGHTNING_INVOICE, INVOICE.encode(), callsign="satoshi")
            await svc.handle_worker_event("pluto-1", _file_event(data, name))
            msg = (await svc.list_messages())[0]
            assert msg["relay_status"] == "unpaid"
            assert msg["relay_result"]["amount_sat"] == 250000
            assert msg["relay_result"]["description"] == "coffee via QO-100"
            assert not any(p == "/v2/router/send" for _, p in fake.calls)

            res = await svc.lightning_pay(msg["id"])
            assert res["paid"] and res["preimage"] == "bb" * 32 and res["fee_sat"] == 3
            assert fake.last_send["fee_limit_sat"] == "2500"  # 1 % cap
            assert (await svc.list_messages())[0]["relay_status"] == "paid"
            with pytest.raises(ValueError, match="already paid"):
                await svc.lightning_pay(msg["id"])
        finally:
            await runner.cleanup()

    asyncio.run(run())


def test_failed_payment_is_shown_and_can_be_retried(env):
    svc, fake = env
    fake.pay_status = "FAILED"

    async def run():
        runner, url = await _serve(fake)
        try:
            await svc.ensure_ready()
            await svc.lightning_connect({"lnd_rest_url": url, "macaroon_hex": MACAROON.hex()})
            name, data = envelope.encode(envelope.TYPE_LIGHTNING_INVOICE, INVOICE.encode(), callsign="satoshi")
            await svc.handle_worker_event("pluto-1", _file_event(data, name))
            row = (await svc.list_messages())[0]
            res = await svc.lightning_pay(row["id"])
            assert not res["paid"] and res["reason"] == "no route"
            assert (await svc.list_messages())[0]["relay_status"] == "pay_failed"
            fake.pay_status = "SUCCEEDED"
            assert (await svc.lightning_pay(row["id"]))["paid"]
        finally:
            await runner.cleanup()

    asyncio.run(run())


def test_request_payment_sends_invoice_and_marks_it_paid(env):
    svc, fake = env

    async def run():
        runner, url = await _serve(fake)
        try:
            await svc.ensure_ready()
            svc.station_sdr_id = "pluto-1"
            await svc.update_settings({"tx_enabled": True, "callsign": "dl1abc"})
            await svc.update_settings({"profile": {"rx_dial_rf_hz": 10489.610e6}})
            await svc.lightning_connect({"lnd_rest_url": url, "macaroon_hex": MACAROON.hex()})
            row = await svc.lightning_request(2100, "BitLink21 demo")
            assert row["relay_status"] == "unpaid" and row["relay_result"]["amount_sat"] == 2100
            req = svc.fake_pluto["tx_queue"].get_nowait()
            sent = envelope.decode(base64.b64decode(req["content_b64"]))
            assert sent.payload_type == envelope.TYPE_LIGHTNING_INVOICE and sent.body == b"lnbc2100n1pourinvoice"

            await svc._check_invoices()
            assert (await svc.list_messages())[0]["relay_status"] == "unpaid"
            fake.invoices[row["relay_result"]["payment_hash"]]["state"] = "SETTLED"
            await svc._check_invoices()
            assert (await svc.list_messages())[0]["relay_status"] == "paid"
        finally:
            await runner.cleanup()

    asyncio.run(run())
