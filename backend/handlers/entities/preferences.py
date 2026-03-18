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

"""Preference and map settings handlers."""

from typing import Any, Dict, Optional, Union

import crud
from db import AsyncSessionLocal
from handlers.entities.tracking import emit_tracker_data, emit_ui_tracker_values
from tracker.runner import get_tracker_manager


async def fetch_preferences(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Fetch all preferences.

    Args:
        sio: Socket.IO server instance
        data: Not used
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and preferences
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug("Fetching preferences")
        preferences = await crud.preferences.fetch_all_preferences(dbsession)
        return {"success": preferences["success"], "data": preferences.get("data", [])}


async def update_preferences(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """
    Update preferences.

    Args:
        sio: Socket.IO server instance
        data: List of preference updates
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated preferences
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Updating preferences, data: {data}")
        if not data:
            return {"success": False, "data": [], "error": "No data provided"}

        update_reply = await crud.preferences.set_preferences(dbsession, list(data))
        return {"success": update_reply["success"], "data": update_reply.get("data", [])}


async def get_map_settings(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Fetch map settings.

    Args:
        sio: Socket.IO server instance
        data: Map name
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and map settings
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Fetching map settings, data: {data}")
        map_settings = await crud.preferences.get_map_settings(dbsession, name=data)
        return {"success": map_settings["success"], "data": map_settings.get("data", [])}


async def set_map_settings(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict]]:
    """
    Update map settings and emit tracker data.

    Args:
        sio: Socket.IO server instance
        data: Map settings updates
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated map settings
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Updating map settings, data: {data}")
        map_settings_reply = await crud.preferences.set_map_settings(dbsession, data)

        # Emit tracker data so all browsers are informed of the change
        await emit_tracker_data(dbsession, sio, logger)
        await emit_ui_tracker_values(dbsession, sio, logger)
        if data and data.get("name") == "target-map-settings":
            manager = get_tracker_manager()
            manager.notify_map_settings_changed(data.get("value", {}))

        return {"success": map_settings_reply["success"], "data": map_settings_reply["data"]}


def register_handlers(registry):
    """Register preference handlers with the command registry."""
    registry.register_batch(
        {
            "fetch-preferences": (fetch_preferences, "data_request"),
            "update-preferences": (update_preferences, "data_submission"),
            "get-map-settings": (get_map_settings, "data_request"),
            "set-map-settings": (set_map_settings, "data_submission"),
        }
    )
