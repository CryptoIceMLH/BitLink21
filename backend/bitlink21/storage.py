"""BitLink21 Message Storage — SQLite/aiosqlite wrapper for persistent data."""

import aiosqlite
import sqlite3
from datetime import datetime
from typing import List, Optional, Dict, Any
import os
import logging

logger = logging.getLogger(__name__)
DB_PATH = "/app/data/bitlink21.db"


class Storage:
    """Async SQLite wrapper for message storage, queue, identity, contacts, config."""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.db: Optional[aiosqlite.Connection] = None

    async def init_db(self) -> None:
        """Initialize database, create tables if not exist."""
        logger.debug(f"[DB] Initializing database: {self.db_path}")
        # Ensure /data directory exists
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        logger.debug(f"[DB] Data directory ensured at {os.path.dirname(self.db_path)}")

        self.db = await aiosqlite.connect(self.db_path)
        logger.debug(f"[DB] Database connection established")
        await self.db.execute("PRAGMA journal_mode=WAL")  # Write-Ahead Logging
        logger.debug(f"[DB] WAL mode enabled")

        # Create tables
        await self.db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                msg_id INTEGER,
                payload_type INTEGER,
                payload_len INTEGER,
                sender_npub TEXT,
                body TEXT,
                rssi_db REAL,
                snr_db REAL,
                is_encrypted INTEGER DEFAULT 1,
                is_broadcast INTEGER DEFAULT 0,
                raw_bytes BLOB
            )
        """)

        await self.db.execute("""
            CREATE TABLE IF NOT EXISTS outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                destination_npub TEXT,
                payload_type INTEGER,
                body TEXT,
                status TEXT DEFAULT 'queued',
                error_msg TEXT,
                fec_encoded_len INTEGER,
                samples_transmitted INTEGER
            )
        """)

        await self.db.execute("""
            CREATE TABLE IF NOT EXISTS identity (
                id INTEGER PRIMARY KEY,
                npub TEXT UNIQUE,
                nsec TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        await self.db.execute("""
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                npub TEXT UNIQUE,
                nickname TEXT,
                last_seen INTEGER DEFAULT 0,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        await self.db.execute("""
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)

        await self.db.commit()
        logger.debug(f"[DB] All tables created/verified")

    async def save_message(self, msg_dict: Dict[str, Any]) -> int:
        """Insert received message, return row ID."""
        logger.debug(f"[DB] INSERT message: msg_id={msg_dict.get('msg_id')}, payload_type={msg_dict.get('payload_type')}, len={msg_dict.get('payload_len')} bytes, sender={msg_dict.get('sender_npub')[:8] if msg_dict.get('sender_npub') else 'None'}...")
        cursor = await self.db.execute("""
            INSERT INTO messages (msg_id, payload_type, payload_len, sender_npub, body,
                                 rssi_db, snr_db, is_encrypted, is_broadcast, raw_bytes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            msg_dict.get("msg_id"),
            msg_dict.get("payload_type", 0),
            msg_dict.get("payload_len", 0),
            msg_dict.get("sender_npub"),
            msg_dict.get("body", ""),
            msg_dict.get("rssi_db"),
            msg_dict.get("snr_db"),
            msg_dict.get("is_encrypted", 1),
            msg_dict.get("is_broadcast", 0),
            msg_dict.get("raw_bytes"),
        ))
        await self.db.commit()
        row_id = cursor.lastrowid
        logger.debug(f"[DB] Message inserted with ID: {row_id}")
        return row_id

    async def get_messages(self, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        """Retrieve recent messages."""
        logger.debug(f"[DB] SELECT messages: limit={limit}, offset={offset}")
        cursor = await self.db.execute("""
            SELECT id, timestamp, msg_id, payload_type, payload_len, sender_npub, body,
                   rssi_db, snr_db, is_encrypted, is_broadcast
            FROM messages
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
        """, (limit, offset))
        rows = await cursor.fetchall()
        logger.debug(f"[DB] Retrieved {len(rows)} messages")
        return [
            {
                "id": row[0],
                "timestamp": row[1],
                "msg_id": row[2],
                "payload_type": row[3],
                "payload_len": row[4],
                "sender_npub": row[5],
                "body": row[6],
                "rssi_db": row[7],
                "snr_db": row[8],
                "is_encrypted": row[9],
                "is_broadcast": row[10],
            }
            for row in rows
        ]

    async def get_message_by_id(self, msg_id: int) -> Optional[Dict[str, Any]]:
        """Fetch single message."""
        logger.debug(f"[DB] SELECT message by id: {msg_id}")
        cursor = await self.db.execute("""
            SELECT id, timestamp, msg_id, payload_type, payload_len, sender_npub, body,
                   rssi_db, snr_db, is_encrypted, is_broadcast
            FROM messages WHERE id = ?
        """, (msg_id,))
        row = await cursor.fetchone()
        if not row:
            logger.debug(f"[DB] Message not found: {msg_id}")
            return None
        logger.debug(f"[DB] Message found: {msg_id}")
        return {
            "id": row[0],
            "timestamp": row[1],
            "msg_id": row[2],
            "payload_type": row[3],
            "payload_len": row[4],
            "sender_npub": row[5],
            "body": row[6],
            "rssi_db": row[7],
            "snr_db": row[8],
            "is_encrypted": row[9],
            "is_broadcast": row[10],
        }

    async def add_to_outbox(self, npub: Optional[str], payload_type: int, body: str) -> int:
        """Queue frame for TX, return row ID."""
        logger.debug(f"[DB] INSERT outbox: destination_npub={npub[:8] if npub else 'None'}..., payload_type={payload_type}, body_len={len(body)} bytes")
        cursor = await self.db.execute("""
            INSERT INTO outbox (destination_npub, payload_type, body, status)
            VALUES (?, ?, ?, 'queued')
        """, (npub, payload_type, body))
        await self.db.commit()
        row_id = cursor.lastrowid
        logger.debug(f"[DB] Outbox entry created with ID: {row_id}")
        return row_id

    async def pop_from_outbox(self) -> Optional[Dict[str, Any]]:
        """Get next queued frame, mark as 'sent'."""
        logger.debug(f"[DB] SELECT from outbox where status='queued' (first)")
        cursor = await self.db.execute("""
            SELECT id, destination_npub, payload_type, body
            FROM outbox WHERE status = 'queued'
            ORDER BY timestamp ASC LIMIT 1
        """)
        row = await cursor.fetchone()
        if not row:
            logger.debug(f"[DB] No queued items in outbox")
            return None

        frame_id = row[0]
        logger.debug(f"[DB] UPDATE outbox: id={frame_id} status='sent'")
        await self.db.execute("""
            UPDATE outbox SET status = 'sent' WHERE id = ?
        """, (frame_id,))
        await self.db.commit()
        logger.debug(f"[DB] Outbox item marked as sent: {frame_id}")

        return {
            "id": frame_id,
            "destination_npub": row[1],
            "payload_type": row[2],
            "body": row[3],
        }

    async def update_outbox_status(self, frame_id: int, status: str, error: Optional[str] = None) -> None:
        """Update TX status."""
        logger.debug(f"[DB] UPDATE outbox: id={frame_id}, status={status}, error={error}")
        await self.db.execute("""
            UPDATE outbox SET status = ?, error_msg = ? WHERE id = ?
        """, (status, error, frame_id))
        await self.db.commit()
        logger.debug(f"[DB] Outbox status updated: {frame_id}")

    async def get_outbox_depth(self) -> int:
        """Count queued frames."""
        logger.debug(f"[DB] SELECT COUNT queued items from outbox")
        cursor = await self.db.execute("""
            SELECT COUNT(*) FROM outbox WHERE status = 'queued'
        """)
        row = await cursor.fetchone()
        count = row[0] if row else 0
        logger.debug(f"[DB] Outbox depth: {count} queued items")
        return count

    async def get_identity(self) -> Optional[Dict[str, str]]:
        """Get stored NPUB/NSEC."""
        logger.debug(f"[DB] SELECT identity")
        cursor = await self.db.execute("""
            SELECT npub, nsec FROM identity LIMIT 1
        """)
        row = await cursor.fetchone()
        if not row:
            logger.debug(f"[DB] No identity configured")
            return None
        logger.debug(f"[DB] Identity found: npub={row[0][:8]}...")
        return {"npub": row[0], "nsec": row[1]}

    async def set_identity(self, npub: str, nsec: str) -> None:
        """Store or update identity."""
        logger.debug(f"[DB] SET identity: npub={npub[:8]}..., nsec={nsec[:8] if nsec else 'None'}...")
        # Delete existing, then insert
        await self.db.execute("DELETE FROM identity")
        await self.db.execute("""
            INSERT INTO identity (npub, nsec) VALUES (?, ?)
        """, (npub, nsec))
        await self.db.commit()
        logger.debug(f"[DB] Identity stored successfully")

    async def add_contact(self, npub: str, nickname: Optional[str] = None) -> None:
        """Add to contacts."""
        logger.debug(f"[DB] INSERT contact: npub={npub[:8]}..., nickname={nickname}")
        await self.db.execute("""
            INSERT OR IGNORE INTO contacts (npub, nickname) VALUES (?, ?)
        """, (npub, nickname))
        await self.db.commit()
        logger.debug(f"[DB] Contact added: {npub[:8]}...")

    async def get_contacts(self) -> List[Dict[str, Any]]:
        """Retrieve all contacts with last_seen timestamp."""
        logger.debug(f"[DB] SELECT contacts")
        cursor = await self.db.execute("""
            SELECT npub, nickname, last_seen FROM contacts ORDER BY last_seen DESC
        """)
        rows = await cursor.fetchall()
        logger.debug(f"[DB] Retrieved {len(rows)} contacts")
        return [
            {"npub": row[0], "nickname": row[1] or "", "last_seen": row[2] or 0}
            for row in rows
        ]

    async def get_config(self, key: str, default: Optional[str] = None) -> Optional[str]:
        """Get config value."""
        logger.debug(f"[DB] SELECT config: key={key}")
        cursor = await self.db.execute("""
            SELECT value FROM config WHERE key = ?
        """, (key,))
        row = await cursor.fetchone()
        result = row[0] if row else default
        logger.debug(f"[DB] Config value: {key}={result[:20] if result else 'None'}...")
        return result

    async def set_config(self, key: str, value: str) -> None:
        """Store config."""
        logger.debug(f"[DB] SET config: key={key}, value={value[:20] if value else 'None'}...")
        await self.db.execute("""
            INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)
        """, (key, value))
        await self.db.commit()
        logger.debug(f"[DB] Config stored: {key}")

    async def delete_old_messages(self, days: int = 7) -> None:
        """Purge messages older than N days (background task)."""
        logger.debug(f"[DB] DELETE messages older than {days} days")
        await self.db.execute("""
            DELETE FROM messages
            WHERE timestamp < datetime('now', ? || ' days')
        """, (f"-{days}",))
        await self.db.commit()
        logger.debug(f"[DB] Message cleanup completed")

    # --- Aliases expected by bitlink21 handlers ---

    async def enqueue_message(self, data: Dict[str, Any]) -> int:
        """Alias for add_to_outbox (handler-compatible)."""
        return await self.add_to_outbox(
            destination_npub=data.get("destination_npub"),
            payload_type=data.get("payload_type", "text"),
            body=data.get("body", ""),
        )

    async def get_messages(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """Get messages with pagination."""
        cursor = await self.db.execute("""
            SELECT id, sender_npub, payload_type, body, rssi_db, snr_db, timestamp
            FROM messages ORDER BY timestamp DESC LIMIT ? OFFSET ?
        """, (limit, offset))
        rows = await cursor.fetchall()
        return [
            {"id": r[0], "sender_npub": r[1], "payload_type": r[2], "body": r[3],
             "rssi_db": r[4], "snr_db": r[5], "timestamp": r[6]}
            for r in rows
        ]

    async def get_outbox(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """Get outbox entries with pagination."""
        cursor = await self.db.execute("""
            SELECT id, destination_npub, payload_type, body, status, error_msg, timestamp
            FROM outbox ORDER BY timestamp DESC LIMIT ? OFFSET ?
        """, (limit, offset))
        rows = await cursor.fetchall()
        return [
            {"id": r[0], "destination_npub": r[1], "payload_type": r[2], "body": r[3],
             "status": r[4], "error_msg": r[5], "timestamp": r[6]}
            for r in rows
        ]

    async def get_outbox_pending_count(self) -> int:
        """Alias for get_outbox_depth."""
        return await self.get_outbox_depth()

    async def delete_contact(self, npub: str) -> bool:
        """Delete a contact by npub."""
        cursor = await self.db.execute("DELETE FROM contacts WHERE npub = ?", (npub,))
        await self.db.commit()
        return cursor.rowcount > 0

    async def get_stats(self) -> Dict[str, Any]:
        """Get messaging statistics."""
        msg_count = (await (await self.db.execute("SELECT COUNT(*) FROM messages")).fetchone())[0]
        outbox_queued = await self.get_outbox_depth()
        outbox_total = (await (await self.db.execute("SELECT COUNT(*) FROM outbox")).fetchone())[0]
        contact_count = (await (await self.db.execute("SELECT COUNT(*) FROM contacts")).fetchone())[0]
        return {
            "messages_received": msg_count,
            "outbox_queued": outbox_queued,
            "outbox_total": outbox_total,
            "contacts": contact_count,
        }

    async def close(self) -> None:
        """Close database connection."""
        if self.db:
            logger.debug(f"[DB] Closing database connection")
            await self.db.close()
            logger.debug(f"[DB] Database connection closed")


# Module-level singleton instance
storage = Storage()
