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


import html
import re
from typing import Any, Dict

from sqlalchemy import text

from db import AsyncSessionLocal
from db.models import Base


async def list_tables() -> Dict[str, Any]:
    """List all database tables with their row counts."""
    try:
        async with AsyncSessionLocal() as session:
            # Get all table names from the Base metadata
            table_names = [table.name for table in Base.metadata.sorted_tables]

            tables = []
            for table_name in table_names:
                # Get row count for each table
                result = await session.execute(text(f"SELECT COUNT(*) FROM {table_name}"))
                row_count = result.scalar()
                tables.append({"name": table_name, "row_count": row_count})

            return {"success": True, "tables": tables}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def backup_table(table_name: str) -> Dict[str, Any]:
    """Generate SQL INSERT statements for a specific table."""
    try:
        # Validate table name to prevent SQL injection
        if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", table_name):
            return {"success": False, "error": "Invalid table name"}

        # Check if table exists in our models (alembic_version is a special case)
        table_names = [table.name for table in Base.metadata.sorted_tables]
        if table_name not in table_names and table_name != "alembic_version":
            return {"success": False, "error": f"Table {table_name} not found"}

        async with AsyncSessionLocal() as session:
            # Get column names using PRAGMA for SQLite (works with async)
            result = await session.execute(text(f"PRAGMA table_info({table_name})"))
            pragma_result = result.fetchall()
            column_names = [row[1] for row in pragma_result]  # Column name is at index 1

            # Fetch all rows
            result = await session.execute(text(f"SELECT * FROM {table_name}"))
            rows = result.fetchall()

            # Generate SQL INSERT statements
            sql_statements = []
            sql_statements.append(f"-- Backup of table {table_name}")
            sql_statements.append(f"-- Generated at: {__import__('datetime').datetime.now()}")
            sql_statements.append(f"-- Total rows: {len(rows)}\n")

            for row in rows:
                # Convert row to dictionary
                row_dict = dict(zip(column_names, row))

                # Build INSERT statement
                columns_str = ", ".join(column_names)
                values = []
                for col_name in column_names:
                    value = row_dict[col_name]
                    if value is None:
                        values.append("NULL")
                    elif isinstance(value, str):
                        # Escape single quotes and handle special characters
                        escaped_value = value.replace("'", "''")
                        # Replace backslashes to prevent escape sequence issues
                        escaped_value = escaped_value.replace("\\", "\\\\")
                        values.append(f"'{escaped_value}'")
                    elif isinstance(value, (int, float)):
                        values.append(str(value))
                    elif isinstance(value, bool):
                        values.append(str(int(value)))
                    else:
                        # For other types, convert to string
                        escaped_value = str(value).replace("'", "''")
                        escaped_value = escaped_value.replace("\\", "\\\\")
                        values.append(f"'{escaped_value}'")

                values_str = ", ".join(values)
                sql_statements.append(
                    f"INSERT INTO {table_name} ({columns_str}) VALUES ({values_str});"
                )

            sql = "\n".join(sql_statements)
            return {"success": True, "sql": sql, "row_count": len(rows)}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def restore_table(table_name: str, sql: str, delete_first: bool = True) -> Dict[str, Any]:
    """Restore table from SQL INSERT statements."""
    try:
        # Validate table name
        if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", table_name):
            return {"success": False, "error": "Invalid table name"}

        # Check if table exists
        table_names = [table.name for table in Base.metadata.sorted_tables]
        if table_name not in table_names:
            return {"success": False, "error": f"Table {table_name} not found"}

        # Validate SQL contains only INSERT statements (security check)
        # Remove comments and empty lines
        sql_lines = [
            line.strip()
            for line in sql.split("\n")
            if line.strip() and not line.strip().startswith("--")
        ]

        # Check that all statements are INSERT statements for the correct table
        for line in sql_lines:
            if not re.match(
                rf"^INSERT\s+INTO\s+{table_name}\s+\(.*\)\s+VALUES\s+\(.*\);$", line, re.IGNORECASE
            ):
                return {
                    "success": False,
                    "error": f"Invalid SQL statement detected. Only INSERT statements for {table_name} are allowed.",
                }

        async with AsyncSessionLocal() as session:
            try:
                # Delete all rows if requested
                if delete_first:
                    await session.execute(text(f"DELETE FROM {table_name}"))

                # Execute INSERT statements
                rows_inserted = 0
                for line in sql_lines:
                    await session.execute(text(line))
                    rows_inserted += 1

                await session.commit()
                return {"success": True, "rows_inserted": rows_inserted}
            except Exception as e:
                await session.rollback()
                raise e

    except Exception as e:
        return {"success": False, "error": str(e)}


async def full_backup() -> Dict[str, Any]:
    """Generate a full database backup including schema and all data."""
    try:
        sql_statements = []
        sql_statements.append("-- Full Database Backup")
        sql_statements.append(f"-- Generated at: {__import__('datetime').datetime.now()}")
        sql_statements.append("")

        # Get CREATE TABLE statements
        sql_statements.append("-- ========================================")
        sql_statements.append("-- DATABASE SCHEMA")
        sql_statements.append("-- ========================================")
        sql_statements.append("")

        async with AsyncSessionLocal() as session:
            # For SQLite, we can get schema from sqlite_master
            result = await session.execute(
                text(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                )
            )
            schemas = result.fetchall()

            for schema in schemas:
                if schema[0]:
                    sql_statements.append(schema[0] + ";")
                    sql_statements.append("")

            sql_statements.append("")
            sql_statements.append("-- ========================================")
            sql_statements.append("-- TABLE DATA")
            sql_statements.append("-- ========================================")
            sql_statements.append("")

        # Get all table names in the correct order (respecting foreign keys)
        table_names = [table.name for table in Base.metadata.sorted_tables]

        # Also include alembic_version table (not in Base.metadata but essential for migrations)
        if "alembic_version" not in table_names:
            table_names.append("alembic_version")

        # Backup each table
        for table_name in table_names:
            result = await backup_table(table_name)
            if result["success"]:
                sql_statements.append(f"\n-- Table: {table_name} ({result['row_count']} rows)")
                sql_statements.append(result["sql"])
                sql_statements.append("")
            else:
                sql_statements.append(
                    f"\n-- Error backing up table {table_name}: {result['error']}"
                )

        sql = "\n".join(sql_statements)
        return {"success": True, "sql": sql}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def full_restore(sql: str, drop_tables: bool = True) -> Dict[str, Any]:
    """
    Restore full database from SQL backup file.

    Args:
        sql: Full SQL backup content (schema + data)
        drop_tables: Whether to drop existing tables before restore (default: True)

    Returns:
        Dict with success status and statistics
    """
    try:
        # Decode HTML entities in the SQL content first
        sql = html.unescape(sql)

        # Parse SQL into lines and remove comments/empty lines
        lines = []
        for line in sql.split("\n"):
            stripped = line.strip()
            # Keep the line if it's not empty and not a comment
            if stripped and not stripped.startswith("--"):
                lines.append(line)

        # Join multi-line statements
        sql_content = "\n".join(lines)

        # Split by semicolon to get individual statements
        statements = [stmt.strip() for stmt in sql_content.split(";") if stmt.strip()]

        # Separate CREATE and INSERT statements
        create_statements = []
        insert_statements = []
        alembic_create = None
        alembic_inserts = []

        for stmt in statements:
            stmt_upper = stmt.upper().strip()
            if stmt_upper.startswith("CREATE TABLE"):
                # Separate alembic_version CREATE statement
                if "ALEMBIC_VERSION" in stmt_upper:
                    alembic_create = stmt
                else:
                    create_statements.append(stmt)
            elif stmt_upper.startswith("INSERT INTO"):
                # Separate alembic_version INSERT statements
                if "ALEMBIC_VERSION" in stmt_upper:
                    alembic_inserts.append(stmt)
                else:
                    insert_statements.append(stmt)
            # Skip any other statements (like HTML entities or malformed content)

        if not create_statements and not alembic_create:
            return {"success": False, "error": "No CREATE TABLE statements found in backup file"}

        # Validate that we only have safe statements
        # Only process CREATE TABLE and INSERT INTO statements, ignore others
        valid_statements = (
            create_statements
            + insert_statements
            + ([alembic_create] if alembic_create else [])
            + alembic_inserts
        )
        if len(valid_statements) == 0:
            return {
                "success": False,
                "error": "No valid CREATE TABLE or INSERT INTO statements found in backup file",
            }

        async with AsyncSessionLocal() as session:
            try:
                # Disable foreign key constraints temporarily for SQLite
                await session.execute(text("PRAGMA foreign_keys = OFF"))

                # Drop existing tables if requested
                if drop_tables:
                    # Get all existing table names from database (including alembic_version)
                    result = await session.execute(
                        text(
                            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                        )
                    )
                    existing_tables = [row[0] for row in result.fetchall()]

                    # Drop all existing tables in reverse order
                    for table_name in reversed(existing_tables):
                        try:
                            await session.execute(text(f"DROP TABLE IF EXISTS {table_name}"))
                        except Exception:
                            # Continue even if drop fails
                            pass

                    # Commit the drops before creating new tables
                    await session.commit()

                # Execute CREATE TABLE statements (excluding alembic_version)
                tables_created = 0
                for stmt in create_statements:
                    await session.execute(text(stmt))
                    tables_created += 1

                # Commit after creating tables
                await session.commit()

                # Execute INSERT statements (excluding alembic_version)
                rows_inserted = 0
                for stmt in insert_statements:
                    await session.execute(text(stmt))
                    rows_inserted += 1

                # Commit data inserts before handling alembic_version
                await session.commit()

                # Now handle alembic_version table LAST to ensure it's created only if everything else succeeded
                if alembic_create:
                    await session.execute(text(alembic_create))
                    tables_created += 1
                    await session.commit()

                # Insert alembic_version data LAST
                for stmt in alembic_inserts:
                    await session.execute(text(stmt))
                    rows_inserted += 1

                # Re-enable foreign key constraints
                await session.execute(text("PRAGMA foreign_keys = ON"))

                # Final commit with alembic_version
                await session.commit()

                return {
                    "success": True,
                    "tables_created": tables_created,
                    "rows_inserted": rows_inserted,
                }

            except Exception as e:
                # Rollback on any error
                await session.rollback()
                # Re-enable foreign keys even on error
                try:
                    await session.execute(text("PRAGMA foreign_keys = ON"))
                    await session.commit()
                except Exception:
                    pass
                raise e

    except Exception as e:
        return {"success": False, "error": str(e)}


def register_handlers(registry):
    """Register database backup handlers."""
    # Database backup handlers don't use the standard registry pattern
    # They are handled directly in socket.py via database_backup event
    pass
