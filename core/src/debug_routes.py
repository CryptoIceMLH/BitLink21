"""
BitLink21 Core Debug Routes

Provides API endpoints for log access and control:
- GET /api/v1/debug/logs — retrieve logs with filtering
- POST /api/v1/debug/log-level — change log level dynamically
- GET /api/v1/debug/logs/download — download all logs as ZIP

These endpoints require LOG_DEBUG=1 environment variable to be enabled.
"""

import os
import json
import logging
import zipfile
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import FileResponse

from .logging_config import get_logger, set_log_level

logger = get_logger("debug_routes")

# Create router
router = APIRouter(prefix="/api/v1/debug", tags=["debug"])

# Check if debug mode is enabled
DEBUG_ENABLED = os.getenv("LOG_DEBUG", "0") == "1"

# API Authentication
# auto_error=False allows requests without Authorization header to pass through
# verify_token() then checks if auth is actually required based on token configuration
security = HTTPBearer(auto_error=False)
BITLINK_API_TOKEN = os.getenv("BITLINK_API_TOKEN", "change-me")


def verify_token(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Verify API token from Authorization: Bearer <token> header

    For self-hosted LAN applications:
    - If BITLINK_API_TOKEN is not set or is the default "change-me", all requests are allowed (no auth required)
    - If BITLINK_API_TOKEN is configured to a real value, requests must include the token

    Raises:
        HTTPException: 401 Unauthorized if token is required but missing or invalid
    """
    # If token not configured (default/unset), allow all requests — this is for LAN-only self-hosted use
    if not BITLINK_API_TOKEN or BITLINK_API_TOKEN == "change-me":
        return "no-auth"

    # Token is configured: require it
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Authorization required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if credentials.credentials != BITLINK_API_TOKEN:
        raise HTTPException(
            status_code=401,
            detail="Invalid API token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials.credentials


def _check_debug_enabled():
    """Check if debug endpoints are enabled."""
    if not DEBUG_ENABLED:
        raise HTTPException(
            status_code=403,
            detail="Debug endpoints disabled. Set LOG_DEBUG=1 to enable.",
        )


def _read_logs_file() -> List[Dict[str, Any]]:
    """Read and parse JSON log file.

    Returns:
        List of parsed JSON log entries
    """
    log_file = Path("/data/logs/bitlink21-core.log")

    if not log_file.exists():
        return []

    entries = []
    try:
        with open(log_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    entries.append(entry)
                except json.JSONDecodeError:
                    # Skip malformed JSON lines
                    pass
    except Exception as e:
        logger.error(f"Error reading log file: {e}")
        raise HTTPException(status_code=500, detail=f"Error reading logs: {e}")

    return entries


@router.get("/logs")
async def get_logs(
    level: Optional[str] = Query("INFO", description="Filter by log level"),
    limit: int = Query(100, description="Max log entries to return", ge=1, le=1000),
    component: Optional[str] = Query(None, description="Filter by component name"),
) -> Dict[str, Any]:
    """Get recent log entries with optional filtering.

    Args:
        level: Log level to filter by (ERROR, INFO, DEBUG, WARNING)
        limit: Maximum number of entries to return (1-1000)
        component: Component name to filter by (optional)

    Returns:
        JSON array of log entries
    """
    _check_debug_enabled()

    logger.info(
        "Retrieving logs",
        extra={"level": level, "limit": limit, "component": component},
    )

    # Read log file
    all_entries = _read_logs_file()

    # Filter by level
    level_upper = level.upper()
    filtered_entries = [
        entry for entry in all_entries if entry.get("level", "").upper() == level_upper
    ]

    # Filter by component if specified
    if component:
        filtered_entries = [
            entry
            for entry in filtered_entries
            if entry.get("component", "").lower() == component.lower()
        ]

    # Return last N entries (most recent)
    result_entries = filtered_entries[-limit:]

    return {
        "status": "success",
        "total_available": len(filtered_entries),
        "returned": len(result_entries),
        "filter": {
            "level": level,
            "component": component,
            "limit": limit,
        },
        "logs": result_entries,
    }


@router.post("/log-level")
async def set_log_level_endpoint(
    level: int = Query(..., description="Log level (0=ERROR, 1=INFO, 2=DEBUG, 3=DEBUG+verbose)", ge=0, le=3),
    token: str = Depends(verify_token),
) -> Dict[str, Any]:
    """Change log level dynamically.

    Args:
        level: Log level number
            - 0 = ERROR
            - 1 = INFO
            - 2 = DEBUG
            - 3 = DEBUG (very verbose)

    Returns:
        Confirmation with new log level
    """
    _check_debug_enabled()

    logger.info(f"Changing log level to {level}")

    try:
        set_log_level(level)

        level_names = {0: "ERROR", 1: "INFO", 2: "DEBUG", 3: "DEBUG+verbose"}

        return {
            "status": "success",
            "message": f"Log level changed to {level_names[level]}",
            "level_number": level,
            "level_name": level_names[level],
        }

    except Exception as e:
        logger.error(f"Error changing log level: {e}")
        raise HTTPException(status_code=400, detail=f"Error changing log level: {e}")


@router.get("/logs/download")
async def download_logs() -> FileResponse:
    """Download all logs as ZIP file.

    Creates a ZIP file containing all log files from /data/logs/ directory.

    Returns:
        ZIP file as download
    """
    _check_debug_enabled()

    logger.info("Downloading logs as ZIP")

    log_dir = Path("/data/logs")

    if not log_dir.exists():
        raise HTTPException(status_code=404, detail="No logs directory found")

    try:
        # Create temporary ZIP file
        zip_path = log_dir / "bitlink21-logs.zip"

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            # Add all log files
            for log_file in log_dir.glob("*.log*"):
                if log_file.name != "bitlink21-logs.zip":
                    zipf.write(log_file, arcname=log_file.name)

        return FileResponse(
            path=zip_path,
            filename=f"bitlink21-logs-{datetime.utcnow().isoformat()}.zip",
            media_type="application/zip",
        )

    except Exception as e:
        logger.error(f"Error creating logs ZIP: {e}")
        raise HTTPException(status_code=500, detail=f"Error creating ZIP: {e}")


@router.get("/logs/stats")
async def get_log_stats() -> Dict[str, Any]:
    """Get statistics about current logs.

    Returns:
        Log file size, entry counts by level, etc.
    """
    _check_debug_enabled()

    log_file = Path("/data/logs/bitlink21-core.log")

    if not log_file.exists():
        return {
            "status": "success",
            "file_exists": False,
            "total_entries": 0,
            "by_level": {},
        }

    try:
        all_entries = _read_logs_file()

        # Count by level
        by_level = {}
        for entry in all_entries:
            level = entry.get("level", "UNKNOWN")
            by_level[level] = by_level.get(level, 0) + 1

        # Count by component
        by_component = {}
        for entry in all_entries:
            component = entry.get("component", "unknown")
            by_component[component] = by_component.get(component, 0) + 1

        file_size = log_file.stat().st_size

        return {
            "status": "success",
            "file_exists": True,
            "file_path": str(log_file),
            "file_size_bytes": file_size,
            "file_size_mb": round(file_size / 1024 / 1024, 2),
            "total_entries": len(all_entries),
            "by_level": by_level,
            "by_component": by_component,
        }

    except Exception as e:
        logger.error(f"Error getting log stats: {e}")
        raise HTTPException(status_code=500, detail=f"Error getting stats: {e}")


@router.post("/logs/clear")
async def clear_logs(token: str = Depends(verify_token)) -> Dict[str, Any]:
    """Clear all log entries.

    WARNING: This permanently deletes all log data.

    Returns:
        Confirmation message
    """
    _check_debug_enabled()

    logger.warning("Clearing all logs - DESTRUCTIVE OPERATION")

    try:
        log_file = Path("/data/logs/bitlink21-core.log")

        if log_file.exists():
            log_file.unlink()
            logger.info("Log file cleared successfully")

        return {
            "status": "success",
            "message": "All logs cleared",
            "warning": "This action is permanent",
        }

    except Exception as e:
        logger.error(f"Error clearing logs: {e}")
        raise HTTPException(status_code=500, detail=f"Error clearing logs: {e}")
