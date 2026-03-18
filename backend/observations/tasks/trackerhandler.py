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

"""Tracker task handler - manages rotator tracking lifecycle."""

import traceback
from typing import Any, Dict, List

from common.logger import logger
from tracker.runner import get_tracker_manager


class TrackerHandler:
    """Handles rotator tracking lifecycle for observations."""

    async def start_tracker_task(
        self,
        observation_id: str,
        satellite: Dict[str, Any],
        rotator_config: Dict[str, Any],
        tasks: List[Dict[str, Any]],
    ) -> bool:
        """
        Start rotator tracking for an observation.

        Args:
            observation_id: The observation ID
            satellite: Satellite information dict
            rotator_config: Rotator configuration dict
            tasks: List of observation tasks

        Returns:
            True if tracker started successfully
        """
        try:
            if not rotator_config.get("tracking_enabled") or not rotator_config.get("id"):
                logger.debug(f"Rotator tracking not enabled for observation {observation_id}")
                return False

            # Extract transmitter ID from decoder tasks (if any)
            transmitter_id = "none"
            for task in tasks:
                if task.get("type") == "decoder":
                    transmitter_id = task.get("config", {}).get("transmitter_id", "none")
                    break

            # Update tracking state to target this satellite
            tracker_manager = get_tracker_manager()
            await tracker_manager.update_tracking_state(
                norad_id=satellite.get("norad_id"),
                group_id=satellite.get("group_id"),
                rotator_state="tracking",  # Start tracking satellite
                rotator_id=rotator_config.get("id"),
                rig_state="disconnected",  # Observations don't use rig for now
                rig_id="none",
                transmitter_id=transmitter_id,
                rig_vfo="none",
                vfo1="uplink",
                vfo2="downlink",
            )

            logger.info(
                f"Started tracking {satellite.get('name')} (NORAD {satellite.get('norad_id')}) "
                f"for observation {observation_id}"
            )
            return True

        except Exception as e:
            logger.error(f"Error starting tracker: {e}")
            logger.error(traceback.format_exc())
            return False

    async def stop_tracker_task(self, observation_id: str) -> bool:
        """
        Stop rotator tracking for an observation.

        Note: Currently, rotators are intentionally left connected after observations
        for manual control or the next observation. This method is provided for
        future use if explicit stop behavior is needed.

        Args:
            observation_id: The observation ID

        Returns:
            True (always succeeds as it's a no-op)
        """
        logger.debug(f"Leaving rotator connected after observation {observation_id}")
        return True
