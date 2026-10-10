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

import asyncio
import base64
import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional

from bitlink21.payload_router import InboundPayload, PayloadRouter
from bitlink21.plugins import PluginLoader
from bitlink21.plugins.bitcoin_tx import BitcoinTxPlugin
from bitlink21.plugins.generic_data import GenericDataPlugin
from bitlink21.plugins.lightning_invoice import parse_bolt11_hrp
from bitlink21 import diagnostics, lnd
from bitlink21.radio import envelope, filetransfer, hyperlink
from bitlink21.radio.modes import SPEED_MODES
from bitlink21.radio.profile import PRESETS, SatelliteProfile, make_plan
from bitlink21.store import store

logger = logging.getLogger("bitlink21.service")

ENCRYPTION_CLEAR = "clear"
MAX_FILE_BYTES = 500 * 1024
# One HSModem file is limited to 1024 frames (~224 kB, 10-bit frame counter).
# Bigger files go out as consecutive files "name.part1of3", ... which
# BitLink21 reassembles; plain HSModem stations get the parts.
PART_BYTES = 200 * 1024
PART_RE = re.compile(r"^(?P<base>.+)\.part(?P<k>\d+)of(?P<n>\d+)$")
PART_TTL_S = 3600.0
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
            "macaroon_hex": "",
            "cert_pem": "",  # pinned LND TLS certificate (from the lndconnect link)
        },
        # Receive-chain error at the last beacon lock: a restart starts the
        # beacon tracker from it instead of searching
        "last_lnb_correction_hz": 0.0,
        "last_lnb_locked_at": None,
        # Detailed logs (radio worker, modem, beacon, TX) for the
        # diagnostics bundle
        "verbose_logging": False,
    }


class BitLink21Service:
    def __init__(self):
        self.sio = None
        self.settings: Dict[str, Any] = _default_settings()
        self.router: Optional[PayloadRouter] = None
        self.station_sdr_id: Optional[str] = None
        self.last_status: Optional[Dict[str, Any]] = None
        self._ready = False
        self._init_lock: Optional[asyncio.Lock] = None
        self._start_lock: Optional[asyncio.Lock] = None
        self._parts: Dict[Any, Dict[str, Any]] = {}  # split files being received

    # ------------------------------------------------------------ setup

    async def ensure_ready(self, sio=None) -> None:
        if sio is not None:
            self.sio = sio
        if self._ready:
            return
        # Several browser requests arrive at once on page load; only one may
        # initialise (otherwise one reads the DB before its tables exist).
        if self._init_lock is None:
            self._init_lock = asyncio.Lock()
        async with self._init_lock:
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
            diagnostics.install_file_logging("server")
            diagnostics.set_verbose(bool(self.settings.get("verbose_logging")))
            for gone in ("auto_tx_correction", "link_mode", "wideband"):  # removed features
                self.settings.pop(gone, None)
            # 4.0.5: auto TX correction removed; undo whatever it had applied
            if not self.settings.get("tx_correction_reset_405"):
                self.settings["profile"] = {**self.settings["profile"], "tx_correction_hz": 0.0}
                self.settings["tx_correction_reset_405"] = True
                await store.set_settings({"profile": self.settings["profile"], "tx_correction_reset_405": True})
            self._build_router()
            self._invoice_watch = asyncio.create_task(self._watch_invoices())
            self._ready = True

    def _build_router(self) -> None:
        loader = PluginLoader()
        btc = self.settings["bitcoin"]
        loader.register_plugin(envelope.TYPE_BITCOIN_TX, BitcoinTxPlugin({
            "rpc_url": btc["rpc_url"], "rpc_user": btc["rpc_user"], "rpc_pass": btc["rpc_pass"],
        }))
        # Lightning invoices are handled here with LND (see _describe_invoice)
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
        ln = s["lightning"]
        ln["macaroon_set"] = bool(ln.pop("macaroon_hex", ""))
        ln["cert_pinned"] = bool(ln.pop("cert_pem", ""))
        return s

    def get_state(self) -> Dict[str, Any]:
        profile = SatelliteProfile.from_dict(self.settings["profile"])
        return {
            "settings": self.public_settings(),
            "plan": make_plan(profile).to_dict(),
            "modes": [m.to_dict() for m in SPEED_MODES] + [hyperlink.mode_info()],
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
            if key == "lightning":
                # secrets only change through lightning_connect
                value = {k: v for k, v in value.items() if k not in ("macaroon_hex", "cert_pem", "macaroon_set", "cert_pinned")}
            if isinstance(self.settings.get(key), dict) and isinstance(value, dict) and key != "profile":
                value = {**self.settings[key], **value}
            self.settings[key] = value
            changed[key] = value
        if changed:
            await store.set_settings(changed)
        if "bitcoin" in changed or "lightning" in changed:
            self._build_router()
        if "verbose_logging" in changed:
            verbose = bool(self.settings["verbose_logging"])
            diagnostics.set_verbose(verbose)
            pluto = self._find_pluto()
            if pluto and pluto["config_queue"] is not None:
                pluto["config_queue"].put({"bitlink21_verbose": verbose})
            logger.info(f"Verbose logging {'on' if verbose else 'off'}")
        if "passphrase" in changed and self.settings["passphrase"]:
            await self._unlock_messages()
        if self.station_sdr_id and "profile" in changed:
            pluto = self._find_pluto()
            if pluto is None or pluto["config_queue"] is None:
                await self.start_station()
            else:
                # Channel/speed change: the worker retunes in place and keeps the
                # beacon lock (or restarts from it when the SDR has to move)
                pluto["config_queue"].put({"bitlink21_retune": self.settings["profile"]})
                await self._emit("bitlink21:station_state", {
                    "running": True,
                    "plan": make_plan(SatelliteProfile.from_dict(self.settings["profile"])).to_dict()})
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
        # One start at a time: the page's auto-start and a "Start radio" click
        # arriving together used to launch two workers fighting over one Pluto.
        if self._start_lock is None:
            self._start_lock = asyncio.Lock()
        async with self._start_lock:
            return await self._start_station_locked()

    async def _start_station_locked(self) -> Dict[str, Any]:
        pluto = self._find_pluto()
        if pluto is None or pluto["config_queue"] is None:
            pluto = await self._start_pluto()
        profile = SatelliteProfile.from_dict(self.settings["profile"])
        command: Dict[str, Any] = {"bitlink21_start": profile.to_dict(),
                                   "bitlink21_verbose": bool(self.settings.get("verbose_logging"))}
        plan_dict = make_plan(profile).to_dict()
        # Start from the last beacon lock (if recent) instead of searching
        locked_at = self.settings.get("last_lnb_locked_at")
        if locked_at and time.time() - locked_at < 24 * 3600:
            command["bitlink21_beacon_seed_hz"] = self.settings.get("last_lnb_correction_hz") or 0.0
        pluto["config_queue"].put(command)
        self.station_sdr_id = pluto["sdr_id"]
        await self._emit("bitlink21:station_state", {"running": True, "plan": plan_dict})
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
        if (beacon.get("locked_s") or 0) < 10:
            raise RuntimeError("Wait until the beacon has been locked steadily for 10 s before calibrating.")
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
        self._check_tx_plan()
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

    async def send_file(self, filename: str, data: bytes) -> Dict[str, Any]:
        """Send a plain HSModem binary file (readable by any HSModem/oscardata
        station). Files are never encrypted; use a message for that."""
        await self._check_can_transmit()
        name = os.path.basename(filename or "").strip()
        if not name:
            raise ValueError("File has no name")
        if not data:
            raise ValueError("File is empty")
        if len(data) > MAX_FILE_BYTES:
            raise ValueError(f"File too large for one satellite transfer (max {MAX_FILE_BYTES // 1024} kB)")
        try:
            name.encode("ascii")
        except UnicodeEncodeError:
            raise ValueError("Use a plain ASCII file name (HSModem limitation)")
        hyper = self.settings["profile"].get("rx_mode") == hyperlink.HYPERLINK_MODE
        if len(data) <= PART_BYTES or hyper:  # HyperLink has no 1024-frame cap
            name = name[:50]
            parts = [(name, data)]
        else:
            n = -(-len(data) // PART_BYTES)
            name = name[:50 - len(f".part{n}of{n}")]
            parts = [(f"{name}.part{k + 1}of{n}", data[k * PART_BYTES:(k + 1) * PART_BYTES]) for k in range(n)]
        if not hyper:
            for part_name, part in parts:
                filetransfer.build_file_frames(part_name, part)  # validates the HSModem frame-count limit
        row_id = await store.add_message(
            direction="tx", msg_id=os.urandom(8).hex(), payload_type=envelope.TYPE_BINARY,
            callsign=self.settings["callsign"], body=data, encrypted=0, status="queued",
            filename=name, size=len(data),
        )
        await self._emit_message(row_id)
        pluto = self._find_pluto()
        pluto["tx_queue"].put({
            "msg_row": row_id,
            "parts": [{"name": pn, "content_b64": base64.b64encode(pd).decode("ascii")} for pn, pd in parts],
        })
        return await store.get_message(row_id)

    def _collect_part(self, name: str, data: bytes):
        """Store one part of a split file; returns (name, data) once complete."""
        m = PART_RE.match(name)
        if not m:
            return name, data
        base, k, n = m.group("base"), int(m.group("k")), int(m.group("n"))
        now = time.time()
        for key in [key for key, v in self._parts.items() if now - v["t"] > PART_TTL_S]:
            del self._parts[key]
        entry = self._parts.setdefault((base, n), {"t": now, "parts": {}})
        entry["t"] = now
        entry["parts"][k] = data
        if len(entry["parts"]) < n or set(entry["parts"]) != set(range(1, n + 1)):
            logger.info(f"Received part {k}/{n} of {base}")
            return None
        del self._parts[(base, n)]
        return base, b"".join(entry["parts"][i] for i in range(1, n + 1))

    async def diagnostics_bundle(self) -> bytes:
        """Zip for troubleshooting. Settings are the public (redacted) ones;
        message contents are left out."""
        state = self.get_state()
        state["last_status"] = self.last_status
        messages = [{k: v for k, v in m.items() if k not in ("body_text", "body_hex")}
                    for m in await store.list_messages(limit=100)]
        return diagnostics.build_bundle(state, messages, await store.list_files(limit=100))

    async def cancel_tx(self, row_id: int) -> Dict[str, Any]:
        """Stop sending a message: queued, waiting for a clear channel or on air."""
        msg = await store.get_message(row_id)
        if not msg or msg["direction"] != "tx":
            raise ValueError("No such outgoing message")
        if msg["status"] in ("queued", "waiting", "sending"):
            pluto = self._find_pluto()
            if pluto and pluto["config_queue"] is not None:
                pluto["config_queue"].put({"bitlink21_tx_cancel": row_id})
            await store.update_message(row_id, status="stopped", error=None)
            await self._emit_message(row_id)
            logger.info(f"BitLink21 TX of message {row_id} stopped by the operator")
        return await store.get_message(row_id)

    def _check_tx_plan(self) -> None:
        plan = make_plan(SatelliteProfile.from_dict(self.settings["profile"]))
        if not plan.tx_allowed:
            raise RuntimeError(f"Can't transmit on this channel: {plan.tx_block_reason}.")

    async def _check_can_transmit(self) -> None:
        if not self.settings.get("tx_enabled"):
            raise RuntimeError("Transmit is switched off. Enable TX in the station settings first.")
        self._check_tx_plan()
        if not self.settings["callsign"]:
            raise RuntimeError("Set your callsign first (stations must identify on amateur bands).")
        if self._find_pluto() is None or self.station_sdr_id is None:
            raise RuntimeError("Station is not running. Start it on the Link page first.")

    # ------------------------------------------------------------ worker events

    async def handle_worker_event(self, sdr_id: str, event: Dict[str, Any]) -> None:
        await self.ensure_ready()
        etype = event.get("type")
        if etype == "bitlink21_status":
            self.last_status = event
            await self._emit("bitlink21:status", event)
            await self._remember_lnb_correction(event)
        elif etype == "bitlink21_file":
            await self._on_file(event)
        elif etype == "bitlink21_tx_status":
            row = event.get("msg_row")
            if row is not None:
                # The echo often decodes before the burst ends (the first frames are
                # repeated), so a late "sending"/"sent" must not undo "confirmed".
                current = await store.get_message(row)
                if current and current.get("status") == "confirmed" and event.get("status") != "failed":
                    return
                if current and current.get("status") == "stopped":
                    return  # the operator stopped it; late worker reports don't revive it
                await store.update_message(row, status=event.get("status"), error=event.get("error"))
                await self._emit_message(row)
        elif etype == "bitlink21_tx_progress":
            # Live only (twice a second while sending): no database write
            await self._emit("bitlink21:tx_progress", {
                "id": event.get("msg_row"), "progress": event.get("progress"),
                "duration_s": event.get("duration_s"),
            })
        elif etype == "bitlink21_align":
            # Dish alignment meter, ~15/s: live only, straight to the browser
            await self._emit("bitlink21:align", {k: v for k, v in event.items() if k != "type"})
        elif etype == "bitlink21_station_error":
            self.station_sdr_id = None
            await self._emit("bitlink21:station_state", {"running": False, "error": event.get("error")})
        elif etype == "bitlink21_frame":
            pass  # frame-level detail is already summarised in the status

    def keep_alignment(self, seconds: float = 15.0) -> bool:
        """The dish alignment page is open: run the meter for the next
        `seconds` (the page renews this every few seconds)."""
        pluto = self._find_pluto()
        if pluto is None or pluto["config_queue"] is None or self.station_sdr_id is None:
            raise RuntimeError("Start the station first (Link page): the meter uses the receiver.")
        pluto["config_queue"].put({"bitlink21_align": float(seconds)})
        return True

    async def _remember_lnb_correction(self, status: Dict[str, Any]) -> None:
        """Keep the beacon-measured receive error as the start for the next run (saved
        at most once a minute)."""
        beacon = status.get("beacon") or {}
        if not beacon.get("locked"):
            return
        now = time.time()
        self.settings["last_lnb_correction_hz"] = float(status.get("correction_hz") or 0.0)
        self.settings["last_lnb_locked_at"] = now
        if now - getattr(self, "_lnb_saved_at", 0.0) > 60:
            self._lnb_saved_at = now
            await store.set_settings({"last_lnb_correction_hz": self.settings["last_lnb_correction_hz"],
                                      "last_lnb_locked_at": now})

    async def _on_file(self, event: Dict[str, Any]) -> None:
        data = base64.b64decode(event["data_b64"])
        if not envelope.is_envelope(data):
            assembled = self._collect_part(event["name"], data)
            if assembled is None:
                return  # more parts to come
            event = {**event, "name": assembled[0]}
            data = assembled[1]
            # Our own plain file coming back through the satellite?
            own_file = await store.find_sent_file(event["name"], len(data))
            if own_file is not None and bytes(own_file.get("body") or b"") == data:
                # Our own file, received back byte-exact: keep that copy too
                # (Files tab, "Echo of your file") and confirm the message
                if not own_file.get("echo_at"):
                    info = await store.add_file(event["name"], event["frame_type"], data, echo_of=own_file["id"])
                    await self._emit("bitlink21:file", info)
                await self._on_echo(own_file)
                return
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
        # The measured offset is shown on the message only: nothing ever moves
        # the TX frequency automatically (the operator's TX is GPS-locked;
        # chasing modem estimates moved it 1 kHz off, live 2026-10-09)
        if offset is not None:
            logger.info(f"Echo heard {offset:+.0f} Hz from nominal (information only)")

    async def _relay(self, row_id: int, msg: envelope.Message) -> None:
        """Hand the payload to the matching plugin (Bitcoin relay is opt-in)."""
        if msg.payload_type == envelope.TYPE_TEXT or self.router is None:
            return
        if msg.payload_type == envelope.TYPE_LIGHTNING_INVOICE:
            info = await self._describe_invoice(msg.body.decode("utf-8", "replace"))
            await store.update_message(row_id, relay_status="unpaid", relay_result=json.dumps(info))
            await self._emit_message(row_id)
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

    # ------------------------------------------------------------ lightning

    def _lnd(self) -> lnd.LndClient:
        try:
            return lnd.LndClient.from_settings(self.settings["lightning"])
        except lnd.LndError:
            raise RuntimeError("Connect your LND node first (Bitcoin & Lightning page).")

    async def _describe_invoice(self, invoice: str) -> Dict[str, Any]:
        """What a received invoice asks for: decoded by our node when it is
        connected (amount, description, expiry), else from the invoice prefix."""
        hrp = parse_bolt11_hrp(invoice) or {}
        info: Dict[str, Any] = {"network": hrp.get("network")}
        if hrp.get("amount_msat") is not None:
            info["amount_sat"] = hrp["amount_msat"] // 1000
        if self.settings["lightning"].get("macaroon_hex"):
            try:
                info.update(await self._lnd().decode(invoice))
            except Exception as e:  # node offline etc.: still show the invoice
                info["decode_error"] = str(e)
        return info

    async def lightning_connect(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Save LND connection details (an lndconnect link, or REST URL +
        macaroon hex) after checking they work; returns node info."""
        link = (data.get("lndconnect") or "").strip()
        if link:
            cfg = lnd.parse_lndconnect(link)
        else:
            cur = self.settings["lightning"]
            cfg = {
                "rest_url": (data.get("lnd_rest_url") or cur.get("lnd_rest_url") or "").strip(),
                "macaroon_hex": (data.get("macaroon_hex") or cur.get("macaroon_hex") or "").strip(),
                "cert_pem": cur.get("cert_pem") or "",
            }
        client = lnd.LndClient(cfg["rest_url"], cfg["macaroon_hex"], cfg["cert_pem"])
        try:
            info = await client.get_info()
        except lnd.LndError as e:
            raise RuntimeError(str(e))
        self.settings["lightning"] = {**self.settings["lightning"], "lnd_rest_url": cfg["rest_url"],
                                      "macaroon_hex": cfg["macaroon_hex"], "cert_pem": cfg["cert_pem"]}
        await store.set_settings({"lightning": self.settings["lightning"]})
        logger.info(f"LND connected: {info.get('alias')} ({info.get('network')}, {info.get('active_channels')} channels)")
        return {**info, "cert_pinned": bool(cfg["cert_pem"])}

    async def lightning_info(self) -> Dict[str, Any]:
        try:
            return await self._lnd().get_info()
        except lnd.LndError as e:
            raise RuntimeError(str(e))

    async def lightning_pay(self, row_id: int, amount_sat: Optional[int] = None) -> Dict[str, Any]:
        """Pay a received invoice with our node. Only on the operator's
        click; never twice; routing fee capped (1 %, at least 10 sats)."""
        row = await store.get_message(row_id)
        if not row or row["payload_type"] != envelope.TYPE_LIGHTNING_INVOICE or row["direction"] != "rx":
            raise ValueError("Not a received Lightning invoice")
        if row.get("relay_status") in ("paid", "paying"):
            raise ValueError("This invoice is already paid" if row["relay_status"] == "paid" else "Payment already in progress")
        invoice = row.get("body_text") or ""
        client = self._lnd()
        try:
            info = await client.decode(invoice)
        except lnd.LndError as e:
            raise RuntimeError(f"Your node cannot read this invoice: {e}")
        amount = info["amount_sat"] or int(amount_sat or 0)
        if amount <= 0:
            raise ValueError("This invoice has no amount: enter how many sats to pay")
        if info["created_at"] and time.time() > info["created_at"] + info["expiry_s"]:
            raise ValueError("This invoice has expired")
        fee_limit = lnd.default_fee_limit_sat(amount)
        result_base = {**(row.get("relay_result") or {}), **info}
        await store.update_message(row_id, relay_status="paying", relay_result=json.dumps(result_base))
        await self._emit_message(row_id)
        try:
            res = await client.pay(invoice, fee_limit, None if info["amount_sat"] else amount)
        except lnd.LndError as e:
            res = {"paid": False, "reason": str(e)}
        status = "paid" if res.get("paid") else "pay_failed"
        await store.update_message(row_id, relay_status=status, relay_result=json.dumps({**result_base, "payment": res}))
        await self._emit_message(row_id)
        logger.info(f"Lightning payment of {amount} sats: {status} {res.get('reason', '')}")
        return {**res, "amount_sat": amount, "fee_limit_sat": fee_limit}

    async def lightning_request(self, amount_sat: int, memo: str = "", expiry_s: int = 3600) -> Dict[str, Any]:
        """Create an invoice on our node and send it over the satellite."""
        amount_sat = int(amount_sat)
        if amount_sat <= 0:
            raise ValueError("Enter an amount in sats")
        await self._check_can_transmit()
        try:
            inv = await self._lnd().add_invoice(amount_sat, memo or "", expiry_s)
        except lnd.LndError as e:
            raise RuntimeError(str(e))
        msg = await self.send_message(envelope.TYPE_LIGHTNING_INVOICE, inv["payment_request"].encode())
        details = {"own_invoice": True, "payment_hash": inv["payment_hash"], "amount_sat": amount_sat,
                   "description": memo or "", "created_at": int(time.time()), "expiry_s": expiry_s}
        await store.update_message(msg["id"], relay_status="unpaid", relay_result=json.dumps(details))
        await self._emit_message(msg["id"])
        return await store.get_message(msg["id"])

    async def _watch_invoices(self) -> None:
        """Mark our own invoices paid (or expired) as our node settles them."""
        while True:
            await asyncio.sleep(15)
            try:
                await self._check_invoices()
            except Exception as e:
                logger.debug(f"invoice watch: {e}")

    async def _check_invoices(self) -> None:
        if not self.settings["lightning"].get("macaroon_hex"):
            return
        for row in await store.list_messages(200, 0):
            res = row.get("relay_result") or {}
            if row["direction"] != "tx" or row.get("relay_status") != "unpaid" or not res.get("own_invoice"):
                continue
            st = await self._lnd().invoice_state(res["payment_hash"])
            if st["state"] == "SETTLED":
                await store.update_message(row["id"], relay_status="paid", relay_result=json.dumps({**res, **st}))
                await self._emit_message(row["id"])
                logger.info(f"Our invoice for {res.get('amount_sat')} sats was paid")
            elif st["state"] == "CANCELED":
                await store.update_message(row["id"], relay_status="expired")
                await self._emit_message(row["id"])

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
