"""Pydantic v2 models for BitLink21 REST API."""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class MessageCreate(BaseModel):
    """Create message for transmission."""
    destination_npub: Optional[str] = Field(None, description="Recipient NPUB; None for broadcast")
    payload_type: int = Field(0, description="0=text, 1=bitcoin_tx, 2=lightning, 3=binary")
    body: str = Field(..., description="Message content (plaintext, will be encrypted)")
    encrypted: bool = Field(True, description="Encrypt message with NIP-04 (default: True)")
    double_pass: bool = Field(True, description="Queue frame twice with 2s gap (default: True)")


class MessageOut(BaseModel):
    """Received message response."""
    id: int
    timestamp: datetime
    sender_npub: Optional[str] = Field(None, description="Sender NPUB, None if not addressed to us")
    payload_type: int
    body: str = Field(description="Decrypted plaintext")
    rssi_db: Optional[float]
    snr_db: Optional[float]
    is_encrypted: bool
    is_broadcast: bool


class OutboxItem(BaseModel):
    """Outgoing message in queue."""
    id: int
    timestamp: datetime
    destination_npub: Optional[str]
    payload_type: int
    body: str
    status: str = Field(description="'queued', 'sent', 'error'")
    error_msg: Optional[str]


class Identity(BaseModel):
    """Node identity (NPUB/NSEC pair)."""
    npub: str = Field(description="Public key (32-byte hex)")
    nsec: Optional[str] = Field(None, description="Private key (32-byte hex, only on set)")


class Contact(BaseModel):
    """Address book contact."""
    npub: str
    nickname: Optional[str] = None


class ConfigItem(BaseModel):
    """Configuration key-value pair."""
    key: str
    value: str


class StatusResponse(BaseModel):
    """Radio and system status."""
    rssi_db: float = Field(description="Received signal strength (dB)")
    snr_db: float = Field(description="Signal-to-noise ratio (dB)")
    evm_db: Optional[float] = Field(None, description="Error vector magnitude (dB)")
    beacon_lock_state: str = Field(description="'UNLOCKED', 'COARSE_LOCK', 'FINE_LOCK'")
    beacon_phase_error_deg: float
    rx_frame_count: int = Field(description="Successfully demodulated SSP frames")
    rx_error_count: int = Field(description="FEC-uncorrectable errors")
    tx_queue_depth: int = Field(description="Frames pending transmission")
    ptt_state: bool = Field(description="PTT button state")
    modem_scheme: str = Field(description="Current modulation (e.g., 'QPSK')")
    center_freq_mhz: float
    rx_gain_db: float
    tx_gain_db: float
    sample_rate_mhz: float


class QueueStatus(BaseModel):
    """TX queue status."""
    depth: int = Field(description="Number of queued frames")
    next_frame_size: Optional[int] = Field(None, description="Bytes in next frame")


class HealthCheck(BaseModel):
    """Health check response."""
    status: str = Field(description="'healthy' or error message")
    version: str
    uptime_seconds: int
