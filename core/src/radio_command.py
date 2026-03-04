"""
Radio Command Sender — UDP client to C++ radio on port 40135
"""

import json
import asyncio
import socket
import os
from typing import Any
from .logging_config import get_logger

logger = get_logger("radio_command")


class RadioCommandSender:
    """Send control commands to the C++ radio via UDP"""

    def __init__(self, host: str = None, port: int = None):
        # Use environment variables if not provided (enables remote deployment)
        self.host = host or os.getenv("MODEM_HOST", "bitlink21-radio")
        self.port = port or int(os.getenv("MODEM_PORT", "40135"))
        self.sock = None
        logger.debug(f"[RADIO_CMD] RadioCommandSender initialized: host={self.host}, port={self.port}")

    async def send_command(self, cmd: str, value: Any) -> bool:
        """Send a command to the radio"""
        try:
            logger.debug(f"[RADIO_CMD] Preparing command: cmd={cmd}, value={value}")
            message = json.dumps({"cmd": cmd, "value": value})
            if self.sock is None:
                logger.debug(f"[RADIO_CMD] Creating UDP socket to {self.host}:{self.port}")
                self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            bytes_sent = self.sock.sendto(message.encode(), (self.host, self.port))
            logger.debug(f"[RADIO_CMD] Command sent: cmd={cmd}, host={self.host}, port={self.port}, bytes_sent={bytes_sent}")
            logger.info(f"Sending UDP to {self.host}:{self.port} — cmd={cmd}, value={value} — {bytes_sent} bytes sent")
            return True
        except Exception as e:
            logger.error(f"[RADIO_CMD] Failed to send command {cmd}: {e}")
            return False

    def close(self):
        """Close the UDP socket"""
        if self.sock:
            logger.debug(f"[RADIO_CMD] Closing UDP socket to {self.host}:{self.port}")
            self.sock.close()
            self.sock = None
            logger.debug(f"[RADIO_CMD] Socket closed")
