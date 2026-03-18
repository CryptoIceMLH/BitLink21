"""BitLink21 SSP messaging handlers for Socket.IO."""

from typing import Any, Dict, Optional, Union

from bitlink21.storage import storage
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
        }
    )
