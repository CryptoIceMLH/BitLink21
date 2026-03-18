# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

"""TLE source handlers."""

from typing import Any, Dict, Optional, Union

import crud
from db import AsyncSessionLocal
from tlesync.state import sync_state_manager


async def get_tle_sources(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Get all TLE sources.

    Args:
        sio: Socket.IO server instance
        data: Not used
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and TLE sources
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug("Getting TLE sources")
        tle_sources = await crud.tlesources.fetch_satellite_tle_source(dbsession)
        return {"success": tle_sources["success"], "data": tle_sources.get("data", [])}


async def submit_tle_source(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Add a new TLE source.

    Args:
        sio: Socket.IO server instance
        data: TLE source details
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated TLE sources
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Adding TLE source, data: {data}")
        submit_reply = await crud.tlesources.add_satellite_tle_source(dbsession, data)

        tle_sources = await crud.tlesources.fetch_satellite_tle_source(dbsession)
        return {
            "success": (tle_sources["success"] & submit_reply["success"]),
            "data": tle_sources.get("data", []),
        }


async def edit_tle_source(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """
    Edit an existing TLE source.

    Args:
        sio: Socket.IO server instance
        data: TLE source ID and updated details
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated TLE sources
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Editing TLE source, data: {data}")
        if not data or "id" not in data:
            return {"success": False, "data": [], "error": "Missing TLE source ID"}

        edit_reply = await crud.tlesources.edit_satellite_tle_source(dbsession, data["id"], data)

        tle_sources = await crud.tlesources.fetch_satellite_tle_source(dbsession)
        return {
            "success": (tle_sources["success"] & edit_reply["success"]),
            "data": tle_sources.get("data", []),
        }


async def delete_tle_sources(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, dict, str]]:
    """
    Delete TLE sources.

    Args:
        sio: Socket.IO server instance
        data: List of TLE source IDs to delete
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status, updated TLE sources, and deletion summary
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Deleting TLE source, data: {data}")
        delete_reply = await crud.tlesources.delete_satellite_tle_sources(dbsession, data)

        tle_sources = await crud.tlesources.fetch_satellite_tle_source(dbsession)
        return {
            "success": (tle_sources["success"] & delete_reply["success"]),
            "data": tle_sources.get("data", []),
            "summary": delete_reply.get("deletion_summary", None),
            "message": delete_reply.get("data", None),
        }


async def fetch_sync_state(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict]]:
    """
    Get TLE synchronization state.

    Args:
        sio: Socket.IO server instance
        data: Not used
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and sync state
    """
    logger.debug("Getting TLE synchronization state")
    return {"success": True, "data": sync_state_manager.get_state()}


def register_handlers(registry):
    """Register TLE source handlers with the command registry."""
    registry.register_batch(
        {
            "get-tle-sources": (get_tle_sources, "data_request"),
            "submit-tle-sources": (submit_tle_source, "data_submission"),
            "edit-tle-source": (edit_tle_source, "data_submission"),
            "delete-tle-sources": (delete_tle_sources, "data_submission"),
            "fetch-sync-state": (fetch_sync_state, "data_request"),
        }
    )
