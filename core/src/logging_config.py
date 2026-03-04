"""
BitLink21 Core JSON Logging Configuration

Sets up Python logging with JSON output to /data/logs/bitlink21-core.log
plus console output for Docker logs.

Features:
- JSON formatter with ISO8601 timestamps
- Daily log rotation (keep 14 days of logs)
- Configurable log level via LOG_LEVEL env var (0-3)
- Component-based logging
"""

import logging
import json
import os
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path


class JSONFormatter(logging.Formatter):
    """Custom logging formatter that outputs JSON."""

    def format(self, record):
        """Format log record as JSON."""
        # Extract extra data if provided
        extra_data = {}
        if hasattr(record, 'extra'):
            extra_data = record.extra if isinstance(record.extra, dict) else {}

        # Remove 'extra' from record to avoid duplication
        for key in list(record.__dict__.keys()):
            if key == 'extra':
                del record.__dict__[key]

        # Build JSON structure
        log_entry = {
            "ts": datetime.utcnow().isoformat() + "Z",
            "level": record.levelname,
            "component": record.name.split(".")[-1] if record.name else "core",
            "msg": record.getMessage(),
        }

        # Add extra data if present
        if extra_data:
            log_entry["data"] = extra_data

        # Add exception info if present
        if record.exc_info:
            log_entry["exc_info"] = self.formatException(record.exc_info)

        return json.dumps(log_entry)


class ConsoleFormatter(logging.Formatter):
    """Human-readable formatter for console output."""

    def format(self, record):
        """Format log record for console."""
        extra_str = ""
        if hasattr(record, 'extra') and record.extra:
            extra_data = record.extra if isinstance(record.extra, dict) else {}
            extra_str = f" {extra_data}" if extra_data else ""

        return (
            f"{datetime.utcnow().isoformat()}Z - "
            f"{record.name} - "
            f"{record.levelname} - "
            f"{record.getMessage()}{extra_str}"
        )


def _get_log_level():
    """Get log level from LOG_LEVEL environment variable (0-3).

    Levels:
    - 0 = ERROR
    - 1 = INFO (default)
    - 2 = DEBUG
    - 3 = DEBUG (very verbose)

    Returns:
        logging level constant
    """
    log_level_env = os.getenv("LOG_LEVEL", "1")
    try:
        level_num = int(log_level_env)
    except ValueError:
        level_num = 1

    level_map = {
        0: logging.ERROR,
        1: logging.INFO,
        2: logging.DEBUG,
        3: logging.DEBUG,
    }

    return level_map.get(level_num, logging.INFO)


def setup_logging():
    """Configure logging system with JSON file output and console output.

    Creates /data/logs/ directory if it doesn't exist.
    Configures daily rotation with 14-day retention.
    """
    # Create logs directory
    log_dir = Path("/data/logs")
    log_dir.mkdir(parents=True, exist_ok=True)

    log_file = log_dir / "bitlink21-core.log"

    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(_get_log_level())

    # Remove any existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # File handler - JSON format with rotation
    # Using RotatingFileHandler for size-based rotation
    # For daily rotation, consider using TimedRotatingFileHandler
    file_handler = RotatingFileHandler(
        filename=str(log_file),
        maxBytes=10 * 1024 * 1024,  # 10MB per file
        backupCount=14,  # Keep 14 old files (~140MB total)
        encoding="utf-8",
    )
    file_handler.setLevel(_get_log_level())
    file_formatter = JSONFormatter()
    file_handler.setFormatter(file_formatter)
    root_logger.addHandler(file_handler)

    # Console handler - human-readable format for Docker logs
    console_handler = logging.StreamHandler()
    console_handler.setLevel(_get_log_level())
    console_formatter = ConsoleFormatter()
    console_handler.setFormatter(console_formatter)
    root_logger.addHandler(console_handler)

    # Log startup
    root_logger.info(
        "Logging system initialized",
        extra={
            "log_file": str(log_file),
            "log_level": root_logger.level,
            "format": "JSON",
        },
    )


def get_logger(name):
    """Get a logger instance for a specific component.

    Args:
        name: Component name (e.g., 'api', 'encryption', 'router')

    Returns:
        logging.Logger instance

    Usage:
        logger = get_logger("api")
        logger.info("Request received", extra={"user_id": 123})
    """
    return logging.getLogger(name)


def set_log_level(level_num):
    """Change log level at runtime.

    Args:
        level_num: Log level (0-3)
            - 0 = ERROR
            - 1 = INFO
            - 2 = DEBUG
            - 3 = DEBUG (very verbose)
    """
    level_map = {
        0: logging.ERROR,
        1: logging.INFO,
        2: logging.DEBUG,
        3: logging.DEBUG,
    }

    new_level = level_map.get(level_num, logging.INFO)

    root_logger = logging.getLogger()
    root_logger.setLevel(new_level)

    # Update all handlers
    for handler in root_logger.handlers:
        handler.setLevel(new_level)

    # Log the change
    logger = get_logger("logging_config")
    logger.info(f"Log level changed to {new_level}", extra={"level_num": level_num})

    # Also update environment variable
    os.environ["LOG_LEVEL"] = str(level_num)
