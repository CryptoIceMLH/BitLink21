"""
Satoshi Signal Protocol (SSP) Frame Handling

SSP Frame Format (219 bytes total):
- Offset 0-3:   MAGIC (0x53 0x53 0x50 0x21 = "SSP!")
- Offset 4:     VERSION (0x01)
- Offset 5:     FLAGS (bit 0: encrypted, bit 1: broadcast, bits 2-7: reserved)
- Offset 6-7:   MSG_ID (unique message identifier)
- Offset 8:     SEQ_NUM (0-based fragment sequence)
- Offset 9:     TOTAL_FRAGS (total fragments in message)
- Offset 10-11: PAYLOAD_LEN (bytes of actual data)
- Offset 12:    PAYLOAD_TYPE (0=text, 1=bitcoin_tx, 2=lightning, 3=binary)
- Offset 13-14: RESERVED (0x0000)
- Offset 15-218: PAYLOAD (204 bytes max per frame)
- Total: 219 bytes
"""

import struct
import time
from typing import Tuple, Optional
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)
# Ensure debug logging is visible
logging.getLogger(__name__).setLevel(logging.DEBUG)

# SSP Constants
SSP_MAGIC = b'SSP!'
SSP_VERSION = 0x01
SSP_FRAME_SIZE = 219
SSP_HEADER_SIZE = 15
SSP_PAYLOAD_SIZE = 204

# Flags
SSP_FLAG_ENCRYPTED = 0x01
SSP_FLAG_BROADCAST = 0x02

# Payload Types
class PayloadType:
    TEXT = 0
    BITCOIN_TX = 1
    LIGHTNING = 2
    BINARY = 3


@dataclass
class SSPFrame:
    """Represents a single SSP frame"""
    magic: bytes = SSP_MAGIC
    version: int = SSP_VERSION
    flags: int = 0
    msg_id: int = 0
    seq_num: int = 0
    total_frags: int = 1
    payload_len: int = 0
    payload_type: int = PayloadType.TEXT
    payload: bytes = b''

    def to_bytes(self) -> bytes:
        """Serialize SSP frame to 219-byte packet"""
        logger.debug(f"[SSP_FRAME] to_bytes: msg_id={self.msg_id}, payload_type={self.payload_type}, payload_len={self.payload_len}, encrypted={bool(self.flags & SSP_FLAG_ENCRYPTED)}, broadcast={bool(self.flags & SSP_FLAG_BROADCAST)}")
        frame = bytearray(SSP_FRAME_SIZE)

        # Header
        frame[0:4] = self.magic
        frame[4] = self.version
        frame[5] = self.flags
        struct.pack_into('>H', frame, 6, self.msg_id)
        frame[8] = self.seq_num
        frame[9] = self.total_frags
        struct.pack_into('>H', frame, 10, self.payload_len)
        frame[12] = self.payload_type
        struct.pack_into('>H', frame, 13, 0)  # RESERVED

        # Payload (pad to SSP_PAYLOAD_SIZE)
        payload_padded = self.payload + b'\x00' * (SSP_PAYLOAD_SIZE - len(self.payload))
        frame[SSP_HEADER_SIZE:SSP_HEADER_SIZE + len(payload_padded)] = payload_padded[:SSP_PAYLOAD_SIZE]

        logger.debug(f"[SSP_FRAME] Frame serialized: {SSP_FRAME_SIZE} bytes")
        return bytes(frame)

    @staticmethod
    def from_bytes(data: bytes) -> Optional['SSPFrame']:
        """Deserialize SSP frame from 219-byte packet"""
        logger.debug(f"[SSP_FRAME] from_bytes called: data_len={len(data)}")
        if len(data) < SSP_FRAME_SIZE:
            logger.warning(f"[SSP_FRAME] Frame too short: {len(data)} < {SSP_FRAME_SIZE}")
            return None

        try:
            frame = SSPFrame()
            frame.magic = data[0:4]

            if frame.magic != SSP_MAGIC:
                logger.warning(f"[SSP_FRAME] Invalid SSP magic: {frame.magic.hex()}")
                return None

            frame.version = data[4]
            if frame.version != SSP_VERSION:
                logger.warning(f"[SSP_FRAME] Unsupported SSP version: {frame.version}")
                return None

            frame.flags = data[5]
            frame.msg_id = struct.unpack('>H', data[6:8])[0]
            frame.seq_num = data[8]
            frame.total_frags = data[9]
            frame.payload_len = struct.unpack('>H', data[10:12])[0]
            frame.payload_type = data[12]
            # Reserved at 13-14
            frame.payload = data[SSP_HEADER_SIZE:SSP_HEADER_SIZE + frame.payload_len]

            logger.debug(f"[SSP_FRAME] Frame parsed: msg_id={frame.msg_id}, payload_type={frame.payload_type}, seq={frame.seq_num}/{frame.total_frags}, payload_len={frame.payload_len}")
            return frame
        except Exception as e:
            logger.error(f"[SSP_FRAME] Error parsing SSP frame: {e}")
            return None

    def is_encrypted(self) -> bool:
        return bool(self.flags & SSP_FLAG_ENCRYPTED)

    def is_broadcast(self) -> bool:
        return bool(self.flags & SSP_FLAG_BROADCAST)


class SSPFrameAssembler:
    """Reassemble fragmented SSP messages"""

    def __init__(self, reassembly_timeout: int = 120):
        """
        Args:
            reassembly_timeout: Seconds to wait for all fragments before timeout
        """
        self.reassembly_timeout = reassembly_timeout
        self.fragments = {}  # msg_id -> {seq_num -> frame}
        self.timestamps = {}  # msg_id -> timestamp

    def add_frame(self, frame: SSPFrame) -> Optional[bytes]:
        """
        Add a frame to assembly buffer. Returns complete payload if all fragments received.

        Returns:
            Assembled payload bytes if complete, None otherwise
        """
        msg_id = frame.msg_id
        logger.debug(f"[SSP_ASSEMBLER] add_frame: msg_id={msg_id}, seq={frame.seq_num}/{frame.total_frags}, payload_len={len(frame.payload)}")

        if msg_id not in self.fragments:
            logger.debug(f"[SSP_ASSEMBLER] New message: msg_id={msg_id}, expecting {frame.total_frags} fragments")
            self.fragments[msg_id] = {}
            self.timestamps[msg_id] = time.time()

        # Store fragment
        self.fragments[msg_id][frame.seq_num] = frame.payload
        current_count = len(self.fragments[msg_id])
        logger.debug(f"[SSP_ASSEMBLER] Fragment stored: msg_id={msg_id}, progress={current_count}/{frame.total_frags}")

        # Check if complete
        if current_count == frame.total_frags:
            logger.debug(f"[SSP_ASSEMBLER] All fragments received, assembling message: msg_id={msg_id}")
            # Assemble in order
            payload = b''
            for seq in range(frame.total_frags):
                if seq not in self.fragments[msg_id]:
                    logger.error(f"[SSP_ASSEMBLER] Missing fragment {seq} for message {msg_id}")
                    return None
                payload += self.fragments[msg_id][seq]

            logger.debug(f"[SSP_ASSEMBLER] Message assembled: msg_id={msg_id}, total_len={len(payload)} bytes")
            # Cleanup
            del self.fragments[msg_id]
            del self.timestamps[msg_id]

            return payload

        return None

    def cleanup_expired(self):
        """Remove messages that have exceeded reassembly timeout"""
        import time
        now = time.time()
        expired = [msg_id for msg_id, ts in self.timestamps.items()
                  if now - ts > self.reassembly_timeout]
        if expired:
            logger.debug(f"[SSP_ASSEMBLER] Cleanup: found {len(expired)} expired messages")
        for msg_id in expired:
            frag_count = len(self.fragments.get(msg_id, {}))
            logger.warning(f"[SSP_ASSEMBLER] Message {msg_id} reassembly timeout ({frag_count} fragments), dropping")
            del self.fragments[msg_id]
            del self.timestamps[msg_id]
