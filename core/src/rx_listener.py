"""
BUG-20: UDP Listener for RX SSP frames from radio on port 40132

The C++ radio module sends decoded SSP frames via UDP to port 40132.
This listener receives them, decrypts if needed, stores in database, and notifies the web UI.
"""

import asyncio
import logging
import json
from typing import Callable
from pathlib import Path
import aiosqlite
from datetime import datetime

from .logging_config import get_logger
from .ssp_frame import SSPFrame, SSPFrameAssembler, SSP_FRAME_SIZE

logger = get_logger("rx_listener")

MESSAGES_DB = Path("/app/data/bitlink21.db")
CONFIG_FILE = Path("/app/data/config.json")

# Global frame assembler for multi-fragment message reassembly
frame_assembler = SSPFrameAssembler(reassembly_timeout=120)


class RxFrameListener:
    """UDP listener for RX SSP frames from radio on port 40132"""

    def __init__(self, host: str = "0.0.0.0", port: int = 40132):
        self.host = host
        self.port = port
        self.transport = None
        self.protocol = None
        self.running = False
        self.cleanup_task = None

    async def start(self):
        """Start listening for RX frames"""
        logger.debug(f"[RX_LISTENER] Starting listener on {self.host}:{self.port}")
        loop = asyncio.get_event_loop()
        self.transport, self.protocol = await loop.create_datagram_endpoint(
            lambda: RxFrameProtocol(self._handle_frame),
            local_addr=(self.host, self.port)
        )
        self.running = True
        # Start periodic cleanup of expired fragments
        self.cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.debug(f"[RX_LISTENER] Cleanup task created")
        logger.info(f"RX listener started on {self.host}:{self.port}")

    async def stop(self):
        """Stop listening"""
        logger.debug(f"[RX_LISTENER] Stopping listener")
        if self.transport:
            logger.debug(f"[RX_LISTENER] Closing transport")
            self.transport.close()
        if self.cleanup_task:
            logger.debug(f"[RX_LISTENER] Cancelling cleanup task")
            self.cleanup_task.cancel()
        self.running = False
        logger.info("RX listener stopped")

    async def _handle_frame(self, data: bytes, addr: tuple):
        """Process received SSP frame (binary format from C++ radio)"""
        try:
            logger.debug(f"[RX_LISTENER] Frame received from {addr}: size={len(data)} bytes")
            # Validate frame size
            if len(data) != SSP_FRAME_SIZE:
                logger.warning(f"[RX_LISTENER] Invalid frame size from {addr}: expected {SSP_FRAME_SIZE}, got {len(data)}")
                return

            # Parse binary SSP frame
            logger.debug(f"[RX_LISTENER] Parsing SSP frame from {addr}")
            ssp_frame = SSPFrame.from_bytes(data)
            if not ssp_frame:
                logger.warning(f"[RX_LISTENER] Failed to parse SSP frame from {addr}")
                return

            logger.debug(f"[RX_LISTENER] Parsed frame: msg_id={ssp_frame.msg_id}, payload_type={ssp_frame.payload_type}, payload_len={ssp_frame.payload_len}")

            # Handle fragmented messages
            if ssp_frame.total_frags > 1:
                logger.debug(f"[RX_LISTENER] Fragmented message: seq={ssp_frame.seq_num}/{ssp_frame.total_frags}, msg_id={ssp_frame.msg_id}")
                reassembled_payload = frame_assembler.add_frame(ssp_frame)
                if reassembled_payload:
                    # All fragments received - update frame with complete payload
                    logger.debug(f"[RX_LISTENER] All fragments received for msg_id={ssp_frame.msg_id}, total_payload_len={len(reassembled_payload)}")
                    ssp_frame.payload = reassembled_payload
                    ssp_frame.total_frags = 1  # Mark as complete
                    await self._store_message(ssp_frame)
                    logger.debug(f"Reassembled and stored fragmented message: msg_id={ssp_frame.msg_id} from {addr}")
                else:
                    # Waiting for more fragments
                    logger.debug(f"Received fragment seq={ssp_frame.seq_num}/{ssp_frame.total_frags} for msg_id={ssp_frame.msg_id} from {addr}")
            else:
                # Single fragment - store immediately
                logger.debug(f"[RX_LISTENER] Single fragment message, storing directly")
                await self._store_message(ssp_frame)
                logger.debug(f"Stored RX frame: msg_id={ssp_frame.msg_id} seq={ssp_frame.seq_num} from {addr}")

        except Exception as e:
            logger.error(f"[RX_LISTENER] Error handling RX frame from {addr}: {e}")

    async def _cleanup_loop(self):
        """Periodically clean up expired fragment reassembly buffers"""
        try:
            logger.debug(f"[RX_LISTENER] Cleanup loop started")
            while self.running:
                await asyncio.sleep(30)  # Cleanup every 30 seconds
                logger.debug(f"[RX_LISTENER] Running fragment cleanup, pending_messages={len(frame_assembler.fragments)}")
                frame_assembler.cleanup_expired()
        except asyncio.CancelledError:
            logger.debug(f"[RX_LISTENER] Cleanup loop cancelled")
        except Exception as e:
            logger.error(f"[RX_LISTENER] Error in cleanup loop: {e}")

    async def _store_message(self, ssp_frame: SSPFrame):
        """Store RX SSP frame in messages database with decryption pipeline"""
        try:
            logger.debug(f"[RX_LISTENER] Storing message: msg_id={ssp_frame.msg_id}, payload_type={ssp_frame.payload_type}, encrypted={ssp_frame.is_encrypted()}")
            decrypted_plaintext = None
            sender_npub = ""
            error_detail = None

            # Load configuration for decryption
            logger.debug(f"[RX_LISTENER] Loading config from {CONFIG_FILE}")
            config = {}
            if CONFIG_FILE.exists():
                config = json.loads(CONFIG_FILE.read_text())
                logger.debug(f"[RX_LISTENER] Config loaded: has_nsec={bool(config.get('nsec'))}, has_broadcast_key={bool(config.get('broadcast_key'))}")

            # Decryption pipeline: check flags and decrypt if needed
            if ssp_frame.is_encrypted():
                logger.debug(f"[RX_LISTENER] Frame is encrypted, attempting decryption")
                nsec = config.get("nsec", "")
                broadcast_key = config.get("broadcast_key", "")
                payload_str = ssp_frame.payload.decode("utf-8", errors="ignore")

                try:
                    if ssp_frame.is_broadcast():
                        logger.debug(f"[RX_LISTENER] Broadcast frame detected")
                        # Broadcast mode: decrypt with broadcast key
                        if broadcast_key:
                            logger.debug(f"[RX_LISTENER] Broadcast key available, decrypting")
                            from .encryption import decrypt_broadcast
                            decrypted_plaintext = decrypt_broadcast(payload_str, broadcast_key)
                            sender_npub = "BROADCAST"
                        else:
                            logger.debug(f"[RX_LISTENER] Broadcast key not configured")
                            error_detail = "Broadcast key not configured"
                            decrypted_plaintext = "[encrypted - cannot decrypt]"
                    else:
                        logger.debug(f"[RX_LISTENER] P2P frame detected, sender NPUB required for decryption")
                        # P2P mode: decrypt with NIP-04 (requires sender_npub in content or metadata)
                        # NOTE: Without sender NPUB embedded in the frame, we cannot decrypt.
                        # This is a design limitation — show as encrypted instead of crashing.
                        error_detail = "P2P frame: sender NPUB not available (cannot decrypt)"
                        decrypted_plaintext = "[encrypted]"
                        sender_npub = ""

                except Exception as decrypt_err:
                    logger.warning(f"[RX_LISTENER] Decryption error: {decrypt_err}")
                    decrypted_plaintext = "[encrypted - cannot decrypt]"
                    error_detail = str(decrypt_err)

            else:
                # Plaintext frame
                logger.debug(f"[RX_LISTENER] Frame is plaintext")
                decrypted_plaintext = ssp_frame.payload.decode("utf-8", errors="replace")

            # Ensure database table exists
            logger.debug(f"[RX_LISTENER] Opening database connection to {MESSAGES_DB}")
            async with aiosqlite.connect(str(MESSAGES_DB)) as db:
                await db.execute("""
                    CREATE TABLE IF NOT EXISTS messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp_ms INTEGER,
                        direction TEXT,
                        sender_npub TEXT,
                        recipient_npub TEXT,
                        payload_type INTEGER,
                        body_base64 TEXT,
                        msg_id INTEGER,
                        seq_num INTEGER,
                        total_frags INTEGER,
                        rssi_db REAL,
                        snr_db REAL
                    )
                """)

                # Store DECRYPTED plaintext (or error message if decrypt failed)
                await db.execute("""
                    INSERT INTO messages (
                        timestamp_ms, direction, sender_npub, recipient_npub, payload_type,
                        body_base64, msg_id, seq_num, total_frags, rssi_db, snr_db
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    int(datetime.now().timestamp() * 1000),
                    'RX',
                    sender_npub,
                    '',  # Recipient NPUB
                    ssp_frame.payload_type,
                    decrypted_plaintext or "[error - see logs]",
                    ssp_frame.msg_id,
                    ssp_frame.seq_num,
                    ssp_frame.total_frags,
                    None,  # RSSI from metrics, not SSP frame
                    None   # SNR from metrics, not SSP frame
                ))

                await db.commit()
                logger.debug(f"[RX_LISTENER] Message stored to database: msg_id={ssp_frame.msg_id}")

                if error_detail:
                    logger.warning(f"[RX_LISTENER] Message stored with decryption issue: {error_detail}")
                else:
                    logger.debug(f"Stored RX frame: msg_id={ssp_frame.msg_id} encrypted={ssp_frame.is_encrypted()}")

        except Exception as e:
            logger.error(f"[RX_LISTENER] Failed to store message: {e}")


class RxFrameProtocol(asyncio.DatagramProtocol):
    """UDP datagram protocol for RX frames"""

    def __init__(self, handler: Callable):
        self.handler = handler
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data: bytes, addr: tuple):
        """Called when UDP packet is received"""
        logger.debug(f"[RX_LISTENER] datagram_received from {addr}: {len(data)} bytes")
        asyncio.create_task(self.handler(data, addr))

    def error_received(self, exc):
        logger.error(f"[RX_LISTENER] UDP error: {exc}")

    def connection_lost(self, exc):
        if exc:
            logger.error(f"[RX_LISTENER] UDP connection lost: {exc}")
        else:
            logger.debug(f"[RX_LISTENER] UDP connection closed")
