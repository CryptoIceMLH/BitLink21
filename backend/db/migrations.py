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


"""Database migration utilities using Alembic."""

import os
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config


def get_alembic_config() -> Config:
    """Get the Alembic configuration object."""
    # Get the backend directory
    backend_dir = Path(__file__).parent.parent
    alembic_ini = backend_dir / "alembic.ini"

    # Create Alembic config
    alembic_cfg = Config(str(alembic_ini))

    # Set the script location
    alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))

    return alembic_cfg


def run_migrations():
    """Run all pending database migrations.

    This function should be called on application startup to ensure
    the database schema is up to date.
    """
    # Set the ALEMBIC_CONTEXT environment variable
    os.environ["ALEMBIC_CONTEXT"] = "1"

    try:
        alembic_cfg = get_alembic_config()

        # Run migrations to the latest revision
        # Alembic will use the runtime logging configuration from data/configs/log_config.yaml
        # because we skip fileConfig() in alembic/env.py when ALEMBIC_CONTEXT=1
        command.upgrade(alembic_cfg, "head")

        return True
    except Exception as e:
        print(f"Error running migrations: {e}", file=sys.stderr)
        raise
    finally:
        # Clean up environment variable
        if "ALEMBIC_CONTEXT" in os.environ:
            del os.environ["ALEMBIC_CONTEXT"]


def get_current_revision() -> str:
    """Get the current database revision."""
    os.environ["ALEMBIC_CONTEXT"] = "1"

    try:
        # Get alembic config (not used yet, but reserved for future implementation)
        _ = get_alembic_config()

        # This would require more complex inspection
        # For now, return a placeholder
        return "current"
    finally:
        if "ALEMBIC_CONTEXT" in os.environ:
            del os.environ["ALEMBIC_CONTEXT"]


def create_migration(message: str, autogenerate: bool = True):
    """Create a new migration revision.

    Args:
        message: Description of the migration
        autogenerate: Whether to auto-generate migration from model changes
    """
    os.environ["ALEMBIC_CONTEXT"] = "1"

    try:
        alembic_cfg = get_alembic_config()

        if autogenerate:
            command.revision(alembic_cfg, message=message, autogenerate=True)
        else:
            command.revision(alembic_cfg, message=message)

        return True
    finally:
        if "ALEMBIC_CONTEXT" in os.environ:
            del os.environ["ALEMBIC_CONTEXT"]
