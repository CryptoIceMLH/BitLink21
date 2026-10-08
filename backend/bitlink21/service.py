"""BitLink21 service (main process).

Glue between the browser (Socket.IO), the PlutoSDR worker process (where
the radio Station runs), the message store and the Bitcoin / Lightning
plugins:

    browser --send_message--> service --tx_queue--> worker Station (TX)
    worker Station --data_queue--> processlifecycle --> service.handle_worker_event
        -> store, plugin relay, Socket.IO events to the browser

Socket.IO events emitted (to all clients):
    bitlink21:status          station / beacon / modem status (~2 Hz)
    bitlink21:message         a message row was added or changed
    bitlink21:file            a non-BitLink21 HSModem file was received
    bitlink21:station_state   station started / stopped / error
"""

import base64
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

from bitlink21.payload_router import InboundPayload, PayloadRouter
from bitlink21.plugins import PluginLoader
from bitlink21.plugins.bitcoin_tx import BitcoinTxPlugin
from bitlink21.plugins.generic_data import GenericDataPlugin
from bitlink21.plugins.lightning_invoice import LightningInvoicePlugin, parse_bolt11_hrp
from bitlink21.radio import envelope
from bitlink21.radio.modes import SPEED_MODES
from bitlink21.radio.profile import PRESETS, SatelliteProfile, make_plan
from bitlink21.store import store

logger = logging.getLogger("bitlink21.service")

ENCRYPTION_CLEAR = "clear"
ENCRYPTION_PASSPHRASE = "passphrase"


def _default_settings() -> Dict[str, Any]:
    return {
        "callsign": "",
        "setup_done": False,
        "encryption": ENCRYPTION_CLEAR,
        "passphrase": "",
        "profile": PRESETS["qo100-nb"].to_dict(),
        "auto_start": True,
        "pluto_host": (os.environ.get("PLUTO_URI") or "ip:192.168.1.200").replace("ip:", ""),
        # Correct our uplink frequency automatically from our own echoes
        "auto_tx_correction": True,
        # Master TX switch. Off by default: nothing is transmitted until the
        # operator deliberately enables it (amp, uplink frequency, licence).
        "tx_enabled": False,
        "bitcoin": {
            "relay_enabled": False,
            "rpc_url": os.environ.get("BITCOIN_RPC_URL") or "http://localhost:8332",
            "rpc_user": os.environ.get("BITCOIN_RPC_USER") or "",
            "rpc_pass": os.environ.get("BITCOIN_RPC_PASS") or "",
        },
        "lightning": {
            "lnd_rest_url": os.environ.get("LND_REST_URL") or "",
        },
    }


class BitLink21Service:
    def __init__(self):
        self.sio = None
        self.settings: Dict[str, Any] = _default_settings()
        self.router: Optional[PayloadRouter] = None
        self.station_sdr_id: Optional[str] = None
        self.last_status: Optional[Dict[str, Any]] = None
        self._ready = False

    # ------------------------------------------------------------ setup

    async def ensure_ready(self, sio=None) -> None:
        if sio is not None:
            self.sio = sio
        if self._ready:
            return
        await store.open()
        saved = await store.get_settings()
        merged = _default_settings()
        for key, value in saved.items():
            if isinstance(merged.get(key), dict) and isinstance(value, dict):
                merged[key].update(value)
            else:
                merged[key] = value
        self.settings = merged
        self._build_router()
        self._ready = True

    def _build_router(self) -> None:
        loader = PluginLoader()
        btc = self.settings["bitcoin"]
        loader.register_plugin(envelope.TYPE_BITCOIN_TX, BitcoinTxPlugin({
            "rpc_url": btc["rpc_url"], "rpc_user": btc["rpc_user"], "rpc_pass": btc["rpc_pass"],
        }))
        ln = self.settings["lightning"]
        loader.register_plugin(envelope.TYPE_LIGHTNING_INVOICE, LightningInvoicePlugin({
            "lnd_rest_url": ln["lnd_rest_url"] or None,
        }))
        loader.register_plugin(envelope.TYPE_BINARY, GenericDataPlugin({}))
        self.router = PayloadRouter(loader)

    async def _emit(self, event: str, data: Any) -> None:
        if self.sio is not None:
            try:
                await self.sio.emit(event, data)
            except Exception as e:  # never let UI emission break the radio path
                logger.debug(f"emit {event} failed: {e}")

    # ------------------------------------------------------------ state for UI

    def public_settings(self) -> Dict[str, Any]:
        s = json.loads(json.dumps(self.settings))
        s["passphrase_set"] = bool(s.pop("passphrase", ""))
        if s["bitcoin"].get("rpc_pass"):
            s["bitcoin"]["rpc_pass"] = "********"
        return s

    def get_state(self) -> Dict[str, Any]:
        profile = SatelliteProfile.from_dict(self.settings["profile"])
        return {
            "settings": self.public_settings(),
            "plan": make_plan(profile).to_dict(),
            "modes": [m.to_dict() for m in SPEED_MODES],
            "presets": {k: v.to_dict() for k, v in PRESETS.items()},
            "station_running": self.station_sdr_id is not None,
            "station_sdr_id": self.station_sdr_id,
            "pluto_available": self._find_pluto() is not None,
            "last_status": self.last_status,
        }

    async def update_settings(self, values: Dict[str, Any]) -> Dict[str, Any]:
        changed = {}
        for key, value in values.items():
            if key not in self.settings and key != "passphrase":
                continue
            if key == "encryption" and value not in (ENCRYPTION_CLEAR, ENCRYPTION_PASSPHRASE):
                raise ValueError("encryption must be 'clear' or 'passphrase'")
            if key == "profile":
                SatelliteProfile.from_dict(value)  # validates field names / types
                merged = dict(self.settings["profile"])
                merged.update(value)
                value = merged
            if key == "bitcoin" and value.get("rpc_pass") == "********":
                value = {**value, "rpc_pass": self.settings["bitcoin"]["rpc_pass"]}
            if isinstance(self.settings.get(key), dict) and isinstance(value, dict) and key != "profile":
                value = {**self.settings[key], **value}
            self.settings[key] = value
            changed[key] = value
        if changed:
            await store.set_settings(changed)
        if "bitcoin" in changed or "lightning" in changed:
            self._build_router()
        if "passphrase" in changed and self.settings["passphrase"]:
            await self._unlock_messages()
        if "profile" in changed and self.station_sdr_id:
            await self.start_station()  # restart with the new plan
        return self.get_state()

    # ------------------------------------------------------------ station control

    def _find_pluto(self) -> Optional[Dict[str, Any]]:
        from pipeline.orchestration.processmanager import process_manager

        for sdr in process_manager.get_running_sdrs():
            if (sdr.get("device") or {}).get("type") == "plutosdr":
                info = process_manager.processes.get(sdr["sdr_id"], {})
                return {"sdr_id": sdr["sdr_id"], "config_queue": info.get("config_queue"),
                        "tx_queue": info.get("tx_queue")}
        return None

    async def _start_pluto(self) -> Dict[str, Any]:
        """Start the PlutoSDR ourselves (no waterfall page needed).

        Uses the Pluto configured under Hardware > SDRs, or registers one
        from the configured host if there is none yet.
        """
        import crud
        from db import AsyncSessionLocal
        from pipeline.orchestration.processmanager import process_manager

        host = self.settings.get("pluto_host") or "192.168.1.200"
        async with AsyncSessionLocal() as db:
            res = await crud.hardware.fetch_sdrs(db)
            plutos = [s for s in (res.get("data") or []) if s.get("type") == "plutosdr"]
            device = next((s for s in plutos if s.get("host") == host), plutos[0] if plutos else None)
            if device is None:
                res = await crud.hardware.add_sdr(db, {
                    "name": "PlutoSDR", "type": "plutosdr", "host": host,
                    "frequency_min": 70, "frequency_max": 6000,
                })
                if not res.get("success"):
                    raise RuntimeError(f"Could not register the PlutoSDR: {res.get('error')}")
                device = res["data"]
                logger.info(f"Registered PlutoSDR at {host}")

        profile = SatelliteProfile.from_dict(self.settings["profile"])
        plan = make_plan(profile)
        sdr_config = {
            "sdr_id": device["id"],
            "center_freq": plan.rx_center_if_hz,
            "sample_rate": profile.sample_rate_hz,
            "gain": profile.rx_gain_db,
            "fft_size": 8192,
            "fft_window": "hanning",
            "fft_averaging": 4,
        }
        await process_manager.start_sdr_process(device, sdr_config, "internal:bitlink21")
        pluto = self._find_pluto()
        if pluto is None:
            raise RuntimeError(f"The PlutoSDR at {host} did not start. Is it powered and reachable?")
        return pluto

    async def start_station(self) -> Dict[str, Any]:
        pluto = self._find_pluto()
        if pluto is None or pluto["config_queue"] is None:
            pluto = await self._start_pluto()
        profile = SatelliteProfile.from_dict(self.settings["profile"])
        plan = make_plan(profile)
        pluto["config_queue"].put({"bitlink21_start": profile.to_dict()})
        self.station_sdr_id = pluto["sdr_id"]
        await self._emit("bitlink21:station_state", {"running": True, "plan": plan.to_dict()})
        return self.get_state()

    async def stop_station(self) -> Dict[str, Any]:
        pluto = self._find_pluto()
        if pluto and pluto["config_queue"] is not None:
            pluto["config_queue"].put({"bitlink21_stop": True})
        self.station_sdr_id = None
        self.last_status = None
        await self._emit("bitlink21:station_state", {"running": False})
        return self.get_state()

    async def calibrate_rx(self) -> Dict[str, Any]:
        """Save the beacon-measured receive error into the profile."""
        status = self.last_status or {}
        beacon = status.get("beacon") or {}
        if not beacon.get("locked"):
            raise RuntimeError("The beacon is not locked; nothing to calibrate from.")
        profile = dict(self.settings["profile"])
        profile["rx_correction_hz"] = round(profile.get("rx_correction_hz", 0.0) + status["correction_hz"], 1)
        return await self.update_settings({"profile": profile})

    async def on_sdr_started(self, sdr_id: str, device: Dict[str, Any]) -> None:
        # A Pluto started from the classic waterfall stays under the classic
        # page's control; the Link page starts the station when it is opened
        # (settings["auto_start"]).
        await self.ensure_ready()

    # ------------------------------------------------------------ sending

    async def send_message(self, payload_type: int, body: bytes, encrypt: Optional[bool] = None) -> Dict[str, Any]:
        if not self.settings.get("tx_enabled"):
            raise RuntimeError("Transmit is switched off. Enable TX in the station settings first.")
        plan = make_plan(SatelliteProfile.from_dict(self.settings["profile"]))
        if not plan.tx_allowed:
            raise RuntimeError(f"Can't transmit on this channel: {plan.tx_block_reason}.")
        if not self.settings["callsign"]:
            raise RuntimeError("Set your callsign first (stations must identify on amateur bands).")
        validate_payload(payload_type, body)

        use_passphrase = self.settings["encryption"] == ENCRYPTION_PASSPHRASE if encrypt is None else encrypt
        passphrase = self.settings["passphrase"] if use_passphrase else None
        if use_passphrase and not passphrase:
            raise RuntimeError("Encryption is on but no passphrase is set.")

        name, content = envelope.encode(payload_type, body, self.settings["callsign"], passphrase)
        msg = envelope.decode(content, passphrase)
        row_id = await store.add_message(
            direction="tx", msg_id=msg.msg_id_hex, payload_type=payload_type,
            callsign=msg.callsign, body=body, encrypted=int(bool(passphrase)),
            status="queued", raw=content,
        )
        await self._emit_message(row_id)

        pluto = self._find_pluto()
        if pluto is None or self.station_sdr_id is None:
            await store.update_message(row_id, status="failed", error="Station is not running")
            await self._emit_message(row_id)
            raise RuntimeError("Station is not running. Start it on the Station page first.")
        pluto["tx_queue"].put({
            "msg_row": row_id,
            "name": name,
            "content_b64": base64.b64encode(content).decode("ascii"),
        })
        return await store.get_message(row_id)

    # ------------------------------------------------------------ worker events

    async def handle_worker_event(self, sdr_id: str, event: Dict[str, Any]) -> None:
        await self.ensure_ready()
        etype = event.get("type")
        if etype == "bitlink21_status":
            self.last_status = event
            await self._emit("bitlink21:status", event)
        elif etype == "bitlink21_file":
            await self._on_file(event)
        elif etype == "bitlink21_tx_status":
            row = event.get("msg_row")
            if row is not None:
                await store.update_message(row, status=event.get("status"), error=event.get("error"))
                await self._emit_message(row)
        elif etype == "bitlink21_station_error":
            self.station_sdr_id = None
            await self._emit("bitlink21:station_state", {"running": False, "error": event.get("error")})
        elif etype == "bitlink21_frame":
            pass  # frame-level detail is already summarised in the status

    async def _on_file(self, event: Dict[str, Any]) -> None:
        data = base64.b64decode(event["data_b64"])
        if not envelope.is_envelope(data):
            info = await store.add_file(event["name"], event["frame_type"], data)
            await self._emit("bitlink21:file", info)
            return

        # Our own transmission heard back through the satellite?
        own = await store.find_message("tx", data[7:15].hex())
        if own is not None:
            await self._on_echo(own)
            return

        passphrase = self.settings["passphrase"] or None
        try:
            msg = envelope.decode(data, passphrase)
        except envelope.EnvelopeError as e:
            if not getattr(e, "encrypted", False):
                logger.warning(f"Undecodable BitLink21 envelope {event['name']}: {e}")
                return
            # Encrypted and we cannot read it (yet): keep it locked
            msg_id = data[7:15].hex()
            row_id = await store.add_message(
                direction="rx", msg_id=msg_id, payload_type=data[5], callsign=None,
                body=None, encrypted=1, locked=1, status="received", error=str(e), raw=data,
            )
            if row_id:
                await self._emit_message(row_id)
            return

        row_id = await store.add_message(
            direction="rx", msg_id=msg.msg_id_hex, payload_type=msg.payload_type,
            callsign=msg.callsign, body=msg.body, encrypted=int(msg.encrypted),
            status="received", raw=data,
        )
        if row_id is None:
            return  # duplicate (repeated transmission)
        await self._emit_message(row_id)
        await self._relay(row_id, msg)

    async def _on_echo(self, own: Dict[str, Any]) -> None:
        """Our message came back through the satellite: delivery confirmed.

        The downlink is beacon-corrected, so the modem's measured offset of
        our own signal is our uplink frequency error.
        """
        if own.get("echo_at"):
            return  # repeats of the same transmission
        modem = (self.last_status or {}).get("modem") or {}
        offset = modem.get("offset_hz")
        await store.update_message(own["id"], status="confirmed", echo_at=time.time(), echo_offset_hz=offset)
        await self._emit_message(own["id"])
        if offset is not None and self.settings.get("auto_tx_correction") and abs(offset) > 20:
            profile = dict(self.settings["profile"])
            profile["tx_correction_hz"] = round(profile.get("tx_correction_hz", 0.0) - offset, 1)
            logger.info(f"Echo showed uplink {offset:+.0f} Hz off; TX correction now {profile['tx_correction_hz']} Hz")
            self.settings["profile"] = profile
            await store.set_settings({"profile": profile})
            await self._emit("bitlink21:settings", self.public_settings())
            pluto = self._find_pluto()
            if pluto and self.station_sdr_id:
                pluto["config_queue"].put({"bitlink21_tx_update": profile})

    async def _relay(self, row_id: int, msg: envelope.Message) -> None:
        """Hand the payload to the matching plugin (Bitcoin relay is opt-in)."""
        if msg.payload_type == envelope.TYPE_TEXT or self.router is None:
            return
        if msg.payload_type == envelope.TYPE_BITCOIN_TX and not self.settings["bitcoin"]["relay_enabled"]:
            await store.update_message(row_id, relay_status="disabled")
            await self._emit_message(row_id)
            return
        result = await self.router.route(InboundPayload(msg.payload_type, msg.body, msg.msg_id_hex))
        plugin_result = result.get("plugin_result", result)
        await store.update_message(
            row_id,
            relay_status=result.get("status", "error"),
            relay_result=json.dumps(plugin_result, default=str),
        )
        await self._emit_message(row_id)

    async def _unlock_messages(self) -> None:
        for row in await store.locked_messages():
            try:
                msg = envelope.decode(bytes(row["raw"]), self.settings["passphrase"])
            except envelope.EnvelopeError:
                continue
            await store.update_message(
                row["id"], body=msg.body, callsign=msg.callsign, locked=0, error=None,
                payload_type=msg.payload_type,
            )
            await self._emit_message(row["id"])
            await self._relay(row["id"], msg)

    async def _emit_message(self, row_id: Optional[int]) -> None:
        if row_id is None:
            return
        row = await store.get_message(row_id)
        if row:
            await self._emit("bitlink21:message", row)

    # ------------------------------------------------------------ queries

    async def list_messages(self, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        return await store.list_messages(limit, offset)

    async def list_files(self) -> List[Dict[str, Any]]:
        return await store.list_files()


def validate_payload(payload_type: int, body: bytes) -> None:
    if not body:
        raise ValueError("Message is empty")
    if payload_type == envelope.TYPE_BITCOIN_TX:
        if len(body) < 60:
            raise ValueError("That does not look like a raw Bitcoin transaction")
    elif payload_type == envelope.TYPE_LIGHTNING_INVOICE:
        if parse_bolt11_hrp(body.decode("utf-8", "replace")) is None:
            raise ValueError("Not a BOLT11 Lightning invoice")
    elif payload_type not in (envelope.TYPE_TEXT, envelope.TYPE_BINARY):
        raise ValueError(f"Unknown payload type {payload_type}")
    if len(body) > 64 * 1024:
        raise ValueError("Message too large for one satellite transfer (64 kB max)")


service = BitLink21Service()
