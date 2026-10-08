"""oscardata / HSModem file transfer layer.

Compatible with DJ0ABR's oscardata (ArraySend.cs / receivefile.cs) and
gr-satellites' ``qo100_multimedia`` file receiver.

A file is sent as consecutive frames whose 219-byte payloads carry:

    first frame:  filename (50 B, ASCII, NUL padded)
                  file id = CRC16 of the transmitted bytes (2 B, big endian)
                  file size (3 B, big endian)
                  first 164 bytes of the file
    next frames:  219 bytes of file data each
    last frame:   remaining bytes, zero padded

For ASCII (3), HTML (4) and binary (5) types the transmitted bytes are a
zip archive holding one entry named like the file.
"""

import io
import zipfile
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from . import framing
from .framing import (
    PAYLOAD_LEN,
    STATUS_FIRST,
    STATUS_LAST,
    STATUS_NEXT,
    STATUS_SINGLE,
)

FILE_HEADER_LEN = 55
FIRST_CHUNK_DATA = PAYLOAD_LEN - FILE_HEADER_LEN  # 164
ZIPPED_TYPES = (framing.TYPE_ASCII_FILE, framing.TYPE_HTML_FILE, framing.TYPE_BINARY_FILE)
MAX_FILE_SIZE = (1 << 24) - 1


def zip_bytes(name: str, data: bytes) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(name, data)
    return buf.getvalue()


def build_file_frames(
    name: str,
    data: bytes,
    frame_type: int = framing.TYPE_BINARY_FILE,
    repeat_first: int = 3,
    repeat_last: int = 3,
) -> List[bytes]:
    """Return the list of 258-byte on-air blocks for one file, in TX order.

    First and last frames are repeated, as hsmodem does, so a receiver that
    is still acquiring at the start of the burst does not lose the file.
    """
    tx = zip_bytes(name, data) if frame_type in ZIPPED_TYPES else bytes(data)
    if len(tx) > MAX_FILE_SIZE:
        raise ValueError(f"file too large ({len(tx)} bytes)")
    # The 10-bit frame counter limits a file to 1024 frames.
    if len(tx) > FIRST_CHUNK_DATA + 1023 * PAYLOAD_LEN:
        raise ValueError("file too large for one HSModem transfer (max ~224 kB)")

    name_bytes = name.encode("ascii", "replace")[:50].ljust(50, b"\x00")
    file_id = framing.crc16(tx)
    size = len(tx)
    header = name_bytes + bytes([file_id >> 8, file_id & 0xFF, (size >> 16) & 0xFF, (size >> 8) & 0xFF, size & 0xFF])

    stream = header + tx
    chunks = [stream[i: i + PAYLOAD_LEN] for i in range(0, len(stream), PAYLOAD_LEN)]

    blocks: List[bytes] = []
    if len(chunks) == 1:
        blk = framing.pack_frame(chunks[0], frame_type, STATUS_SINGLE, 0)
        return [blk] * max(1, repeat_first)

    for seq, chunk in enumerate(chunks):
        if seq == 0:
            status, reps = STATUS_FIRST, max(1, repeat_first)
        elif seq == len(chunks) - 1:
            status, reps = STATUS_LAST, max(1, repeat_last)
        else:
            status, reps = STATUS_NEXT, 1
        blk = framing.pack_frame(chunk, frame_type, status, seq)
        blocks.extend([blk] * reps)
    return blocks


@dataclass
class ReceivedFile:
    name: str
    frame_type: int
    data: bytes  # unzipped content
    file_id: int


@dataclass
class _Partial:
    name: str
    frame_type: int
    file_id: int
    size: int
    chunks: Dict[int, bytes] = field(default_factory=dict)
    last_seq: Optional[int] = None

    def missing(self) -> List[int]:
        if self.last_seq is None:
            return []
        return [s for s in range(self.last_seq + 1) if s not in self.chunks]

    def assemble(self) -> Optional[bytes]:
        if self.last_seq is None or self.missing():
            return None
        stream = b"".join(self.chunks[s] for s in range(self.last_seq + 1))
        return stream[FILE_HEADER_LEN: FILE_HEADER_LEN + self.size]


class FileReceiver:
    """Reassembles files from decoded frames (duplicates are ignored)."""

    def __init__(self):
        self._current: Optional[_Partial] = None
        self._done_ids: List[Tuple[int, int]] = []

    def progress(self) -> Optional[dict]:
        p = self._current
        if p is None:
            return None
        total = None
        if p.size:
            total = 1 + max(0, -(-(p.size - FIRST_CHUNK_DATA) // PAYLOAD_LEN))
        return {"name": p.name, "size": p.size, "chunks": len(p.chunks), "total_chunks": total}

    def push(self, frame: framing.Frame) -> Optional[ReceivedFile]:
        if frame.frame_type >= framing.TYPE_EXTERNAL or frame.frame_type in (
            framing.TYPE_BER_TEST, framing.TYPE_AUDIO, framing.TYPE_USERINFO
        ):
            return None
        # hsmodem increments the counter for single-frame files, so a single
        # frame is always treated as sequence 0.
        seq = 0 if frame.status == STATUS_SINGLE else frame.counter
        if seq == 0 and frame.status in (STATUS_FIRST, STATUS_SINGLE):
            pl = frame.payload
            name = pl[:50].rstrip(b"\x00").replace(b"\x00", b" ").decode("ascii", "replace")
            file_id = (pl[50] << 8) | pl[51]
            size = (pl[52] << 16) | (pl[53] << 8) | pl[54]
            key = (file_id, size)
            cur = self._current
            if cur is None or (cur.file_id, cur.size) != key:
                if key in self._done_ids:
                    return None  # repeat of a file we already have
                self._current = _Partial(name, frame.frame_type, file_id, size)
        cur = self._current
        if cur is None or frame.frame_type != cur.frame_type:
            return None
        cur.chunks.setdefault(seq, frame.payload)
        if frame.status in (STATUS_LAST, STATUS_SINGLE):
            cur.last_seq = seq
        raw = cur.assemble()
        if raw is None:
            return None
        if framing.crc16(raw) != cur.file_id:
            self._current = None
            return None
        content = raw
        if cur.frame_type in ZIPPED_TYPES:
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                    names = zf.namelist()
                    content = zf.read(cur.name if cur.name in names else names[0])
            except (zipfile.BadZipFile, KeyError, IndexError):
                self._current = None
                return None
        self._done_ids = (self._done_ids + [(cur.file_id, cur.size)])[-32:]
        self._current = None
        return ReceivedFile(cur.name, cur.frame_type, content, cur.file_id)
