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

import traceback
from datetime import datetime, timezone
from typing import Dict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from common.common import logger, serialize_object
from db.models import TrackingState


async def set_tracking_state(session: AsyncSession, data: dict) -> dict:
    """
    Upserts a record in the tracking_state table
    based on the provided data dictionary via SQLAlchemy's merge operation.
    """

    """
    name:
    "satellite-tracking"

    value:
    {
        "norad_id": 53109,
        "rotator_state": "connected",
        "rig_state": "disconnected",
        "group_id": "c23d5955-ec14-4c91-8a19-935243cb2a9f",
        "rotator_id": "7f714673-e661-4bc4-98e4-ac7620097aa7",
        "rig_id": "c7aa9cb8-360c-4976-928c-c836bf93af1a",
        "transmitter_id": "C4SzpxhvuwzpKRVRQTbAWR"
    }
    """

    try:
        # Basic validation for all operations
        assert data.get("name", None) is not None, "name is required when setting tracking state"
        assert data.get("value", None) is not None, "value is required when setting tracking state"
        value = data.get("value", {})

        now = datetime.now(timezone.utc)
        data["updated"] = now

        existing_record = await session.execute(
            select(TrackingState).where(TrackingState.name == data["name"])
        )
        existing_record = existing_record.scalar_one_or_none()

        if existing_record:
            # Merge the new value JSON with the existing value JSON
            if hasattr(existing_record, "value") and existing_record.value:
                # Create a copy of the existing value to avoid modifying it directly
                merged_value = (
                    existing_record.value.copy() if isinstance(existing_record.value, dict) else {}
                )
                # Update with the new values
                merged_value.update(data["value"])
                # Replace the incoming value with the merged one
                data["value"] = merged_value

            # Update other fields
            for key, value in data.items():
                setattr(existing_record, key, value)
            new_record = existing_record

        else:
            # Full validation only for new records
            assert value.get(
                "norad_id", None
            ), "norad_id is required when creating new tracking state"
            assert value.get(
                "group_id", None
            ), "group_id is required when creating new tracking state"
            assert (
                value.get("rotator_state", None) is not None
            ), "rotator_state is required when creating new tracking state"
            assert (
                value.get("rig_state", None) is not None
            ), "rig_state is required when creating new tracking state"
            assert (
                value.get("rig_id") is not None
            ), "rig_id is required when creating new tracking state"
            assert (
                value.get("rotator_id", None) is not None
            ), "rotator_id is required when creating new tracking state"

            new_record = TrackingState(**data)

        await session.merge(new_record)
        await session.commit()
        new_record = serialize_object(new_record)
        return {"success": True, "data": new_record, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error storing satellite tracking state: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def get_tracking_state(session: AsyncSession, name: str) -> dict:
    """
    Fetches a TrackingState row based on the provided key (name).
    Returns a dictionary with the data or an error message if not found.
    """

    reply: Dict[str, object] = {"success": None, "data": None, "error": None}

    try:
        assert name is not None, "name is required when fetching tracking state"

        stmt = select(TrackingState).filter(TrackingState.name == name)
        result = await session.execute(stmt)
        tracking_state = result.scalar_one_or_none()

        if not tracking_state:
            return {
                "success": True,
                "data": None,
                "error": f"Tracking state with name '{name}' not found.",
            }

        tracking_state = serialize_object(tracking_state)
        reply["success"] = True
        reply["data"] = tracking_state

    except Exception as e:
        logger.error(f"Error fetching satellite tracking state for key '{name}': {e}")
        logger.error(traceback.format_exc())
        reply["success"] = False
        reply["error"] = str(e)

    finally:
        pass

    return reply
