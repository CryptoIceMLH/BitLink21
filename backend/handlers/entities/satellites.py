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

"""Satellite data handlers."""

from typing import Any, Dict, Optional, Union

import crud
from db import AsyncSessionLocal
from tracker.data import compiled_satellite_data
from tracker.runner import get_tracker_manager


async def get_satellites(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Get list of satellites.

    Args:
        sio: Socket.IO server instance
        data: Filter parameters
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and satellite data
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Getting satellites, data: {data}")
        satellites = await crud.satellites.fetch_satellites(dbsession, data)
        return {"success": satellites["success"], "data": satellites.get("data", [])}


async def get_satellite(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict]]:
    """
    Get single satellite with complete details (position, coverage, etc.).

    Args:
        sio: Socket.IO server instance
        data: Satellite identifier
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and satellite data
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Getting satellite data for norad id, data: {data}")
        try:
            satellite_data = await compiled_satellite_data(dbsession, data)
            return {"success": True, "data": satellite_data}
        except Exception as e:
            logger.error(f"Error: {e}")
            return {"success": False, "data": {}}


async def get_satellites_for_group_id(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Get satellites for a specific group ID with their transmitters.

    Args:
        sio: Socket.IO server instance
        data: Group ID
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and satellites data
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Getting satellites for group id, data: {data}")
        satellites = await crud.satellites.fetch_satellites_for_group_id(dbsession, data)

        # Get transmitters for each satellite
        if satellites:
            for satellite in satellites.get("data", []):
                transmitters = await crud.transmitters.fetch_transmitters_for_satellite(
                    dbsession, satellite["norad_id"]
                )
                satellite["transmitters"] = transmitters["data"]
        else:
            logger.debug(f"No satellites found for group id: {data}")

        return {"success": satellites["success"], "data": satellites.get("data", [])}


async def search_satellites(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Search satellites by keyword with their transmitters.

    Args:
        sio: Socket.IO server instance
        data: Search keyword
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and search results
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Searching satellites, data: {data}")
        satellites = await crud.satellites.search_satellites(dbsession, keyword=data)

        # Get transmitters for each satellite (same as get_satellites_for_group_id)
        if satellites:
            for satellite in satellites.get("data", []):
                transmitters = await crud.transmitters.fetch_transmitters_for_satellite(
                    dbsession, satellite["norad_id"]
                )
                satellite["transmitters"] = transmitters["data"]
        else:
            logger.debug(f"No satellites found for search keyword: {data}")

        return {"success": satellites["success"], "data": satellites.get("data", [])}


async def delete_satellite(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Delete a satellite.

    Args:
        sio: Socket.IO server instance
        data: Satellite identifier
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated satellites list
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Delete satellite, data: {data}")
        delete_reply = await crud.satellites.delete_satellite(dbsession, data)

        satellites = await crud.satellites.fetch_satellites(dbsession, None)
        return {
            "success": (satellites["success"] & delete_reply["success"]),
            "data": satellites.get("data", []),
        }


async def submit_satellite(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """
    Add a new satellite.

    Args:
        sio: Socket.IO server instance
        data: Satellite details
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated satellites list
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Adding satellite, data: {data}")
        submit_reply = await crud.satellites.add_satellite(dbsession, data)

        satellites = await crud.satellites.fetch_satellites(dbsession, None)
        if data and data.get("norad_id"):
            manager = get_tracker_manager()
            await manager.notify_tle_updated(data.get("norad_id"))
        return {
            "success": (satellites["success"] & submit_reply["success"]),
            "data": satellites.get("data", []),
            "error": submit_reply.get("error"),
        }


async def edit_satellite(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """
    Edit an existing satellite.

    Args:
        sio: Socket.IO server instance
        data: Satellite NORAD ID and updated details
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated satellites list
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Editing satellite, data: {data}")
        if not data or "norad_id" not in data:
            return {"success": False, "data": [], "error": "Missing satellite NORAD ID"}

        update_data = {key: value for key, value in data.items() if key != "norad_id"}
        edit_reply = await crud.satellites.edit_satellite(
            dbsession, data["norad_id"], **update_data
        )

        satellites = await crud.satellites.fetch_satellites(dbsession, None)
        manager = get_tracker_manager()
        await manager.notify_tle_updated(data.get("norad_id"))
        return {
            "success": (satellites["success"] & edit_reply["success"]),
            "data": satellites.get("data", []),
            "error": edit_reply.get("error"),
        }


async def sync_satellite_data(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, None, str]]:
    """
    Synchronize satellite data with known TLE sources as a background task.

    This handler starts TLE synchronization as a background task, making it:
    - Visible in the task manager UI
    - Cancellable by users
    - Consistent with scheduled sync behavior

    Args:
        sio: Socket.IO server instance (not used, kept for signature compatibility)
        data: Not used
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and task_id
    """
    try:
        from server.startup import background_task_manager
        from tasks.registry import get_task

        if not background_task_manager:
            logger.error("Background task manager not initialized")
            return {"success": False, "error": "Background task manager not initialized"}

        logger.info("Starting TLE synchronization as background task (manual trigger)")

        # Get the TLE sync task function
        tle_sync_task = get_task("tle_sync")

        # Start as background task
        task_id = await background_task_manager.start_task(
            func=tle_sync_task, args=(), kwargs={}, name="Manual TLE Sync", task_id=None
        )

        logger.info(f"Manual TLE sync started as background task: {task_id}")
        return {"success": True, "task_id": task_id}

    except ValueError as e:
        # Singleton task already running (e.g., TLE sync already in progress)
        logger.warning(f"TLE sync already running: {e}")
        return {"success": False, "error": str(e)}

    except Exception as e:
        logger.error(f"Error starting TLE synchronization: {e}")
        return {"success": False, "error": str(e)}


def register_handlers(registry):
    """Register satellite handlers with the command registry."""
    registry.register_batch(
        {
            "get-satellites": (get_satellites, "data_request"),
            "get-satellite": (get_satellite, "data_request"),
            "get-satellites-for-group-id": (get_satellites_for_group_id, "data_request"),
            "get-satellite-search": (search_satellites, "data_request"),
            "submit-satellite": (submit_satellite, "data_submission"),
            "edit-satellite": (edit_satellite, "data_submission"),
            "delete-satellite": (delete_satellite, "data_submission"),
            "sync-satellite-data": (sync_satellite_data, "data_request"),
        }
    )
