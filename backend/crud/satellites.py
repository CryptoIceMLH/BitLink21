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
import uuid
from datetime import datetime, timezone
from typing import List, Union

from pydantic.v1 import UUID4
from sqlalchemy import String, delete, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from common.common import logger, serialize_object
from db.models import Groups, Satellites, Transmitters

DATETIME_FIELDS = {"decayed", "launched", "deployed", "added", "updated"}


def _coerce_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        if not value.strip():
            return None
        try:
            if value.endswith("Z"):
                value = value.replace("Z", "+00:00")
            return datetime.fromisoformat(value)
        except ValueError:
            logger.warning(f"Failed to parse datetime value: {value}")
            return None
    return value


async def fetch_satellites_for_group_id(session: AsyncSession, group_id: Union[str, UUID4]) -> dict:
    """
    Fetch satellite records for the given group id along with their transmitters

    If 'satellite_id' is provided, return a single satellite record.
    Otherwise, return all satellite records with their associated transmitters.
    """
    try:
        assert group_id is not None, "group_id is required"

        if isinstance(group_id, str):
            group_id = uuid.UUID(group_id)
        elif not isinstance(group_id, uuid.UUID):
            raise ValueError(f"group_id must be a string or UUID, got {type(group_id)}")

        # Import here to avoid circular dependency
        from crud.groups import fetch_satellite_group

        group = await fetch_satellite_group(session, group_id)

        if not group or not group.get("data"):
            logger.warning(f"Group with ID {group_id} not found or has no data")
            return {"success": True, "data": [], "error": None}

        satellite_ids = group["data"]["satellite_ids"]

        # Fetch satellites
        stmt = select(Satellites).filter(Satellites.norad_id.in_(satellite_ids))
        result = await session.execute(stmt)
        satellites = result.scalars().all()
        satellites = serialize_object(satellites)

        # Fetch transmitters for each satellite and add group_id
        for satellite in satellites:
            stmt = select(Transmitters).filter(Transmitters.norad_cat_id == satellite["norad_id"])
            result = await session.execute(stmt)
            transmitters = result.scalars().all()
            satellite["transmitters"] = serialize_object(transmitters)
            # Add the group_id to each satellite object
            satellite["group_id"] = str(group_id)

        return {"success": True, "data": satellites, "error": None}

    except Exception as e:
        logger.error(f"Error fetching satellite(s): {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def search_satellites(session: AsyncSession, keyword: Union[str, int, None]) -> dict:
    """
    Fetch satellite records.

    If 'keyword' is provided, return a list of satellite records that have a matching norad_id
    or part of it, or a name or part of it. Otherwise, return all satellite records.
    Each satellite will include information about which groups it belongs to.
    """
    try:
        if keyword is None:
            stmt = select(Satellites)
        else:
            keyword = str(keyword)
            keyword = f"%{keyword}%"
            stmt = select(Satellites).filter(
                Satellites.norad_id.cast(String).ilike(keyword)
                | Satellites.name.ilike(keyword)
                | Satellites.name_other.ilike(keyword)
                | Satellites.alternative_name.ilike(keyword)
            )
        result = await session.execute(stmt)
        satellites = result.scalars().all()
        satellites = serialize_object(satellites)

        # For each satellite, find which groups it belongs to
        for satellite in satellites:
            norad_id = satellite["norad_id"]

            # Get all groups and filter them in Python since JSON querying can be database-specific
            all_groups_stmt = select(Groups)
            all_groups_result = await session.execute(all_groups_stmt)
            all_groups = all_groups_result.scalars().all()

            # Filter groups that contain this satellite's NORAD ID
            matching_groups = []
            for group in all_groups:
                if group.satellite_ids and norad_id in group.satellite_ids:
                    matching_groups.append(group)

            # Sort groups by number of member satellites (fewer first)
            matching_groups.sort(key=lambda g: len(g.satellite_ids) if g.satellite_ids else 0)

            # Add group information to the satellite
            satellite["groups"] = serialize_object(matching_groups) if matching_groups else []

        return {"success": True, "data": satellites, "error": None}

    except Exception as e:
        logger.error(f"Error fetching satellite(s): {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_satellites(
    session: AsyncSession, norad_id: Union[str, int, List[int], None]
) -> dict:
    """
    Fetch satellite records.

    If 'satellite_id' is provided as a single value, return the corresponding satellite record.
    If 'satellite_id' is a list, return all matching satellite records.
    Otherwise, return all satellite records.
    """
    try:
        if norad_id is None:
            # return all
            stmt = select(Satellites)
            result = await session.execute(stmt)
            satellites = result.scalars().all()

        elif isinstance(norad_id, list):
            # return all in list
            stmt = select(Satellites).filter(Satellites.norad_id.in_(norad_id))
            result = await session.execute(stmt)
            satellites = result.scalars().all()

        else:
            # return only the one
            stmt = select(Satellites).filter(Satellites.norad_id == norad_id)
            result = await session.execute(stmt)
            satellite = result.scalar_one_or_none()
            satellites = [satellite] if satellite else []

        satellites = serialize_object(satellites)
        return {"success": True, "data": satellites, "error": None}

    except Exception as e:
        logger.error(f"Error fetching satellite(s): {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def add_satellite(session: AsyncSession, data: dict) -> dict:
    """
    Create and add a new satellite record.
    """
    try:
        allowed_fields = {column.name for column in Satellites.__table__.columns}
        data = {key: value for key, value in data.items() if key in allowed_fields}

        # Validate required fields
        required_fields = ["name", "norad_id", "tle1", "tle2"]
        for field in required_fields:
            if field not in data:
                raise ValueError(f"Missing required field: {field}")

        now = datetime.now(timezone.utc)
        data["source"] = data.get("source") or "manual"
        data["added"] = now
        data["updated"] = now

        stmt = insert(Satellites).values(**data).returning(Satellites)
        result = await session.execute(stmt)
        await session.commit()
        new_satellite = result.scalar_one()
        new_satellite = serialize_object(new_satellite)
        return {"success": True, "data": new_satellite, "error": None}

    except IntegrityError as e:
        await session.rollback()
        if "UNIQUE constraint failed: satellites.norad_id" in str(e):
            return {
                "success": False,
                "error": f"Satellite with NORAD ID {data.get('norad_id')} already exists.",
            }
        logger.error(f"Error adding satellite: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": "Failed to add satellite due to a database constraint."}
    except Exception as e:
        await session.rollback()
        logger.error(f"Error adding satellite: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def edit_satellite(session: AsyncSession, satellite_id: uuid.UUID, **kwargs) -> dict:
    """
    Edit an existing satellite record by updating provided fields.
    """
    try:
        allowed_fields = {column.name for column in Satellites.__table__.columns}
        kwargs = {key: value for key, value in kwargs.items() if key in allowed_fields}
        for field in DATETIME_FIELDS:
            if field in kwargs:
                kwargs[field] = _coerce_datetime(kwargs[field])

        # Check if the satellite exists
        stmt = select(Satellites).filter(Satellites.norad_id == satellite_id)
        result = await session.execute(stmt)
        satellite = result.scalar_one_or_none()
        if not satellite:
            return {"success": False, "error": f"Satellite with id {satellite_id} not found."}

        # Set the updated timestamp
        kwargs["updated"] = datetime.now(timezone.utc)

        upd_stmt = (
            update(Satellites)
            .where(Satellites.norad_id == satellite_id)
            .values(**kwargs)
            .returning(Satellites)
        )
        upd_result = await session.execute(upd_stmt)
        await session.commit()
        updated_satellite = upd_result.scalar_one_or_none()
        updated_satellite = serialize_object(updated_satellite)
        return {"success": True, "data": updated_satellite, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error editing satellite {satellite_id}: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def delete_satellite(session: AsyncSession, satellite_id: Union[uuid.UUID, str]) -> dict:
    """
    Delete a satellite record by its UUID.
    First deletes all associated transmitters due to foreign key constraint.
    """
    try:
        if isinstance(satellite_id, str):
            satellite_id = uuid.UUID(satellite_id)

        # First, delete all transmitters associated with this satellite
        transmitters_stmt = delete(Transmitters).where(Transmitters.norad_cat_id == satellite_id)
        await session.execute(transmitters_stmt)

        # Then delete the satellite
        satellite_stmt = (
            delete(Satellites).where(Satellites.norad_id == satellite_id).returning(Satellites)
        )
        result = await session.execute(satellite_stmt)
        deleted = result.scalar_one_or_none()

        if not deleted:
            return {"success": False, "error": f"Satellite with id {satellite_id} not found."}

        await session.commit()
        return {"success": True, "data": None, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error deleting satellite {satellite_id}: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}
