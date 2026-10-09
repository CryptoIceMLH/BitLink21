"""BitLink21 persistent store (SQLite via aiosqlite).

Tables:
    messages  BitLink21 messages, both directions
    files     other HSModem files received off air (e.g. the QO-100
              multimedia beacon), content kept on disk next to the DB
    settings  key -> JSON value
"""

import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional

import aiosqlite

logger = logging.getLogger("bitlink21.store")

DB_PATH = os.environ.get("BITLINK21_DB_PATH", "/app/backend/data/bitlink21.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at REAL NOT NULL,
    direction TEXT NOT NULL,            -- 'rx' | 'tx'
    msg_id TEXT NOT NULL,
    payload_type INTEGER NOT NULL,
    callsign TEXT,
    body BLOB,                          -- clear payload (NULL if locked)
    encrypted INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,  -- rx: encrypted and not decryptable
    status TEXT NOT NULL,               -- rx: received | tx: queued/sending/sent/failed
    error TEXT,
    relay_status TEXT,                  -- plugin result status
    relay_result TEXT,                  -- plugin result JSON
    raw BLOB,                           -- envelope as sent/received
    echo_at REAL,                       -- tx: our own message heard back via the satellite
    echo_offset_hz REAL,                -- tx: measured uplink error at that time
    filename TEXT,                      -- plain HSModem file (tx), else NULL
    size INTEGER                        -- payload size in bytes
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_dir_msgid ON messages(direction, msg_id);

CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at REAL NOT NULL,
    name TEXT NOT NULL,
    frame_type INTEGER NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def _safe_name(name: str) -> str:
    name = os.path.basename(name or "file")
    return re.sub(r"[^A-Za-z0-9._-]", "_", name)[:80] or "file"


class Store:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.files_dir = os.path.join(os.path.dirname(db_path), "bitlink21_files")
        self.db: Optional[aiosqlite.Connection] = None

    async def open(self) -> None:
        if self.db is not None:
            return
        os.makedirs(os.path.dirname(self.db_path) or ".", exist_ok=True)
        os.makedirs(self.files_dir, exist_ok=True)
        db = await aiosqlite.connect(self.db_path)
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.executescript(_SCHEMA)
        # Upgrade databases created by older versions
        cur = await db.execute("PRAGMA table_info(messages)")
        have = {row[1] for row in await cur.fetchall()}
        for col, decl in (("echo_at", "REAL"), ("echo_offset_hz", "REAL"),
                          ("filename", "TEXT"), ("size", "INTEGER")):
            if col not in have:
                await db.execute(f"ALTER TABLE messages ADD COLUMN {col} {decl}")
        await db.commit()
        # Publish the connection only once the schema exists
        self.db = db
        logger.info(f"BitLink21 store opened at {self.db_path}")

    async def close(self) -> None:
        if self.db is not None:
            await self.db.close()
            self.db = None

    # ------------------------------------------------------------ settings

    async def get_settings(self) -> Dict[str, Any]:
        cur = await self.db.execute("SELECT key, value FROM settings")
        return {row["key"]: json.loads(row["value"]) for row in await cur.fetchall()}

    async def set_settings(self, values: Dict[str, Any]) -> None:
        await self.db.executemany(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            [(k, json.dumps(v)) for k, v in values.items()],
        )
        await self.db.commit()

    # ------------------------------------------------------------ messages

    async def add_message(self, **fields) -> Optional[int]:
        fields.setdefault("created_at", time.time())
        cols = ", ".join(fields)
        marks = ", ".join("?" for _ in fields)
        try:
            cur = await self.db.execute(
                f"INSERT INTO messages ({cols}) VALUES ({marks})", tuple(fields.values())
            )
        except aiosqlite.IntegrityError:
            return None  # duplicate (same direction + msg_id)
        await self.db.commit()
        return cur.lastrowid

    async def update_message(self, row_id: int, **fields) -> None:
        if not fields:
            return
        sets = ", ".join(f"{k} = ?" for k in fields)
        await self.db.execute(f"UPDATE messages SET {sets} WHERE id = ?", (*fields.values(), row_id))
        await self.db.commit()

    async def get_message(self, row_id: int) -> Optional[Dict[str, Any]]:
        cur = await self.db.execute("SELECT * FROM messages WHERE id = ?", (row_id,))
        row = await cur.fetchone()
        return self._message_dict(row) if row else None

    async def list_messages(self, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        cur = await self.db.execute(
            "SELECT * FROM messages ORDER BY created_at DESC LIMIT ? OFFSET ?", (limit, offset)
        )
        return [self._message_dict(r) for r in await cur.fetchall()]

    async def find_message(self, direction: str, msg_id: str) -> Optional[Dict[str, Any]]:
        cur = await self.db.execute(
            "SELECT * FROM messages WHERE direction = ? AND msg_id = ?", (direction, msg_id)
        )
        row = await cur.fetchone()
        return dict(row) if row else None

    async def find_sent_file(self, filename: str, size: int) -> Optional[Dict[str, Any]]:
        cur = await self.db.execute(
            "SELECT * FROM messages WHERE direction = 'tx' AND filename = ? AND size = ? "
            "ORDER BY created_at DESC LIMIT 1", (filename, size))
        row = await cur.fetchone()
        return dict(row) if row else None

    async def locked_messages(self) -> List[Dict[str, Any]]:
        cur = await self.db.execute("SELECT * FROM messages WHERE locked = 1")
        return [dict(r) for r in await cur.fetchall()]

    async def delete_message(self, row_id: int) -> bool:
        cur = await self.db.execute("DELETE FROM messages WHERE id = ?", (row_id,))
        await self.db.commit()
        return cur.rowcount > 0

    @staticmethod
    def _message_dict(row) -> Dict[str, Any]:
        d = dict(row)
        body = d.pop("body", None)
        d.pop("raw", None)
        if d.get("filename"):
            body = None  # sent files: name + size only
        if body is None:
            d["body_text"] = None
            d["body_hex"] = None
        else:
            body = bytes(body)
            d["body_hex"] = body.hex()
            try:
                d["body_text"] = body.decode("utf-8")
            except UnicodeDecodeError:
                d["body_text"] = None
        d["encrypted"] = bool(d["encrypted"])
        d["locked"] = bool(d["locked"])
        if d.get("relay_result"):
            try:
                d["relay_result"] = json.loads(d["relay_result"])
            except ValueError:
                pass
        return d

    # ------------------------------------------------------------ files

    async def add_file(self, name: str, frame_type: int, data: bytes) -> Dict[str, Any]:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        path = os.path.join(self.files_dir, f"{stamp}_{_safe_name(name)}")
        with open(path, "wb") as f:
            f.write(data)
        now = time.time()
        cur = await self.db.execute(
            "INSERT INTO files (created_at, name, frame_type, size, path) VALUES (?, ?, ?, ?, ?)",
            (now, name, frame_type, len(data), path),
        )
        await self.db.commit()
        return {"id": cur.lastrowid, "created_at": now, "name": name, "frame_type": frame_type, "size": len(data)}

    async def list_files(self, limit: int = 100) -> List[Dict[str, Any]]:
        cur = await self.db.execute(
            "SELECT id, created_at, name, frame_type, size FROM files ORDER BY created_at DESC LIMIT ?",
            (limit,),
        )
        return [dict(r) for r in await cur.fetchall()]

    async def read_file(self, file_id: int) -> Optional[Dict[str, Any]]:
        cur = await self.db.execute("SELECT * FROM files WHERE id = ?", (file_id,))
        row = await cur.fetchone()
        if not row:
            return None
        d = dict(row)
        try:
            with open(d["path"], "rb") as f:
                d["data"] = f.read()
        except OSError:
            d["data"] = None
        return d

    async def delete_file(self, file_id: int) -> bool:
        row = await self.read_file(file_id)
        if not row:
            return False
        try:
            os.remove(row["path"])
        except OSError:
            pass
        await self.db.execute("DELETE FROM files WHERE id = ?", (file_id,))
        await self.db.commit()
        return True


store = Store()
