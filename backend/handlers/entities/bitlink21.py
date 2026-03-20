"""BitLink21 SSP messaging handlers for Socket.IO."""

from typing import Any, Dict, Optional, Union

from bitlink21.storage import storage
from bitlink21.beacon_afc import beacon_afc
from bitlink21.modem import get_scheme_list
from bitlink21.ber_test import ber_test
from bitlink21.tx_worker import tx_worker
from pipeline.orchestration.processmanager import process_manager
from dsp.qo100_manager import qo100_manager
from common.logger import logger


async def send_message(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """
    Queue a message for TX over the satellite link.

    Expected data keys:
        destination_npub (str|None), payload_type (str), body (str),
        encrypted (bool), broadcast (bool)
    """
    if not data:
        return {"success": False, "error": "No data provided"}

    payload_type = data.get("payload_type")
    body = data.get("body")
    if not payload_type or not body:
        return {"success": False, "error": "payload_type and body are required"}

    try:
        outbox_id = await storage.enqueue_message(
            {
                "destination_npub": data.get("destination_npub"),
                "payload_type": payload_type,
                "body": body,
            }
        )
        logger.info(
            f"BitLink21 message queued (outbox_id={outbox_id}, type={payload_type}) by {sid}"
        )
        return {"success": True, "data": {"outbox_id": outbox_id}}
    except Exception as e:
        logger.error(f"Failed to queue BitLink21 message: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def get_messages(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """
    Retrieve inbound message inbox.

    Optional data keys: limit (int), offset (int)
    """
    try:
        limit = int((data or {}).get("limit", 50))
        offset = int((data or {}).get("offset", 0))
        messages = await storage.get_messages(limit=limit, offset=offset)
        return {"success": True, "data": messages}
    except Exception as e:
        logger.error(f"Failed to get BitLink21 messages: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def get_outbox(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """
    Get outbox queue status and entries.

    Optional data keys: limit (int), offset (int)
    """
    try:
        limit = int((data or {}).get("limit", 50))
        offset = int((data or {}).get("offset", 0))
        entries = await storage.get_outbox(limit=limit, offset=offset)
        pending = await storage.get_outbox_pending_count()
        return {"success": True, "data": {"entries": entries, "pending_count": pending}}
    except Exception as e:
        logger.error(f"Failed to get BitLink21 outbox: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def get_identity(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str, None]]:
    """Get the current Nostr identity (NPUB)."""
    try:
        identity = await storage.get_identity()
        return {"success": True, "data": identity}
    except Exception as e:
        logger.error(f"Failed to get BitLink21 identity: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def set_identity(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """
    Set NPUB/NSEC key pair.

    Expected data keys: npub (str), nsec (str)
    """
    if not data:
        return {"success": False, "error": "No data provided"}

    npub = data.get("npub")
    nsec = data.get("nsec")
    if not npub or not nsec:
        return {"success": False, "error": "npub and nsec are required"}

    try:
        identity = await storage.set_identity(npub=npub, nsec=nsec)
        logger.info(f"BitLink21 identity set (npub={npub[:16]}...) by {sid}")
        return {"success": True, "data": identity}
    except Exception as e:
        logger.error(f"Failed to set BitLink21 identity: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def get_contacts(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """List all contacts in the address book."""
    try:
        contacts = await storage.get_contacts()
        return {"success": True, "data": contacts}
    except Exception as e:
        logger.error(f"Failed to get BitLink21 contacts: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def add_contact(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """
    Add a contact to the address book.

    Expected data keys: npub (str), nickname (str|None)
    """
    if not data:
        return {"success": False, "error": "No data provided"}

    npub = data.get("npub")
    if not npub:
        return {"success": False, "error": "npub is required"}

    try:
        contact = await storage.add_contact(npub=npub, nickname=data.get("nickname"))
        logger.info(f"BitLink21 contact added (npub={npub[:16]}...) by {sid}")
        return {"success": True, "data": contact}
    except Exception as e:
        logger.error(f"Failed to add BitLink21 contact: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def delete_contact(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, str]]:
    """
    Remove a contact from the address book.

    Expected data keys: npub (str)
    """
    if not data:
        return {"success": False, "error": "No data provided"}

    npub = data.get("npub")
    if not npub:
        return {"success": False, "error": "npub is required"}

    try:
        deleted = await storage.delete_contact(npub=npub)
        if deleted:
            logger.info(f"BitLink21 contact deleted (npub={npub[:16]}...) by {sid}")
            return {"success": True, "data": None}
        return {"success": False, "error": "Contact not found"}
    except Exception as e:
        logger.error(f"Failed to delete BitLink21 contact: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def get_config(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, str, None]]:
    """
    Get a BitLink21 config value.

    Expected data keys: key (str)
    """
    if not data or "key" not in data:
        return {"success": False, "error": "key is required"}

    try:
        value = await storage.get_config(key=data["key"])
        return {"success": True, "data": {"key": data["key"], "value": value}}
    except Exception as e:
        logger.error(f"Failed to get BitLink21 config: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def set_config(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, str]]:
    """
    Set a BitLink21 config value.

    Expected data keys: key (str), value (str)
    """
    if not data:
        return {"success": False, "error": "No data provided"}

    key = data.get("key")
    value = data.get("value")
    if not key:
        return {"success": False, "error": "key is required"}

    try:
        await storage.set_config(key=key, value=value)
        logger.info(f"BitLink21 config set (key={key}) by {sid}")
        return {"success": True, "data": {"key": key, "value": value}}
    except Exception as e:
        logger.error(f"Failed to set BitLink21 config: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def get_stats(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Get SSP messaging statistics."""
    try:
        stats = await storage.get_stats()
        return {"success": True, "data": stats}
    except Exception as e:
        logger.error(f"Failed to get BitLink21 stats: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def beacon_start(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Start beacon tracking in PlutoSDR worker process."""
    try:
        # Send beacon config to PlutoSDR worker via config_queue
        running = process_manager.get_running_sdrs()
        if not running:
            return {"success": False, "error": "No SDR running"}

        sdr_id = running[0]["sdr_id"]
        config_queue = process_manager.processes.get(sdr_id, {}).get("config_queue")
        if not config_queue:
            return {"success": False, "error": "SDR config queue not available"}

        config_queue.put({
            "beacon_start": True,
            "beacon_freq": (data or {}).get("beacon_freq_hz", 0),
            "marker_low": (data or {}).get("marker_low_hz", 0),
            "marker_high": (data or {}).get("marker_high_hz", 0),
        })
        logger.info(f"Beacon start command sent to PlutoSDR worker")
        return {"success": True, "data": {"lock_state": "TRACKING"}}
    except Exception as e:
        logger.error(f"Failed to start beacon: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def beacon_stop(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Stop beacon tracking in PlutoSDR worker process."""
    try:
        running = process_manager.get_running_sdrs()
        if running:
            sdr_id = running[0]["sdr_id"]
            config_queue = process_manager.processes.get(sdr_id, {}).get("config_queue")
            if config_queue:
                config_queue.put({"beacon_stop": True})
        return {"success": True, "data": {"lock_state": "UNLOCKED"}}
    except Exception as e:
        logger.error(f"Failed to stop beacon: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def beacon_config(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Update beacon tracking config in PlutoSDR worker."""
    if not data:
        return {"success": False, "error": "No data provided"}
    try:
        running = process_manager.get_running_sdrs()
        if running:
            sdr_id = running[0]["sdr_id"]
            config_queue = process_manager.processes.get(sdr_id, {}).get("config_queue")
            if config_queue:
                config_queue.put({
                    "beacon_config": True,
                    "marker_low": data.get("marker_low_hz"),
                    "marker_high": data.get("marker_high_hz"),
                    "beacon_freq": data.get("beacon_freq_hz"),
                })
        return {"success": True}
    except Exception as e:
        logger.error(f"Failed to configure beacon: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def get_beacon_status(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Get current beacon status from beacon_afc module."""
    status = beacon_afc.get_status()
    return {"success": True, "data": status}


async def get_modem_schemes(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """Get list of available modulation schemes."""
    return {"success": True, "data": get_scheme_list()}


async def ber_test_start(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Start BER test — generate and queue PRBS data for TX."""
    try:
        if data:
            ber_test.configure(data)
        ber_test.set_sio(sio)
        tx_data = ber_test.start_tx()
        # Queue the PRBS data for TX via send_message
        outbox_id = await storage.enqueue_message({
            "destination_npub": None,
            "payload_type": "binary",
            "body": tx_data.hex(),
        })
        logger.info(f"BER test TX queued: {len(tx_data)} bytes, outbox_id={outbox_id}")
        return {"success": True, "data": ber_test.get_results()}
    except Exception as e:
        logger.error(f"Failed to start BER test: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def ber_test_stop(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Stop BER test."""
    ber_test.stop()
    return {"success": True, "data": ber_test.get_results()}


async def get_ber_results(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Get BER test results."""
    return {"success": True, "data": ber_test.get_results()}


async def ptt_on(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Activate PTT — start draining outbox and transmitting."""
    try:
        if data:
            tx_worker.configure(data)
        tx_worker.set_ptt(True)
        return {"success": True, "data": tx_worker.get_status()}
    except Exception as e:
        logger.error(f"Failed to activate PTT: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def ptt_off(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Deactivate PTT — stop transmitting."""
    tx_worker.set_ptt(False)
    return {"success": True, "data": tx_worker.get_status()}


async def get_tx_status(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Get TX worker status."""
    return {"success": True, "data": tx_worker.get_status()}


async def bitcoin_test_connection(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Test Bitcoin Core RPC connection (backend proxy to avoid CORS)."""
    if not data:
        return {"success": False, "error": "No data provided"}
    try:
        import urllib.request
        import json
        import base64

        rpc_url = data.get("rpc_url", "http://localhost:8332")
        rpc_user = data.get("rpc_user", "")
        rpc_pass = data.get("rpc_pass", "")

        auth = base64.b64encode(f"{rpc_user}:{rpc_pass}".encode()).decode()
        req = urllib.request.Request(
            rpc_url,
            data=json.dumps({"jsonrpc": "1.0", "id": "test", "method": "getblockchaininfo", "params": []}).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Basic {auth}"},
        )
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read())
        chain = result.get("result", {}).get("chain", "unknown")
        blocks = result.get("result", {}).get("blocks", 0)
        return {"success": True, "data": {"message": f"Connected! Chain: {chain}, Blocks: {blocks}"}}
    except Exception as e:
        return {"success": False, "error": f"Connection failed: {str(e)}"}


async def test_tone_start(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Start TX test tone via PlutoSDR worker config_queue."""
    try:
        from pipeline.orchestration.processmanager import process_manager
        running = process_manager.get_running_sdrs()
        if not running:
            return {"success": False, "error": "No SDR running — start streaming first"}

        sdr_id = running[0]["sdr_id"]
        config_queue = process_manager.processes.get(sdr_id, {}).get("config_queue")
        if not config_queue:
            return {"success": False, "error": "SDR config queue not available"}

        tone_freq = (data or {}).get("tone_freq_hz", 1000)
        tone_gain = (data or {}).get("tx_gain_db", -20)
        config_queue.put({
            "test_tone_start": True,
            "tone_freq_hz": tone_freq,
            "tone_gain_db": tone_gain,
        })
        return {"success": True, "data": {"active": True, "tone_freq_hz": tone_freq}}
    except Exception as e:
        logger.error(f"Failed to start test tone: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def test_tone_stop(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Stop TX test tone via PlutoSDR worker config_queue."""
    try:
        from pipeline.orchestration.processmanager import process_manager
        running = process_manager.get_running_sdrs()
        if running:
            sdr_id = running[0]["sdr_id"]
            config_queue = process_manager.processes.get(sdr_id, {}).get("config_queue")
            if config_queue:
                config_queue.put({"test_tone_stop": True})
        return {"success": True, "data": {"active": False}}
    except Exception as e:
        logger.error(f"Failed to stop test tone: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def qo100_start(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Start QO-100 streaming DSP in PlutoSDR worker process."""
    try:
        running = process_manager.get_running_sdrs()
        if not running:
            return {"success": False, "error": "No SDR running — start streaming first"}
        sdr_id = running[0]["sdr_id"]
        config_queue = process_manager.processes.get(sdr_id, {}).get("config_queue")
        if not config_queue:
            return {"success": False, "error": "SDR config queue not available"}

        config_queue.put({
            "qo100_start": True,
            "qo100_filter_bw": (data or {}).get("filter_bw", 3600),
            "qo100_modulation": (data or {}).get("modulation", "qpsk"),
            "qo100_baudrate": (data or {}).get("baudrate", 4800),
        })
        return {"success": True, "data": {"status": "starting"}}
    except Exception as e:
        logger.error(f"QO-100 start failed: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def qo100_stop(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Stop QO-100 streaming DSP."""
    try:
        running = process_manager.get_running_sdrs()
        if running:
            sdr_id = running[0]["sdr_id"]
            config_queue = process_manager.processes.get(sdr_id, {}).get("config_queue")
            if config_queue:
                config_queue.put({"qo100_stop": True})
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def qo100_set_filter(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Set QO-100 RX filter bandwidth."""
    try:
        running = process_manager.get_running_sdrs()
        if running:
            sdr_id = running[0]["sdr_id"]
            config_queue = process_manager.processes.get(sdr_id, {}).get("config_queue")
            if config_queue:
                config_queue.put({
                    "qo100_set_filter": True,
                    "bandwidth": (data or {}).get("bandwidth", 3600),
                })
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def qo100_set_modulation(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Set QO-100 modem modulation and baudrate."""
    try:
        running = process_manager.get_running_sdrs()
        if running:
            sdr_id = running[0]["sdr_id"]
            config_queue = process_manager.processes.get(sdr_id, {}).get("config_queue")
            if config_queue:
                config_queue.put({
                    "qo100_set_modulation": True,
                    "modulation": (data or {}).get("modulation", "qpsk"),
                    "baudrate": (data or {}).get("baudrate", 4800),
                })
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def qo100_get_status(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """Get QO-100 DSP status from the manager singleton."""
    status = qo100_manager.get_status()
    return {"success": True, "data": status}


def register_handlers(registry):
    """Register BitLink21 handlers with the command registry."""
    registry.register_batch(
        {
            "bitlink21:send_message": (send_message, "data_submission"),
            "bitlink21:get_messages": (get_messages, "data_request"),
            "bitlink21:get_outbox": (get_outbox, "data_request"),
            "bitlink21:get_identity": (get_identity, "data_request"),
            "bitlink21:set_identity": (set_identity, "data_submission"),
            "bitlink21:get_contacts": (get_contacts, "data_request"),
            "bitlink21:add_contact": (add_contact, "data_submission"),
            "bitlink21:delete_contact": (delete_contact, "data_submission"),
            "bitlink21:get_config": (get_config, "data_request"),
            "bitlink21:set_config": (set_config, "data_submission"),
            "bitlink21:get_stats": (get_stats, "data_request"),
            "bitlink21:beacon_start": (beacon_start, "data_submission"),
            "bitlink21:beacon_stop": (beacon_stop, "data_submission"),
            "bitlink21:beacon_config": (beacon_config, "data_submission"),
            "bitlink21:get_beacon_status": (get_beacon_status, "data_request"),
            "bitlink21:get_modem_schemes": (get_modem_schemes, "data_request"),
            "bitlink21:ber_test_start": (ber_test_start, "data_submission"),
            "bitlink21:ber_test_stop": (ber_test_stop, "data_submission"),
            "bitlink21:get_ber_results": (get_ber_results, "data_request"),
            "bitlink21:bitcoin_test_connection": (bitcoin_test_connection, "data_submission"),
            "bitlink21:ptt_on": (ptt_on, "data_submission"),
            "bitlink21:ptt_off": (ptt_off, "data_submission"),
            "bitlink21:get_tx_status": (get_tx_status, "data_request"),
            "bitlink21:test_tone_start": (test_tone_start, "data_submission"),
            "bitlink21:test_tone_stop": (test_tone_stop, "data_submission"),
            "bitlink21:qo100_start": (qo100_start, "data_submission"),
            "bitlink21:qo100_stop": (qo100_stop, "data_submission"),
            "bitlink21:qo100_set_filter": (qo100_set_filter, "data_submission"),
            "bitlink21:qo100_set_modulation": (qo100_set_modulation, "data_submission"),
            "bitlink21:qo100_get_status": (qo100_get_status, "data_request"),
        }
    )
