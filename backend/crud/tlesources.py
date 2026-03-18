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

import json
import random
import string
import traceback
import uuid
from typing import List, Optional, Union

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from common.common import logger, serialize_object
from common.utils import convert_strings_to_uuids
from db.models import Groups, Satellites, TLESources, Transmitters


async def fetch_satellite_tle_source(
    session: AsyncSession, satellite_tle_source_id: Optional[Union[uuid.UUID, str]] = None
) -> dict:
    """
    Retrieve satellite TLE source records.
    If an ID is provided, fetch the specific record; otherwise, return all sources.
    """
    try:
        if satellite_tle_source_id is None:
            result = await session.execute(select(TLESources))
            sources = result.scalars().all()
            sources = json.loads(json.dumps(sources, default=serialize_object))
            sources = serialize_object(sources)
            return {"success": True, "data": sources}

        else:
            # Convert to UUID if it's a string
            if isinstance(satellite_tle_source_id, str):
                satellite_tle_source_id = uuid.UUID(satellite_tle_source_id)

            result = await session.execute(
                select(TLESources).filter(TLESources.id == satellite_tle_source_id)
            )
            source = result.scalars().first()
            if source:
                source = serialize_object(source)
                return {"success": True, "data": source}

            return {"success": False, "error": "Satellite TLE source not found"}

    except Exception as e:
        logger.error(f"Error fetching satellite TLE source: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def add_satellite_tle_source(session: AsyncSession, payload: dict) -> dict:
    """
    Create a new satellite TLE source record with the provided payload.
    """
    try:
        assert payload["name"]
        assert payload["url"]

        # Generate random identifier string
        payload["identifier"] = "".join(random.choices(string.ascii_letters, k=16))

        if payload.get("added", None) is not None:
            del payload["added"]

        if payload.get("updated", None) is not None:
            del payload["updated"]

        new_source = TLESources(**payload)
        session.add(new_source)
        await session.commit()
        await session.refresh(new_source)
        new_source = serialize_object(new_source)
        return {"success": True, "data": new_source}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error adding satellite TLE source: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def edit_satellite_tle_source(
    session: AsyncSession, satellite_tle_source_id: str, payload: dict
) -> dict:
    """
    Update an existing satellite TLE source record with new values provided in payload.
    Returns a result object containing the updated record or an error message.
    """
    try:
        payload.pop("added", None)
        payload.pop("updated", None)
        payload.pop("id", None)
        source_id = uuid.UUID(satellite_tle_source_id)

        result = await session.execute(select(TLESources).filter(TLESources.id == source_id))
        source = result.scalars().first()
        if not source:
            return {"success": False, "error": "Satellite TLE source not found"}

        for key, value in payload.items():
            if hasattr(source, key):
                setattr(source, key, value)

        await session.commit()
        await session.refresh(source)
        source = serialize_object(source)
        return {"success": True, "data": source}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error editing satellite TLE source: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def delete_satellite_tle_sources(
    session: AsyncSession, satellite_tle_source_ids: Union[List[str], dict]
) -> dict:
    """
    Deletes multiple satellite TLE source records using their IDs.
    Before deleting each TLE source, it finds the corresponding satellite group,
    deletes all transmitters and satellites that came from this TLE source, then deletes the group.
    """
    try:
        assert isinstance(satellite_tle_source_ids, list), "TLE source list must be a list"

        satellite_tle_source_ids = convert_strings_to_uuids(satellite_tle_source_ids)

        # Fetch sources that match the provided IDs
        result = await session.execute(
            select(TLESources).filter(TLESources.id.in_(satellite_tle_source_ids))
        )
        sources = result.scalars().all()

        # Determine which IDs were found
        found_ids = [source.id for source in sources]
        not_found_ids = [sat_id for sat_id in satellite_tle_source_ids if sat_id not in found_ids]

        if not sources:
            return {"success": False, "error": "None of the Satellite TLE sources were found."}

        deletion_summary = []

        for source in sources:
            source_identifier = source.identifier
            source_name = source.name

            # Find the corresponding satellite group by identifier
            group_result = await session.execute(
                select(Groups).filter(Groups.identifier == source_identifier)
            )
            satellite_group = group_result.scalar_one_or_none()

            satellites_deleted = 0
            transmitters_deleted = 0
            group_deleted = False

            if satellite_group:
                # Get the list of satellite NORAD IDs from the group
                satellite_norad_ids = satellite_group.satellite_ids or []

                if satellite_norad_ids:
                    # First, delete all transmitters associated with these satellites
                    # to avoid foreign key constraint violations
                    transmitters_result = await session.execute(
                        select(Transmitters).filter(
                            Transmitters.norad_cat_id.in_(satellite_norad_ids)
                        )
                    )
                    transmitters_to_delete = transmitters_result.scalars().all()

                    for transmitter in transmitters_to_delete:
                        await session.delete(transmitter)
                        transmitters_deleted += 1

                    # Now delete all satellites that came from this TLE source
                    satellites_result = await session.execute(
                        select(Satellites).filter(Satellites.norad_id.in_(satellite_norad_ids))
                    )
                    satellites_to_delete = satellites_result.scalars().all()

                    for satellite in satellites_to_delete:
                        await session.delete(satellite)
                        satellites_deleted += 1

                # Delete the satellite group
                await session.delete(satellite_group)
                group_deleted = True

            # Finally, delete the TLE source record
            await session.delete(source)

            deletion_summary.append(
                {
                    "source_id": str(source.id),
                    "source_name": source_name,
                    "source_identifier": source_identifier,
                    "transmitters_deleted": transmitters_deleted,
                    "satellites_deleted": satellites_deleted,
                    "group_deleted": group_deleted,
                }
            )

        # Commit the changes
        await session.commit()

        # Construct a success message
        total_transmitters_deleted = sum(item["transmitters_deleted"] for item in deletion_summary)
        total_satellites_deleted = sum(item["satellites_deleted"] for item in deletion_summary)
        total_groups_deleted = sum(1 for item in deletion_summary if item["group_deleted"])

        message = (
            f"Successfully deleted {len(found_ids)} TLE source(s), "
            f"{total_transmitters_deleted} transmitter(s), "
            f"{total_satellites_deleted} satellite(s), and "
            f"{total_groups_deleted} satellite group(s)."
        )

        if not_found_ids:
            message += f" The following TLE source IDs were not found: {not_found_ids}."

        return {"success": True, "data": message, "deletion_summary": deletion_summary}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error deleting satellite TLE sources: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}
