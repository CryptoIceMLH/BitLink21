"""BitLink21 Socket.IO handlers (station, messages, settings)."""

import base64
from typing import Any, Dict, Optional, Union

from bitlink21.radio import envelope
from bitlink21.service import service
from bitlink21.store import store

Result = Dict[str, Union[bool, dict, list, str, None]]

PAYLOAD_TYPES = {
    "text": envelope.TYPE_TEXT,
    "bitcoin_tx": envelope.TYPE_BITCOIN_TX,
    "lightning_invoice": envelope.TYPE_LIGHTNING_INVOICE,
    "binary": envelope.TYPE_BINARY,
}


def _fail(logger: Any, what: str, e: Exception) -> Result:
    if isinstance(e, (ValueError, RuntimeError)):
        return {"success": False, "error": str(e)}
    logger.error(f"BitLink21 {what} failed: {e}", exc_info=True)
    return {"success": False, "error": f"{what} failed: {e}"}


async def get_state(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Result:
    try:
        await service.ensure_ready(sio)
        return {"success": True, "data": service.get_state()}
    except Exception as e:
        return _fail(logger, "get_state", e)


async def update_settings(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Result:
    try:
        await service.ensure_ready(sio)
        return {"success": True, "data": await service.update_settings(data or {})}
    except Exception as e:
        return _fail(logger, "update_settings", e)


async def start_station(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Result:
    try:
        await service.ensure_ready(sio)
        return {"success": True, "data": await service.start_station()}
    except Exception as e:
        return _fail(logger, "start_station", e)


async def stop_station(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Result:
    try:
        await service.ensure_ready(sio)
        return {"success": True, "data": await service.stop_station()}
    except Exception as e:
        return _fail(logger, "stop_station", e)


async def calibrate_rx(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Result:
    try:
        await service.ensure_ready(sio)
        return {"success": True, "data": await service.calibrate_rx()}
    except Exception as e:
        return _fail(logger, "calibrate_rx", e)


async def send_message(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Result:
    """data: {payload_type: text|bitcoin_tx|lightning_invoice|binary,
              body: str (text / hex for bitcoin_tx / base64 for binary),
              encrypt: optional bool overriding the default}"""
    try:
        await service.ensure_ready(sio)
        data = data or {}
        ptype = PAYLOAD_TYPES.get(data.get("payload_type", ""))
        if ptype is None:
            raise ValueError("payload_type must be one of " + ", ".join(PAYLOAD_TYPES))
        raw = (data.get("body") or "").strip() if ptype != envelope.TYPE_BINARY else data.get("body") or ""
        if ptype == envelope.TYPE_BITCOIN_TX:
            try:
                body = bytes.fromhex(raw)
            except ValueError:
                raise ValueError("Bitcoin transaction must be raw hex")
        elif ptype == envelope.TYPE_BINARY:
            body = base64.b64decode(raw)
        else:
            body = raw.encode("utf-8")
        msg = await service.send_message(ptype, body, data.get("encrypt"))
        logger.info(f"BitLink21 message queued for TX (type={data.get('payload_type')}) by {sid}")
        return {"success": True, "data": msg}
    except Exception as e:
        return _fail(logger, "send_message", e)


async def get_messages(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Result:
    try:
        await service.ensure_ready(sio)
        limit = int((data or {}).get("limit", 100))
        offset = int((data or {}).get("offset", 0))
        return {"success": True, "data": await service.list_messages(limit, offset)}
    except Exception as e:
        return _fail(logger, "get_messages", e)


async def delete_message(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Result:
    try:
        await service.ensure_ready(sio)
        ok = await store.delete_message(int((data or {})["id"]))
        return {"success": ok, "data": None} if ok else {"success": False, "error": "Message not found"}
    except Exception as e:
        return _fail(logger, "delete_message", e)


async def get_files(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Result:
    try:
        await service.ensure_ready(sio)
        return {"success": True, "data": await service.list_files()}
    except Exception as e:
        return _fail(logger, "get_files", e)


async def get_file(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Result:
    try:
        await service.ensure_ready(sio)
        row = await store.read_file(int((data or {})["id"]))
        if not row or row.get("data") is None:
            return {"success": False, "error": "File not found"}
        return {"success": True, "data": {
            "id": row["id"], "name": row["name"], "frame_type": row["frame_type"],
            "size": row["size"], "data_b64": base64.b64encode(row["data"]).decode("ascii"),
        }}
    except Exception as e:
        return _fail(logger, "get_file", e)


async def delete_file(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Result:
    try:
        await service.ensure_ready(sio)
        ok = await store.delete_file(int((data or {})["id"]))
        return {"success": ok, "data": None} if ok else {"success": False, "error": "File not found"}
    except Exception as e:
        return _fail(logger, "delete_file", e)


async def bitcoin_test_connection(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Result:
    """Test Bitcoin Core RPC with the saved (or supplied) settings."""
    import aiohttp

    await service.ensure_ready(sio)
    cfg = dict(service.settings["bitcoin"])
    for key in ("rpc_url", "rpc_user", "rpc_pass"):
        if data and data.get(key) and data.get(key) != "********":
            cfg[key] = data[key]
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                cfg["rpc_url"],
                json={"jsonrpc": "1.0", "id": "bitlink21", "method": "getblockchaininfo", "params": []},
                auth=aiohttp.BasicAuth(cfg["rpc_user"], cfg["rpc_pass"]),
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                result = await resp.json(content_type=None)
        if result.get("error"):
            return {"success": False, "error": f"RPC error: {result['error']}"}
        info = result.get("result", {})
        return {"success": True, "data": {"chain": info.get("chain"), "blocks": info.get("blocks")}}
    except Exception as e:
        return {"success": False, "error": f"Connection failed: {e}"}


def register_handlers(registry):
    """Register BitLink21 handlers with the command registry."""
    registry.register_batch(
        {
            "bitlink21:get_state": (get_state, "data_request"),
            "bitlink21:update_settings": (update_settings, "data_submission"),
            "bitlink21:start_station": (start_station, "data_submission"),
            "bitlink21:stop_station": (stop_station, "data_submission"),
            "bitlink21:calibrate_rx": (calibrate_rx, "data_submission"),
            "bitlink21:send_message": (send_message, "data_submission"),
            "bitlink21:get_messages": (get_messages, "data_request"),
            "bitlink21:delete_message": (delete_message, "data_submission"),
            "bitlink21:get_files": (get_files, "data_request"),
            "bitlink21:get_file": (get_file, "data_request"),
            "bitlink21:delete_file": (delete_file, "data_submission"),
            "bitlink21:bitcoin_test_connection": (bitcoin_test_connection, "data_submission"),
        }
    )
