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
Unit tests for satellite CRUD operations.
"""

import uuid

import pytest

from crud.groups import add_satellite_group
from crud.satellites import (
    add_satellite,
    delete_satellite,
    edit_satellite,
    fetch_satellites,
    fetch_satellites_for_group_id,
    search_satellites,
)

# TLE templates for testing (valid format but dummy data)
TLE1_TEMPLATE = "1 {norad:05d}U 00000A   21001.00000000  .00000000  00000-0  00000-0 0  9990"
TLE2_TEMPLATE = "2 {norad:05d}  51.0000 000.0000 0000000   0.0000   0.0000 15.00000000000000"


@pytest.mark.asyncio
class TestSatellitesCRUD:
    """Test suite for satellite CRUD operations."""

    async def test_add_satellite_success(self, db_session):
        """Test successful satellite creation."""
        satellite_data = {
            "name": "ISS (ZARYA)",
            "sat_id": "ISS-001",
            "norad_id": 25544,
            "status": "alive",
            "is_frequency_violator": False,
            "name_other": "International Space Station",
            "alternative_name": "ISS",
            "tle1": "1 25544U 98067A   21001.00000000  .00002182  00000-0  41420-4 0  9990",
            "tle2": "2 25544  51.6461 339.8014 0002571  34.5857  54.2426 15.48919393261778",
        }

        result = await add_satellite(db_session, satellite_data)

        assert result["success"] is True
        assert result["error"] is None
        assert result["data"]["name"] == "ISS (ZARYA)"
        assert result["data"]["norad_id"] == 25544
        assert result["data"]["source"] == "manual"
        assert result["data"]["status"] == "alive"
        assert "added" in result["data"]
        assert "updated" in result["data"]

    async def test_add_satellite_missing_required_field(self, db_session):
        """Test satellite creation fails without required fields."""
        satellite_data = {
            "name": "Test Satellite",
            "sat_id": "TEST-001",
            # Missing norad_id, status, is_frequency_violator, tle1, tle2
        }

        result = await add_satellite(db_session, satellite_data)

        assert result["success"] is False
        assert "Missing required field" in result["error"]

    async def test_fetch_satellites_all(self, db_session):
        """Test fetching all satellites."""
        # Add two satellites
        await add_satellite(
            db_session,
            {
                "name": "Satellite 1",
                "sat_id": "SAT-001",
                "norad_id": 11111,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=11111),
                "tle2": TLE2_TEMPLATE.format(norad=11111),
            },
        )
        await add_satellite(
            db_session,
            {
                "name": "Satellite 2",
                "sat_id": "SAT-002",
                "norad_id": 22222,
                "status": "dead",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=22222),
                "tle2": TLE2_TEMPLATE.format(norad=22222),
            },
        )

        result = await fetch_satellites(db_session, norad_id=None)

        assert result["success"] is True
        assert len(result["data"]) == 2

    async def test_fetch_satellite_by_norad_id(self, db_session):
        """Test fetching a single satellite by NORAD ID."""
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 99999,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=99999),
                "tle2": TLE2_TEMPLATE.format(norad=99999),
            },
        )

        result = await fetch_satellites(db_session, norad_id=99999)

        assert result["success"] is True
        assert len(result["data"]) == 1
        assert result["data"][0]["norad_id"] == 99999

    async def test_fetch_satellites_by_list(self, db_session):
        """Test fetching multiple satellites by NORAD ID list."""
        await add_satellite(
            db_session,
            {
                "name": "Sat 1",
                "sat_id": "SAT-001",
                "norad_id": 11111,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=11111),
                "tle2": TLE2_TEMPLATE.format(norad=11111),
            },
        )
        await add_satellite(
            db_session,
            {
                "name": "Sat 2",
                "sat_id": "SAT-002",
                "norad_id": 22222,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=22222),
                "tle2": TLE2_TEMPLATE.format(norad=22222),
            },
        )
        await add_satellite(
            db_session,
            {
                "name": "Sat 3",
                "sat_id": "SAT-003",
                "norad_id": 33333,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=33333),
                "tle2": TLE2_TEMPLATE.format(norad=33333),
            },
        )

        result = await fetch_satellites(db_session, norad_id=[11111, 33333])

        assert result["success"] is True
        assert len(result["data"]) == 2
        norad_ids = [sat["norad_id"] for sat in result["data"]]
        assert 11111 in norad_ids
        assert 33333 in norad_ids
        assert 22222 not in norad_ids

    async def test_search_satellites_by_name(self, db_session):
        """Test searching satellites by name."""
        await add_satellite(
            db_session,
            {
                "name": "International Space Station",
                "sat_id": "ISS-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=25544),
                "tle2": TLE2_TEMPLATE.format(norad=25544),
            },
        )
        await add_satellite(
            db_session,
            {
                "name": "NOAA 19",
                "sat_id": "NOAA-19",
                "norad_id": 33591,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=33591),
                "tle2": TLE2_TEMPLATE.format(norad=33591),
            },
        )

        result = await search_satellites(db_session, keyword="space")

        assert result["success"] is True
        assert len(result["data"]) == 1
        assert result["data"][0]["norad_id"] == 25544

    async def test_search_satellites_by_norad_id_partial(self, db_session):
        """Test searching satellites by partial NORAD ID."""
        await add_satellite(
            db_session,
            {
                "name": "Sat 1",
                "sat_id": "SAT-001",
                "norad_id": 12345,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=12345),
                "tle2": TLE2_TEMPLATE.format(norad=12345),
            },
        )
        await add_satellite(
            db_session,
            {
                "name": "Sat 2",
                "sat_id": "SAT-002",
                "norad_id": 12367,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=12367),
                "tle2": TLE2_TEMPLATE.format(norad=12367),
            },
        )
        await add_satellite(
            db_session,
            {
                "name": "Sat 3",
                "sat_id": "SAT-003",
                "norad_id": 99999,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=99999),
                "tle2": TLE2_TEMPLATE.format(norad=99999),
            },
        )

        result = await search_satellites(db_session, keyword="123")

        assert result["success"] is True
        assert len(result["data"]) == 2

    async def test_search_satellites_all(self, db_session):
        """Test searching all satellites when no keyword provided."""
        await add_satellite(
            db_session,
            {
                "name": "Sat 1",
                "sat_id": "SAT-001",
                "norad_id": 11111,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=11111),
                "tle2": TLE2_TEMPLATE.format(norad=11111),
            },
        )
        await add_satellite(
            db_session,
            {
                "name": "Sat 2",
                "sat_id": "SAT-002",
                "norad_id": 22222,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=22222),
                "tle2": TLE2_TEMPLATE.format(norad=22222),
            },
        )

        result = await search_satellites(db_session, keyword=None)

        assert result["success"] is True
        assert len(result["data"]) == 2

    async def test_edit_satellite_success(self, db_session):
        """Test successful satellite editing."""
        await add_satellite(
            db_session,
            {
                "name": "Old Name",
                "sat_id": "OLD-001",
                "norad_id": 12345,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=12345),
                "tle2": TLE2_TEMPLATE.format(norad=12345),
            },
        )

        result = await edit_satellite(
            db_session, satellite_id=12345, name="New Name", status="dead"
        )

        assert result["success"] is True
        assert result["data"]["name"] == "New Name"
        assert result["data"]["status"] == "dead"
        assert result["data"]["norad_id"] == 12345

    async def test_edit_satellite_not_found(self, db_session):
        """Test editing non-existent satellite."""
        result = await edit_satellite(db_session, satellite_id=99999, name="New Name")

        assert result["success"] is False
        assert "not found" in result["error"]

    async def test_delete_satellite_success(self, db_session):
        """Test successful satellite deletion."""
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 12345,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=12345),
                "tle2": TLE2_TEMPLATE.format(norad=12345),
            },
        )

        result = await delete_satellite(db_session, satellite_id=12345)

        assert result["success"] is True

        # Verify deletion
        fetch_result = await fetch_satellites(db_session, norad_id=12345)
        assert len(fetch_result["data"]) == 0

    async def test_delete_satellite_not_found(self, db_session):
        """Test deleting non-existent satellite."""
        result = await delete_satellite(db_session, satellite_id=99999)

        assert result["success"] is False
        assert "not found" in result["error"]

    async def test_search_satellites_with_groups(self, db_session):
        """Test that search includes group membership information."""
        # Add satellites
        await add_satellite(
            db_session,
            {
                "name": "ISS",
                "sat_id": "ISS-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": "1 25544U 98067A   21001.00000000  .00002182  00000-0  41420-4 0  9990",
                "tle2": "2 25544  51.6461 339.8014 0002571  34.5857  54.2426 15.48919393261778",
            },
        )

        # Add a group containing the satellite
        await add_satellite_group(
            db_session, {"name": "Manned Missions", "type": "user", "satellite_ids": [25544]}
        )

        result = await search_satellites(db_session, keyword="ISS")

        assert result["success"] is True
        assert len(result["data"]) == 1
        assert "groups" in result["data"][0]
        assert len(result["data"][0]["groups"]) == 1
        assert result["data"][0]["groups"][0]["name"] == "Manned Missions"

    async def test_fetch_satellites_for_group_id(self, db_session):
        """Test fetching satellites by group ID."""
        # Add satellites
        await add_satellite(
            db_session,
            {
                "name": "Sat 1",
                "sat_id": "SAT-001",
                "norad_id": 11111,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=11111),
                "tle2": TLE2_TEMPLATE.format(norad=11111),
            },
        )
        await add_satellite(
            db_session,
            {
                "name": "Sat 2",
                "sat_id": "SAT-002",
                "norad_id": 22222,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=22222),
                "tle2": TLE2_TEMPLATE.format(norad=22222),
            },
        )

        # Add a group with both satellites
        group_result = await add_satellite_group(
            db_session, {"name": "Test Group", "type": "user", "satellite_ids": [11111, 22222]}
        )

        group_id = group_result["data"]["id"]

        # Fetch satellites for group
        result = await fetch_satellites_for_group_id(db_session, group_id)

        assert result["success"] is True
        assert len(result["data"]) == 2

    async def test_add_satellite_with_all_fields(self, db_session):
        """Test adding satellite with all optional fields."""
        satellite_data = {
            "name": "Full Satellite",
            "sat_id": "FULL-001",
            "norad_id": 99999,
            "status": "alive",
            "is_frequency_violator": False,
            "tle1": TLE1_TEMPLATE.format(norad=99999),
            "tle2": TLE2_TEMPLATE.format(norad=99999),
            "name_other": "Alternative Name",
            "alternative_name": "Another Name",
            "image": "http://example.com/image.jpg",
            "website": "http://example.com",
            "operator": "Test Operator",
            "countries": "USA, EU",
            "citation": "Test Citation",
            "associated_satellites": "12345, 67890",
        }

        result = await add_satellite(db_session, satellite_data)

        assert result["success"] is True
        assert result["data"]["operator"] == "Test Operator"
        assert result["data"]["countries"] == "USA, EU"
        assert result["data"]["website"] == "http://example.com"
