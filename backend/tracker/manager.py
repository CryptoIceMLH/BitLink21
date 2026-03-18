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

"""
TrackerManager: Clean interface for controlling the satellite tracker.

The tracker loop polls the database for tracking state changes. This manager
provides a simple API to update that state without directly coupling to the
database schema.
"""

import asyncio
import logging
from typing import Any, Dict, Optional

import crud
from common.constants import TrackingStateNames
from db import AsyncSessionLocal
from tracker.ipc import (
    TRACKER_MSG_COMMAND,
    TRACKER_MSG_SET_HARDWARE,
    TRACKER_MSG_SET_LOCATION,
    TRACKER_MSG_SET_MAP_SETTINGS,
    TRACKER_MSG_SET_SATELLITE_EPHEMERIS,
    TRACKER_MSG_SET_TRACKING_STATE,
    TRACKER_MSG_SET_TRANSMITTERS,
    build_tracker_message,
)

logger = logging.getLogger("tracker-manager")


class TrackerManager:
    """
    Manager for controlling the satellite tracker through database state updates.

    The tracker loop continuously polls the 'satellite-tracking' state record
    in the database. This manager provides a clean interface to update that
    state, which the tracker will pick up on its next iteration (~2 seconds).
    """

    def __init__(self, queue_to_tracker=None):
        self.queue_to_tracker = queue_to_tracker
        self.current_tracking_state: Optional[Dict[str, Any]] = None

    def _send_to_tracker(self, msg_type: str, payload: Dict[str, Any]) -> None:
        if not self.queue_to_tracker:
            logger.warning("Tracker queue not initialized; skipping IPC send")
            return
        self.queue_to_tracker.put(build_tracker_message(msg_type, payload))

    async def _ensure_tracking_state(self) -> Optional[Dict[str, Any]]:
        if self.current_tracking_state:
            return self.current_tracking_state
        async with AsyncSessionLocal() as dbsession:
            current_state_reply = await crud.trackingstate.get_tracking_state(
                dbsession, name=TrackingStateNames.SATELLITE_TRACKING
            )
        if not current_state_reply.get("success"):
            logger.error(f"Failed to get tracking state: {current_state_reply}")
            return None
        current_value = (current_state_reply.get("data") or {}).get("value", {})
        if not current_value:
            return None
        self.current_tracking_state = dict(current_value)
        return self.current_tracking_state

    async def update_tracking_state(self, **kwargs) -> Dict[str, Any]:
        """
        Update any fields in the satellite tracking state.

        The tracker loop will detect these changes on its next iteration and
        respond accordingly (e.g., connecting hardware, changing satellites).

        Args:
            norad_id (int, optional): NORAD ID of satellite to track
            group_id (str, optional): UUID of satellite group
            rotator_state (str, optional): Rotator state - "connected", "disconnected",
                                          "tracking", "stopped", "parked"
            rig_state (str, optional): Rig state - "connected", "disconnected", "tuning"
            rotator_id (str, optional): UUID of rotator hardware or "none"
            rig_id (str, optional): UUID of rig hardware or "none"
            transmitter_id (str, optional): UUID of transmitter or "none"
            rig_vfo (str, optional): VFO configuration or "none"
            vfo1 (str, optional): VFO1 mode - "uplink" or "downlink"
            vfo2 (str, optional): VFO2 mode - "uplink" or "downlink"

        Returns:
            dict: Response from database operation with 'success' and 'data' fields

        Example:
            # Change target satellite
            await manager.update_tracking_state(norad_id=25544, group_id="abc-123")

            # Connect rotator
            await manager.update_tracking_state(rotator_state="connected")

            # Update multiple fields
            await manager.update_tracking_state(
                norad_id=20442,
                rotator_state="connected",
                rotator_id="2fb00a81-c0fd-4848-ab40-3101751d0534"
            )
        """
        if not kwargs:
            logger.warning("update_tracking_state called with no arguments")
            return {"success": False, "error": "No fields provided to update"}

        async with AsyncSessionLocal() as dbsession:
            # Get current tracking state
            current_state_reply = await crud.trackingstate.get_tracking_state(
                dbsession, name=TrackingStateNames.SATELLITE_TRACKING
            )

            if not current_state_reply.get("success"):
                logger.error(f"Failed to get current tracking state: {current_state_reply}")
                return dict(current_state_reply)

            # Merge new values with existing state
            # Handle case where data is None (tracking state doesn't exist yet)
            current_value = (current_state_reply.get("data") or {}).get("value", {})
            updated_value = {**current_value, **kwargs}

            # Update tracking state in database
            result = await crud.trackingstate.set_tracking_state(
                dbsession,
                {
                    "name": TrackingStateNames.SATELLITE_TRACKING,
                    "value": updated_value,
                },
            )

            if result.get("success"):
                self.current_tracking_state = dict(updated_value)
                logger.info(
                    f"Updated tracking state: {', '.join(f'{k}={v}' for k, v in kwargs.items())}"
                )
            else:
                logger.error(f"Failed to update tracking state: {result}")

            if result.get("success"):
                await self._sync_tracker_context(updated_value)

            return dict(result)

    async def get_tracking_state(self) -> Optional[Dict[str, Any]]:
        """
        Get the current satellite tracking state from the database.

        Returns:
            dict or None: Current tracking state value containing norad_id, group_id,
                         rotator_state, rig_state, hardware IDs, etc. Returns None
                         if no tracking state exists.

        Example:
            state = await manager.get_tracking_state()
            # Returns: {
            #     "norad_id": 20442,
            #     "group_id": "8d8bdad0-...",
            #     "rotator_state": "connected",
            #     "rig_state": "disconnected",
            #     "rotator_id": "2fb00a81-...",
            #     ...
            # }
        """
        async with AsyncSessionLocal() as dbsession:
            result = await crud.trackingstate.get_tracking_state(
                dbsession, name=TrackingStateNames.SATELLITE_TRACKING
            )

            if result.get("success") and result.get("data"):
                value = result["data"].get("value")
                self.current_tracking_state = dict(value) if value else None
                return dict(value) if value else None

            logger.warning(f"Failed to get tracking state: {result}")
            return None

    async def stop_tracking(self) -> Dict[str, Any]:
        """
        Stop all tracking and disconnect hardware.

        This is a convenience method that sets both rotator and rig states
        to disconnected.

        Returns:
            dict: Response from database operation
        """
        return await self.update_tracking_state(
            rotator_state="disconnected",
            rig_state="disconnected",
        )

    async def notify_transmitters_changed(self, norad_id: int) -> None:
        logger.info(
            "notify_transmitters_changed called (norad_id=%s, tracking=%s)",
            norad_id,
            (self.current_tracking_state or {}).get("norad_id"),
        )
        if not norad_id:
            logger.debug("notify_transmitters_changed: no norad_id provided")
            return
        tracking_state = await self._ensure_tracking_state()
        if not tracking_state:
            logger.debug("notify_transmitters_changed: no tracking state available")
            return
        if str(tracking_state.get("norad_id")) != str(norad_id):
            logger.info(
                "notify_transmitters_changed: norad_id mismatch (tracking=%s notify=%s)",
                tracking_state.get("norad_id"),
                norad_id,
            )
            logger.debug(
                "notify_transmitters_changed: norad_id mismatch (tracking=%s notify=%s)",
                tracking_state.get("norad_id"),
                norad_id,
            )
            return
        logger.info("notify_transmitters_changed: fetching transmitters (norad_id=%s)", norad_id)
        async with AsyncSessionLocal() as dbsession:
            try:
                transmitters = await asyncio.wait_for(
                    crud.transmitters.fetch_transmitters_for_satellite(
                        dbsession, norad_id=norad_id
                    ),
                    timeout=5.0,
                )
            except asyncio.TimeoutError:
                logger.error(
                    "notify_transmitters_changed: fetch_transmitters timed out (norad_id=%s)",
                    norad_id,
                )
                return
        logger.info(
            "notify_transmitters_changed: fetch complete (norad_id=%s, success=%s, count=%s)",
            norad_id,
            transmitters.get("success"),
            len(transmitters.get("data", [])) if transmitters.get("data") else 0,
        )
        if transmitters.get("success"):
            logger.info(
                "notify_transmitters_changed: sending %s transmitters for norad_id=%s",
                len(transmitters.get("data", [])),
                norad_id,
            )
            logger.debug(
                "notify_transmitters_changed: sending %s transmitters for norad_id=%s",
                len(transmitters.get("data", [])),
                norad_id,
            )
            self._send_to_tracker(
                TRACKER_MSG_SET_TRANSMITTERS, {"items": transmitters.get("data", [])}
            )
        else:
            logger.debug(
                "notify_transmitters_changed: failed to fetch transmitters for norad_id=%s (%s)",
                norad_id,
                transmitters.get("error"),
            )

    def notify_transmitters_changed_with_items(
        self, norad_id: int, transmitters: list[dict]
    ) -> None:
        if not norad_id:
            return
        if not transmitters:
            logger.info(
                "notify_transmitters_changed_with_items: no transmitters for norad_id=%s",
                norad_id,
            )
            return
        tracking_state = self.current_tracking_state or {}
        if str(tracking_state.get("norad_id")) != str(norad_id):
            return
        logger.info(
            "notify_transmitters_changed_with_items: sending %s transmitters for norad_id=%s",
            len(transmitters),
            norad_id,
        )
        self._send_to_tracker(TRACKER_MSG_SET_TRANSMITTERS, {"items": transmitters})

    async def notify_tle_updated(self, norad_id: int) -> None:
        if not norad_id:
            logger.debug("notify_tle_updated: no norad_id provided")
            return
        tracking_state = await self._ensure_tracking_state()
        if not tracking_state:
            logger.debug("notify_tle_updated: no tracking state available")
            return
        if str(tracking_state.get("norad_id")) != str(norad_id):
            logger.debug(
                "notify_tle_updated: norad_id mismatch (tracking=%s notify=%s)",
                tracking_state.get("norad_id"),
                norad_id,
            )
            return
        logger.info("notify_tle_updated: fetching satellite record (norad_id=%s)", norad_id)
        async with AsyncSessionLocal() as dbsession:
            try:
                satellites = await asyncio.wait_for(
                    crud.satellites.fetch_satellites(dbsession, norad_id=norad_id),
                    timeout=5.0,
                )
            except asyncio.TimeoutError:
                logger.error(
                    "notify_tle_updated: fetch_satellites timed out (norad_id=%s)", norad_id
                )
                return
        if not satellites.get("success") or not satellites.get("data"):
            logger.debug(
                "notify_tle_updated: satellite not found for norad_id=%s (%s)",
                norad_id,
                satellites.get("error"),
            )
            return
        sat = satellites["data"][0]
        logger.info("notify_tle_updated: sending TLE update for norad_id=%s", norad_id)
        logger.debug("notify_tle_updated: sending TLE update for norad_id=%s", norad_id)
        self._send_to_tracker(
            TRACKER_MSG_SET_SATELLITE_EPHEMERIS,
            {
                "norad_id": sat.get("norad_id"),
                "name": sat.get("name"),
                "tle1": sat.get("tle1"),
                "tle2": sat.get("tle2"),
            },
        )

    async def notify_tracking_inputs_from_db(self, norad_id: int) -> None:
        if not norad_id:
            logger.debug("notify_tracking_inputs_from_db: no norad_id provided")
            return
        tracking_state = await self._ensure_tracking_state()
        if not tracking_state:
            logger.debug("notify_tracking_inputs_from_db: no tracking state available")
            return
        if str(tracking_state.get("norad_id")) != str(norad_id):
            return
        async with AsyncSessionLocal() as dbsession:
            try:
                satellites = await asyncio.wait_for(
                    crud.satellites.fetch_satellites(dbsession, norad_id=norad_id),
                    timeout=5.0,
                )
                transmitters = await asyncio.wait_for(
                    crud.transmitters.fetch_transmitters_for_satellite(
                        dbsession, norad_id=norad_id
                    ),
                    timeout=5.0,
                )
            except asyncio.TimeoutError:
                logger.error(
                    "notify_tracking_inputs_from_db: fetch timed out (norad_id=%s)", norad_id
                )
                return
        if satellites.get("success") and satellites.get("data"):
            sat = satellites["data"][0]
            self._send_to_tracker(
                TRACKER_MSG_SET_SATELLITE_EPHEMERIS,
                {
                    "norad_id": sat.get("norad_id"),
                    "name": sat.get("name"),
                    "tle1": sat.get("tle1"),
                    "tle2": sat.get("tle2"),
                },
            )
        if transmitters.get("success"):
            self._send_to_tracker(
                TRACKER_MSG_SET_TRANSMITTERS,
                {"items": transmitters.get("data", [])},
            )

    async def sync_tracking_state_from_db(self) -> None:
        async with AsyncSessionLocal() as dbsession:
            current_state_reply = await crud.trackingstate.get_tracking_state(
                dbsession, name=TrackingStateNames.SATELLITE_TRACKING
            )
        if not current_state_reply.get("success"):
            logger.error(f"Failed to get tracking state: {current_state_reply}")
            return
        current_value = (current_state_reply.get("data") or {}).get("value", {})
        if not current_value:
            return
        self.current_tracking_state = dict(current_value)
        await self._sync_tracker_context(self.current_tracking_state)

    async def notify_locations_changed(self) -> None:
        async with AsyncSessionLocal() as dbsession:
            locations = await crud.locations.fetch_all_locations(dbsession)
        if locations.get("success") and locations.get("data"):
            self._send_to_tracker(TRACKER_MSG_SET_LOCATION, locations["data"][0])

    def notify_map_settings_changed(self, map_settings: Dict[str, Any]) -> None:
        if map_settings:
            self._send_to_tracker(TRACKER_MSG_SET_MAP_SETTINGS, dict(map_settings))

    async def notify_hardware_changed(
        self, rig_id: Optional[str] = None, rotator_id: Optional[str] = None
    ) -> None:
        if not self.current_tracking_state:
            return
        payload: Dict[str, Any] = {}
        async with AsyncSessionLocal() as dbsession:
            if rig_id:
                if self.current_tracking_state.get("rig_id") != rig_id:
                    rig_id = None
                else:
                    rigs = await crud.hardware.fetch_rigs(dbsession, rig_id=rig_id)
                    if rigs.get("success") and rigs.get("data"):
                        payload["rig"] = rigs["data"]
                        payload["rig_type"] = "radio"
                    else:
                        sdrs = await crud.hardware.fetch_sdr(dbsession, sdr_id=rig_id)
                        if sdrs.get("success") and sdrs.get("data"):
                            payload["sdr"] = sdrs["data"]
                            payload["rig_type"] = "sdr"
            if rotator_id:
                if self.current_tracking_state.get("rotator_id") != rotator_id:
                    rotator_id = None
                else:
                    rotators = await crud.hardware.fetch_rotators(dbsession, rotator_id=rotator_id)
                    if rotators.get("success") and rotators.get("data"):
                        payload["rotator"] = rotators["data"]

        if payload:
            self._send_to_tracker(TRACKER_MSG_SET_HARDWARE, payload)

    async def _sync_tracker_context(self, tracking_state: Dict[str, Any]) -> None:
        """Push a snapshot of inputs the tracker normally reads from the DB."""
        self._send_to_tracker(TRACKER_MSG_SET_TRACKING_STATE, dict(tracking_state))

        async with AsyncSessionLocal() as dbsession:
            locations = await crud.locations.fetch_all_locations(dbsession)
            if locations.get("success") and locations.get("data"):
                self._send_to_tracker(TRACKER_MSG_SET_LOCATION, locations["data"][0])

            map_settings_reply = await crud.preferences.get_map_settings(
                dbsession, "target-map-settings"
            )
            map_settings = (map_settings_reply.get("data") or {}).get("value", {})
            self._send_to_tracker(TRACKER_MSG_SET_MAP_SETTINGS, map_settings)

            norad_id = tracking_state.get("norad_id")
            if norad_id:
                satellites = await crud.satellites.fetch_satellites(dbsession, norad_id=norad_id)
                if satellites.get("success") and satellites.get("data"):
                    sat = satellites["data"][0]
                    self._send_to_tracker(
                        TRACKER_MSG_SET_SATELLITE_EPHEMERIS,
                        {
                            "norad_id": sat.get("norad_id"),
                            "name": sat.get("name"),
                            "tle1": sat.get("tle1"),
                            "tle2": sat.get("tle2"),
                        },
                    )

                transmitters = await crud.transmitters.fetch_transmitters_for_satellite(
                    dbsession, norad_id=norad_id
                )
                if transmitters.get("success"):
                    self._send_to_tracker(
                        TRACKER_MSG_SET_TRANSMITTERS,
                        {"items": transmitters.get("data", [])},
                    )

            rig_id = tracking_state.get("rig_id")
            rotator_id = tracking_state.get("rotator_id")
            if rig_id:
                rigs = await crud.hardware.fetch_rigs(dbsession, rig_id=rig_id)
                if rigs.get("success") and rigs.get("data"):
                    self._send_to_tracker(
                        TRACKER_MSG_SET_HARDWARE,
                        {"rig": rigs["data"], "rig_type": "radio"},
                    )
                else:
                    sdrs = await crud.hardware.fetch_sdr(dbsession, sdr_id=rig_id)
                    if sdrs.get("success") and sdrs.get("data"):
                        self._send_to_tracker(
                            TRACKER_MSG_SET_HARDWARE,
                            {"sdr": sdrs["data"], "rig_type": "sdr"},
                        )

            if rotator_id:
                rotators = await crud.hardware.fetch_rotators(dbsession, rotator_id=rotator_id)
                if rotators.get("success") and rotators.get("data"):
                    self._send_to_tracker(TRACKER_MSG_SET_HARDWARE, {"rotator": rotators["data"]})

    def send_command(self, command: str, data: Optional[Dict[str, Any]] = None) -> None:
        self._send_to_tracker(TRACKER_MSG_COMMAND, {"command": command, "data": data})
