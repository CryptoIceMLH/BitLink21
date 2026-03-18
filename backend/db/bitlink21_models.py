"""SQLAlchemy models for BitLink21 tables.

Defines the database schema for SSP messaging, identity management,
contacts, outbox queue, and configuration storage.
"""

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, Integer, LargeBinary, String, Boolean

from db.models import AwareDateTime, Base


class BitLink21Message(Base):
    """Inbound SSP messages received over the satellite link."""

    __tablename__ = "bitlink21_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(
        AwareDateTime, nullable=False, default=datetime.now(timezone.utc), index=True
    )
    msg_id = Column(Integer, nullable=False, index=True)
    payload_type = Column(String, nullable=False)
    payload_len = Column(Integer, nullable=False, default=0)
    sender_npub = Column(String, nullable=True, index=True)
    body = Column(String, nullable=True)
    rssi_db = Column(Float, nullable=True)
    snr_db = Column(Float, nullable=True)
    is_encrypted = Column(Boolean, nullable=False, default=False)
    is_broadcast = Column(Boolean, nullable=False, default=False)
    raw_bytes = Column(LargeBinary, nullable=True)


class BitLink21Outbox(Base):
    """Outbound message queue awaiting TX over the satellite link."""

    __tablename__ = "bitlink21_outbox"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(
        AwareDateTime, nullable=False, default=datetime.now(timezone.utc), index=True
    )
    destination_npub = Column(String, nullable=True)
    payload_type = Column(String, nullable=False)
    body = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending", index=True)
    error_msg = Column(String, nullable=True)


class BitLink21Identity(Base):
    """Nostr identity (NPUB/NSEC key pair) for SSP addressing."""

    __tablename__ = "bitlink21_identity"

    id = Column(Integer, primary_key=True, autoincrement=True)
    npub = Column(String, nullable=False, unique=True, index=True)
    nsec = Column(String, nullable=False)
    created_at = Column(
        AwareDateTime, nullable=False, default=datetime.now(timezone.utc)
    )


class BitLink21Contact(Base):
    """Address book entry for known SSP peers."""

    __tablename__ = "bitlink21_contacts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    npub = Column(String, nullable=False, unique=True, index=True)
    nickname = Column(String, nullable=True)
    last_seen = Column(AwareDateTime, nullable=True)
    added_at = Column(
        AwareDateTime, nullable=False, default=datetime.now(timezone.utc)
    )


class BitLink21Config(Base):
    """Key-value configuration store for BitLink21 settings."""

    __tablename__ = "bitlink21_config"

    key = Column(String, primary_key=True, nullable=False)
    value = Column(String, nullable=True)
