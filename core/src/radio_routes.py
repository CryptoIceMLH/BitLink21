"""
BitLink21 Radio Control Routes — /api/v1/* endpoints

Handles:
- Radio configuration (frequency, gains, modulation, bandwidth, beacon mode)
- Identity/crypto config (NPUB, NSEC, broadcast key, PlutoSDR IP)
- Message send/receive
- Radio status queries
- All commands forwarded to C++ radio via UDP port 40135
"""

import json
import logging
import asyncio
import time
import ipaddress
import struct
import random
import os
import socket
from pathlib import Path
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import aiosqlite

from .radio_command import RadioCommandSender
from .logging_config import get_logger
from .ssp_frame import SSPFrame, PayloadType
from .schemas import MessageCreate

logger = get_logger("radio_routes")
router = APIRouter(prefix="/api/v1")

# Paths
CONFIG_FILE = Path("/app/data/config.json")
MESSAGES_DB = Path("/app/data/bitlink21.db")

# Global radio command sender (UDP to port 40135)
radio_cmd = None
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


# ============================================================================
# BER Test Implementation
# ============================================================================

class BERTestGenerator:
    """PRBS (Pseudo-Random Binary Sequence) pattern generator for BER testing"""

    def __init__(self, polynomial=0x9, seed=0x12345):
        """Initialize PRBS with polynomial and seed

        Args:
            polynomial: PRBS polynomial (default 0x9 for LFSR taps [4,3])
            seed: Initial LFSR state (must be non-zero)
        """
        self.polynomial = polynomial
        self.seed = seed if seed != 0 else 1
        self.state = self.seed

    def next_bit(self) -> int:
        """Generate next PRBS bit (Galois LFSR)

        Returns:
            Single bit (0 or 1)
        """
        lsb = self.state & 1
        self.state >>= 1
        if lsb:
            self.state ^= self.polynomial << 15  # 16-bit LFSR
        return lsb

    def next_bytes(self, count: int) -> bytes:
        """Generate N bytes of PRBS data

        Args:
            count: Number of bytes to generate

        Returns:
            Bytes object with PRBS pattern
        """
        data = bytearray()
        for _ in range(count):
            byte = 0
            for i in range(8):
                byte |= self.next_bit() << i
            data.append(byte)
        return bytes(data)

    def reset(self):
        """Reset LFSR to initial seed"""
        self.state = self.seed


# Global BER test state
ber_test_state = {
    "running": False,
    "pattern_sent": 0,
    "errors_detected": 0,
    "ber": 0.0,
    "start_time": None,
    "duration_sec": 0.0,
    "pattern_bytes": None,
    "received_bytes": None
}


# ============================================================================
# Input Validators
# ============================================================================

def is_valid_npub(value: str) -> bool:
    """Validate NPUB: must be 64-char hex string"""
    if not value or not isinstance(value, str):
        return False
    if len(value) != 64:
        return False
    try:
        int(value, 16)
        return True
    except ValueError:
        return False


def is_valid_nsec(value: str) -> bool:
    """Validate NSEC: must be 64-char hex string"""
    if not value or not isinstance(value, str):
        return False
    if len(value) != 64:
        return False
    try:
        int(value, 16)
        return True
    except ValueError:
        return False


def is_valid_ip(value: str) -> bool:
    """Validate IP address: must be valid IPv4 or IPv6"""
    if not value or not isinstance(value, str):
        return False
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def is_valid_passphrase(value: str) -> bool:
    """Validate passphrase: must be non-empty string"""
    return bool(value and isinstance(value, str) and len(value.strip()) > 0)


async def init_radio_routes():
    """Initialize radio routes — called from main.py on startup"""
    global radio_cmd
    radio_cmd = RadioCommandSender(host="bitlink21-radio", port=40135)

    # Ensure data directory exists
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Initialize config file if missing
    if not CONFIG_FILE.exists():
        default_config = {
            "npub": "",
            "nsec": "",
            "broadcast_key": "",
            "pluto_ip": "192.168.1.200",
            "lnb_offset_hz": 9750000000,
            "rf_offset_hz": 0,
            "center_freq_mhz": 10489.55,
            "rx_gain_db": 60.0,
            "tx_gain_db": 10.0,
            "bandwidth_hz": 2700,  # Modem channel bandwidth (2.7 kHz default)
            "beacon_mode": "AUTO",
            "modem_scheme": 7,  # LIQUID_MODEM_QPSK
            "bitcoin_rpc_url": "",
            "bitcoin_rpc_user": "",
            "bitcoin_rpc_pass": "",
            "lnd_rest_url": "",
            "lnd_cert_path": "",
            "lnd_macaroon_path": "",
            "retention_days": 7,
            "saved_rx_mhz": 10489.55,
            "saved_tx_mhz": 10489.55,
            "rit_offset_hz": 0,
            "xit_offset_hz": 0,
            "tx_power_dbm": -10,
            "ptt_mode": "toggle",
            "rf_loopback": False,
            "audio_loopback": False,
            "test_tone_hz": 0,
            "waterfall_palette": "blue",
            "waterfall_speed": "normal",
            "xo_correction": 0,
        }
        CONFIG_FILE.write_text(json.dumps(default_config, indent=2))

    # Initialize messages DB (single unified database)
    MESSAGES_DB.parent.mkdir(parents=True, exist_ok=True)
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
        await db.execute("""
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                npub TEXT UNIQUE,
                nickname TEXT,
                last_seen INTEGER DEFAULT 0
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                destination_npub TEXT,
                payload_type INTEGER,
                body TEXT,
                status TEXT DEFAULT 'queued',
                created_at INTEGER
            )
        """)
        await db.commit()


# ============================================================================
# Models
# ============================================================================

class ConfigRequest(BaseModel):
    value: str


class FreqRequest(BaseModel):
    value: float


class GainRequest(BaseModel):
    value: float


class IntRequest(BaseModel):
    value: int


class BoolRequest(BaseModel):
    value: bool


class ModemRequest(BaseModel):
    value: int


class BandwidthRequest(BaseModel):
    value: int


class BeaconModeRequest(BaseModel):
    value: str  # AUTO, CW, BPSK, OFF


class ContactRequest(BaseModel):
    npub: str
    nickname: str = ""


class PTTRequest(BaseModel):
    state: bool


class MessageSendRequest(BaseModel):
    destination_npub: Optional[str] = None  # None = broadcast
    payload_type: int  # 0=text, 1=bitcoin_tx, 2=lightning, 3=binary
    body: str  # plaintext or hex encoded
    encrypted: bool = True  # Encrypt with NIP-04 (default True)
    double_pass: bool = True  # Queue twice with 2s gap (default True)


class ConfigValueRequest(BaseModel):
    value: Any  # Generic config value (float, bool, int, str)


class SdrConnectRequest(BaseModel):
    uri: str = "ip:192.168.1.200"  # PlutoSDR URI (IP or USB)
    lnb_offset_mhz: float = 9750.0  # LNB downconverter offset
    bandwidth_hz: float = 2700000.0  # RF bandwidth (Hz) — min 520830, max 30.72e6


# ============================================================================
# Helper functions
# ============================================================================

def load_config() -> Dict[str, Any]:
    """Load config from JSON file"""
    if CONFIG_FILE.exists():
        return json.loads(CONFIG_FILE.read_text())
    return {}


def save_config(config: Dict[str, Any]):
    """Save config to JSON file"""
    CONFIG_FILE.write_text(json.dumps(config, indent=2))


# ============================================================================
# Radio Control Endpoints
# ============================================================================

@router.post("/ptt")
async def set_ptt(request: PTTRequest, token: str = Depends(verify_token)):
    """Set PTT (push-to-talk) state"""
    try:
        await radio_cmd.send_command("ptt", request.state)
        logger.info(f"PTT set to {request.state}")
        return {"status": "ok", "ptt": request.state}
    except Exception as e:
        logger.error(f"PTT command failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config/center_freq_mhz")
async def get_center_freq():
    """Get center frequency (MHz)"""
    config = load_config()
    return {"center_freq_mhz": config.get("center_freq_mhz", 10489.55)}


@router.post("/config/center_freq_mhz")
async def set_center_freq(request: FreqRequest, token: str = Depends(verify_token)):
    """Set center frequency (MHz)"""
    # Note: LNB offset is applied on the C++ radio side, so we accept frequencies > 6 GHz (e.g., QO-100 at 10.4 GHz)
    # The C++ side will validate that (RF_freq - LNB_offset) is within PlutoSDR's 70-6000 MHz range
    if request.value < 50 or request.value > 12000:
        raise HTTPException(status_code=400, detail="Frequency out of range (50-12000 MHz)")
    try:
        await radio_cmd.send_command("set_freq", request.value)
        config = load_config()
        config["center_freq_mhz"] = request.value
        save_config(config)
        logger.info(f"Center frequency set to {request.value} MHz")
        return {"status": "ok", "center_freq_mhz": request.value}
    except Exception as e:
        logger.error(f"Frequency command failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config/rx_gain_db")
async def get_rx_gain():
    """Get RX gain (dB)"""
    config = load_config()
    return {"rx_gain_db": config.get("rx_gain_db", 60)}


@router.post("/config/rx_gain_db")
async def set_rx_gain(request: GainRequest, token: str = Depends(verify_token)):
    """Set RX gain (dB)"""
    if request.value < 0 or request.value > 73:
        raise HTTPException(status_code=400, detail="RX gain out of range (0-73 dB)")
    try:
        await radio_cmd.send_command("set_rx_gain", request.value)
        config = load_config()
        config["rx_gain_db"] = request.value
        save_config(config)
        logger.info(f"RX gain set to {request.value} dB")
        return {"status": "ok", "rx_gain_db": request.value}
    except Exception as e:
        logger.error(f"RX gain command failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config/tx_gain_db")
async def get_tx_gain():
    """Get TX gain (dB)"""
    config = load_config()
    return {"tx_gain_db": config.get("tx_gain_db", 10)}


@router.post("/config/tx_gain_db")
async def set_tx_gain(request: GainRequest, token: str = Depends(verify_token)):
    """Set TX gain (dB)"""
    if request.value < 0 or request.value > 89.75:
        raise HTTPException(status_code=400, detail="TX gain out of range (0-89.75 dB)")
    try:
        await radio_cmd.send_command("set_tx_gain", request.value)
        config = load_config()
        config["tx_gain_db"] = request.value
        save_config(config)
        logger.info(f"TX gain set to {request.value} dB")
        return {"status": "ok", "tx_gain_db": request.value}
    except Exception as e:
        logger.error(f"TX gain command failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config/modem_scheme")
async def get_modem_scheme():
    """Get modulation scheme"""
    config = load_config()
    return {"modem_scheme": config.get("modem_scheme", 7)}


@router.post("/config/modem_scheme")
async def set_modem_scheme(request: ModemRequest, token: str = Depends(verify_token)):
    """Set modulation scheme (liquid-dsp modem enum)"""
    if request.value < 0 or request.value > 51:
        raise HTTPException(status_code=400, detail="Modem scheme out of range (0-51)")
    try:
        await radio_cmd.send_command("set_modem", request.value)
        config = load_config()
        config["modem_scheme"] = request.value
        save_config(config)
        logger.info(f"Modem scheme set to {request.value}")
        return {"status": "ok", "modem_scheme": request.value}
    except Exception as e:
        logger.error(f"Modem command failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config/bandwidth_hz")
async def get_bandwidth():
    """Get modem channel bandwidth (Hz)"""
    config = load_config()
    return {"value": config.get("bandwidth_hz", 2700)}


@router.post("/config/bandwidth_hz")
async def set_bandwidth(request: BandwidthRequest, token: str = Depends(verify_token)):
    """Set modem channel bandwidth (Hz) — NOT PlutoSDR RF bandwidth"""
    if not (500 <= request.value <= 100000):
        raise HTTPException(status_code=400, detail="Modem bandwidth must be 500–100000 Hz")
    try:
        await radio_cmd.send_command("set_bandwidth", request.value)
        config = load_config()
        config["bandwidth_hz"] = request.value
        save_config(config)
        logger.info(f"Modem bandwidth set to {request.value} Hz")
        return {"status": "ok", "bandwidth_hz": request.value}
    except Exception as e:
        logger.error(f"Bandwidth command failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config/sdr_bandwidth_hz")
async def get_sdr_bandwidth():
    """Get SDR RF bandwidth (Hz) — PlutoSDR analog filter bandwidth"""
    config = load_config()
    return {"value": config.get("sdr_bandwidth_hz", 2000000)}


@router.post("/config/sdr_bandwidth_hz")
async def set_sdr_bandwidth(request: BandwidthRequest, token: str = Depends(verify_token)):
    """Set SDR RF bandwidth (Hz) — PlutoSDR analog filter (min 520830, max 30.72 MHz)"""
    if not (520830 <= request.value <= 30720000):
        raise HTTPException(status_code=400, detail="SDR RF bandwidth must be 520830–30720000 Hz")
    config = load_config()
    config["sdr_bandwidth_hz"] = request.value
    save_config(config)
    logger.info(f"SDR RF bandwidth set to {request.value} Hz")
    return {"status": "ok", "sdr_bandwidth_hz": request.value}


@router.get("/config/beacon_mode")
async def get_beacon_mode():
    """Get beacon lock mode"""
    config = load_config()
    return {"beacon_mode": config.get("beacon_mode", "AUTO")}


@router.post("/config/beacon_mode")
async def set_beacon_mode(request: BeaconModeRequest, token: str = Depends(verify_token)):
    """Set beacon lock mode (AUTO, CW, BPSK, OFF)"""
    valid_modes = ["AUTO", "CW", "BPSK", "OFF"]
    if request.value not in valid_modes:
        raise HTTPException(status_code=400, detail=f"Beacon mode must be one of {valid_modes}")
    try:
        await radio_cmd.send_command("set_beacon_mode", request.value)
        config = load_config()
        config["beacon_mode"] = request.value
        save_config(config)
        logger.info(f"Beacon mode set to {request.value}")
        return {"status": "ok", "beacon_mode": request.value}
    except Exception as e:
        logger.error(f"Beacon mode command failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Configuration Endpoints
# ============================================================================

@router.get("/config/npub")
async def get_npub():
    """Get stored NPUB"""
    config = load_config()
    return {"npub": config.get("npub", "")}


@router.post("/config/npub")
async def set_npub(request: ConfigRequest, token: str = Depends(verify_token)):
    """Set NPUB (public key)"""
    if not request.value:
        raise HTTPException(status_code=400, detail="NPUB cannot be empty")
    if not is_valid_npub(request.value):
        raise HTTPException(status_code=400, detail="NPUB must be a 64-character hexadecimal string")
    config = load_config()
    config["npub"] = request.value
    save_config(config)
    logger.info(f"NPUB updated")
    return {"status": "ok", "npub": request.value}


@router.post("/config/nsec")
async def set_nsec(request: ConfigRequest, token: str = Depends(verify_token)):
    """Set NSEC (secret key, write-only)"""
    if not request.value:
        raise HTTPException(status_code=400, detail="NSEC cannot be empty")
    if not is_valid_nsec(request.value):
        raise HTTPException(status_code=400, detail="NSEC must be a 64-character hexadecimal string")
    config = load_config()
    config["nsec"] = request.value
    save_config(config)
    logger.info(f"NSEC updated (write-only, not returned)")
    return {"status": "ok"}


@router.post("/config/nsec/encrypt")
async def encrypt_nsec_endpoint(request: Request, token: str = Depends(verify_token)):
    """Encrypt NSEC with user password for at-rest encryption

    Request:
        {
            "nsec": "64-char-hex-nsec",
            "password": "user-password"
        }

    Response:
        {
            "status": "ok",
            "encrypted_nsec": "base64(salt+IV+ciphertext+tag)"
        }
    """
    try:
        from .encryption import encrypt_nsec_at_rest

        data = await request.json()
        nsec = data.get("nsec", "")
        password = data.get("password", "")

        if not nsec:
            raise HTTPException(status_code=400, detail="NSEC cannot be empty")
        if not password:
            raise HTTPException(status_code=400, detail="Password cannot be empty")
        if not is_valid_nsec(nsec):
            raise HTTPException(status_code=400, detail="NSEC must be a 64-character hexadecimal string")

        encrypted = encrypt_nsec_at_rest(nsec, password)
        logger.info("NSEC encrypted with user password")

        return {
            "status": "ok",
            "encrypted_nsec": encrypted
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"NSEC encryption error: {e}")
        raise HTTPException(status_code=500, detail=f"NSEC encryption failed: {e}")


@router.post("/config/nsec/decrypt")
async def decrypt_nsec_endpoint(request: Request, token: str = Depends(verify_token)):
    """Decrypt NSEC with user password

    Request:
        {
            "encrypted_nsec": "base64(salt+IV+ciphertext+tag)",
            "password": "user-password"
        }

    Response:
        {
            "status": "ok",
            "nsec": "64-char-hex-nsec"
        }
    """
    try:
        from .encryption import decrypt_nsec_at_rest

        data = await request.json()
        encrypted_nsec = data.get("encrypted_nsec", "")
        password = data.get("password", "")

        if not encrypted_nsec:
            raise HTTPException(status_code=400, detail="Encrypted NSEC cannot be empty")
        if not password:
            raise HTTPException(status_code=400, detail="Password cannot be empty")

        nsec = decrypt_nsec_at_rest(encrypted_nsec, password)
        logger.info("NSEC decrypted successfully")

        return {
            "status": "ok",
            "nsec": nsec
        }

    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"NSEC decryption failed: {e}")
        raise HTTPException(status_code=400, detail=f"Decryption failed: {e}")
    except Exception as e:
        logger.error(f"NSEC decryption error: {e}")
        raise HTTPException(status_code=500, detail=f"NSEC decryption error: {e}")


@router.get("/config/broadcast_key")
async def get_broadcast_key():
    """Get broadcast channel key"""
    config = load_config()
    return {"broadcast_key": config.get("broadcast_key", "")}


@router.post("/config/broadcast_key")
async def set_broadcast_key(request: ConfigRequest, token: str = Depends(verify_token)):
    """Set broadcast channel key"""
    if not request.value:
        raise HTTPException(status_code=400, detail="Broadcast key cannot be empty")
    if not is_valid_passphrase(request.value):
        raise HTTPException(status_code=400, detail="Broadcast key must be a non-empty string")
    config = load_config()
    config["broadcast_key"] = request.value
    save_config(config)
    logger.info(f"Broadcast key updated")
    return {"status": "ok", "broadcast_key": request.value}


@router.get("/config/pluto_ip")
async def get_pluto_ip():
    """Get PlutoSDR IP address"""
    config = load_config()
    return {"pluto_ip": config.get("pluto_ip", "192.168.1.200")}


@router.post("/config/pluto_ip")
async def set_pluto_ip(request: ConfigRequest, token: str = Depends(verify_token)):
    """Set PlutoSDR IP address"""
    if not request.value:
        raise HTTPException(status_code=400, detail="PlutoSDR IP cannot be empty")
    # Strip ip: or usb: prefix before validation
    raw = request.value.removeprefix("ip:").removeprefix("usb:")
    if raw and not is_valid_ip(raw):
        raise HTTPException(status_code=400, detail="PlutoSDR IP must be a valid IPv4 or IPv6 address")
    config = load_config()
    config["pluto_ip"] = request.value
    save_config(config)
    logger.info(f"PlutoSDR IP set to {request.value}")
    return {"status": "ok", "pluto_ip": request.value}


@router.get("/config/lnb_offset")
async def get_lnb_offset():
    """Get LNB frequency offset (returned in MHz)"""
    config = load_config()
    lnb_hz = config.get("lnb_offset_hz", 9750000000)
    return {"lnb_offset": lnb_hz / 1e6}


@router.post("/config/lnb_offset")
async def set_lnb_offset(request: ConfigRequest, token: str = Depends(verify_token)):
    """Set LNB frequency offset (value in MHz, stored as Hz)"""
    config = load_config()
    try:
        offset_mhz = float(request.value)
        if offset_mhz < 0 or offset_mhz > 100000:
            raise HTTPException(status_code=400, detail="LNB offset out of range (0-100000 MHz)")
        offset_hz = int(offset_mhz * 1e6)
        config["lnb_offset_hz"] = offset_hz
        save_config(config)
        logger.info(f"LNB offset set to {offset_mhz} MHz ({offset_hz} Hz)")
        return {"status": "ok", "lnb_offset": offset_mhz}
    except ValueError:
        raise HTTPException(status_code=400, detail="LNB offset must be a number (MHz)")


@router.get("/config/rf_offset")
async def get_rf_offset():
    """Get RF calibration offset (Hz)"""
    config = load_config()
    return {"rf_offset": config.get("rf_offset_hz", 0)}


@router.post("/config/rf_offset")
async def set_rf_offset(request: ConfigRequest, token: str = Depends(verify_token)):
    """Set RF calibration offset (Hz)"""
    config = load_config()
    try:
        offset = int(request.value)
        config["rf_offset_hz"] = offset
        save_config(config)
        logger.info(f"RF offset set to {offset} Hz")
        return {"status": "ok", "rf_offset": offset}
    except ValueError:
        raise HTTPException(status_code=400, detail="RF offset must be an integer")


@router.get("/config/xo_correction")
async def get_xo_correction():
    """Get XO frequency correction (PPB)"""
    config = load_config()
    return {"xo_correction": config.get("xo_correction", 0)}


@router.post("/config/xo_correction")
async def set_xo_correction(request: ConfigRequest, token: str = Depends(verify_token)):
    """Set XO frequency correction (PPB) - sends to PlutoSDR xo_correction IIO attr"""
    config = load_config()
    try:
        correction = int(request.value)
        if correction < -100000 or correction > 100000:
            raise HTTPException(status_code=400, detail="XO correction out of range (-100000 to +100000 PPB)")
        config["xo_correction"] = correction
        save_config(config)
        await radio_cmd.send_command("set_xo_correction", correction)
        return {"status": "ok", "xo_correction": correction}
    except ValueError:
        raise HTTPException(status_code=400, detail="XO correction must be an integer")


@router.get("/config/contacts")
async def get_contacts():
    """Get address book contacts with last_seen timestamps"""
    try:
        async with aiosqlite.connect(str(MESSAGES_DB)) as db:
            async with db.execute("""
                SELECT npub, nickname, last_seen FROM contacts ORDER BY last_seen DESC
            """) as cursor:
                rows = await cursor.fetchall()

        contacts = [
            {
                "npub": row[0],
                "nickname": row[1] or "",
                "last_seen": row[2] or 0
            }
            for row in rows
        ]
        return {"contacts": contacts}
    except Exception as e:
        logger.error(f"Failed to retrieve contacts: {e}")
        return {"contacts": []}


@router.post("/config/contacts")
async def add_contact(request: ContactRequest, token: str = Depends(verify_token)):
    """Add a contact to address book"""
    if not request.npub:
        raise HTTPException(status_code=400, detail="NPUB required")
    try:
        async with aiosqlite.connect(str(MESSAGES_DB)) as db:
            await db.execute("""
                INSERT OR REPLACE INTO contacts (npub, nickname, last_seen)
                VALUES (?, ?, ?)
            """, (request.npub, request.nickname or "", int(time.time() * 1000)))
            await db.commit()
        return {"status": "ok", "npub": request.npub}
    except Exception as e:
        logger.error(f"Failed to add contact: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/config/contacts/{npub}")
async def remove_contact(npub: str):
    """Remove a contact from address book"""
    try:
        async with aiosqlite.connect(str(MESSAGES_DB)) as db:
            await db.execute("DELETE FROM contacts WHERE npub = ?", (npub,))
            await db.commit()
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Failed to remove contact: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config/beacon_tx_mode")
async def get_beacon_tx_mode():
    """Get beacon TX mode (what to broadcast about yourself)"""
    config = load_config()
    return {"beacon_tx_mode": config.get("beacon_tx_mode", "npub_only")}


@router.post("/config/beacon_tx_mode")
async def set_beacon_tx_mode(request: ConfigRequest, token: str = Depends(verify_token)):
    """Set beacon TX mode"""
    valid = ["npub_only", "npub_nickname", "off"]
    if request.value not in valid:
        raise HTTPException(status_code=400, detail=f"Must be one of {valid}")
    config = load_config()
    config["beacon_tx_mode"] = request.value
    save_config(config)
    return {"status": "ok", "beacon_tx_mode": request.value}


# ============================================================================
# B1 — New Config Endpoints (Calibration & Settings)
# ============================================================================

@router.get("/config/saved_qrg")
@router.post("/config/saved_qrg")
async def saved_qrg(request: Request = None, token: str = Depends(verify_token)):
    """Get/Set saved QRG (RX/TX frequency)"""
    if request and request.method == "POST":
        data = await request.json()
        config = load_config()
        config["saved_rx_mhz"] = data.get("rx_mhz", config.get("saved_rx_mhz", 10489.55))
        config["saved_tx_mhz"] = data.get("tx_mhz", config.get("saved_tx_mhz", 10489.55))
        save_config(config)
        return {"status": "ok", "rx_mhz": config["saved_rx_mhz"], "tx_mhz": config["saved_tx_mhz"]}
    else:
        config = load_config()
        return {"rx_mhz": config.get("saved_rx_mhz", 10489.55), "tx_mhz": config.get("saved_tx_mhz", 10489.55)}


@router.get("/config/rit_offset")
@router.post("/config/rit_offset")
async def rit_offset(request: Request = None, token: str = Depends(verify_token)):
    """Get/Set RIT offset (Hz)"""
    if request and request.method == "POST":
        data = await request.json()
        offset = int(data.get("value_hz", data.get("value", 0)))
        if offset < -10000 or offset > 10000:
            raise HTTPException(status_code=400, detail="RIT offset must be between -10000 and +10000 Hz")
        config = load_config()
        config["rit_offset_hz"] = offset
        save_config(config)
        await radio_cmd.send_command("set_rit", config["rit_offset_hz"])
        return {"status": "ok", "value_hz": config["rit_offset_hz"]}
    else:
        config = load_config()
        return {"value_hz": config.get("rit_offset_hz", 0)}


@router.get("/config/xit_offset")
@router.post("/config/xit_offset")
async def xit_offset(request: Request = None, token: str = Depends(verify_token)):
    """Get/Set XIT offset (Hz)"""
    if request and request.method == "POST":
        data = await request.json()
        offset = int(data.get("value_hz", data.get("value", 0)))
        if offset < -10000 or offset > 10000:
            raise HTTPException(status_code=400, detail="XIT offset must be between -10000 and +10000 Hz")
        config = load_config()
        config["xit_offset_hz"] = offset
        save_config(config)
        await radio_cmd.send_command("set_xit", config["xit_offset_hz"])
        return {"status": "ok", "value_hz": config["xit_offset_hz"]}
    else:
        config = load_config()
        return {"value_hz": config.get("xit_offset_hz", 0)}


@router.get("/config/tx_power_dbm")
@router.post("/config/tx_power_dbm")
async def tx_power_dbm(request: Request = None, token: str = Depends(verify_token)):
    """Get/Set TX power (dBm, -60 to 0)"""
    if request and request.method == "POST":
        data = await request.json()
        value = data.get("value", -10)
        if value < -60 or value > 0:
            raise HTTPException(status_code=400, detail="TX power must be -60 to 0 dBm")
        config = load_config()
        config["tx_power_dbm"] = value
        save_config(config)
        await radio_cmd.send_command("set_tx_power", value)
        return {"status": "ok", "value": value}
    else:
        config = load_config()
        return {"value": config.get("tx_power_dbm", -10)}


@router.get("/config/ptt_mode")
@router.post("/config/ptt_mode")
async def ptt_mode(request: Request = None, token: str = Depends(verify_token)):
    """Get/Set PTT mode (toggle or ptt)"""
    if request and request.method == "POST":
        data = await request.json()
        mode = data.get("mode", "toggle")
        if mode not in ["toggle", "ptt"]:
            raise HTTPException(status_code=400, detail="Mode must be 'toggle' or 'ptt'")
        config = load_config()
        config["ptt_mode"] = mode
        save_config(config)
        return {"status": "ok", "mode": mode}
    else:
        config = load_config()
        return {"mode": config.get("ptt_mode", "toggle")}


@router.get("/config/rf_loopback")
@router.post("/config/rf_loopback")
async def rf_loopback(request: Request = None, token: str = Depends(verify_token)):
    """Get/Set RF loopback test mode"""
    if request and request.method == "POST":
        data = await request.json()
        enabled = data.get("enabled", False)
        config = load_config()
        config["rf_loopback"] = enabled
        save_config(config)
        await radio_cmd.send_command("set_rf_loopback", enabled)
        return {"status": "ok", "enabled": enabled}
    else:
        config = load_config()
        return {"enabled": config.get("rf_loopback", False)}


@router.get("/config/audio_loopback")
@router.post("/config/audio_loopback")
async def audio_loopback(request: Request = None, token: str = Depends(verify_token)):
    """Get/Set audio loopback test mode"""
    if request and request.method == "POST":
        data = await request.json()
        enabled = data.get("enabled", False)
        config = load_config()
        config["audio_loopback"] = enabled
        save_config(config)
        await radio_cmd.send_command("set_audio_loopback", enabled)
        return {"status": "ok", "enabled": enabled}
    else:
        config = load_config()
        return {"enabled": config.get("audio_loopback", False)}


@router.get("/config/test_tone")
@router.post("/config/test_tone")
async def test_tone(request: Request = None, token: str = Depends(verify_token)):
    """Get/Set test tone frequency (0=off, 700/1500/2100 Hz)"""
    if request and request.method == "POST":
        data = await request.json()
        freq = data.get("freq_hz", 0)
        valid = [0, 700, 1500, 2100]
        if freq not in valid:
            raise HTTPException(status_code=400, detail=f"Test tone must be one of {valid}")
        config = load_config()
        config["test_tone_hz"] = freq
        save_config(config)
        await radio_cmd.send_command("set_test_tone", freq)
        return {"status": "ok", "freq_hz": freq}
    else:
        config = load_config()
        return {"freq_hz": config.get("test_tone_hz", 0)}


@router.get("/config/waterfall_palette")
@router.post("/config/waterfall_palette")
async def waterfall_palette(request: Request = None, token: str = Depends(verify_token)):
    """Get/Set waterfall color palette"""
    if request and request.method == "POST":
        data = await request.json()
        palette = data.get("palette", "blue")
        valid = ["blue", "red", "green", "grey"]
        if palette not in valid:
            raise HTTPException(status_code=400, detail=f"Palette must be one of {valid}")
        config = load_config()
        config["waterfall_palette"] = palette
        save_config(config)
        return {"status": "ok", "palette": palette}
    else:
        config = load_config()
        return {"palette": config.get("waterfall_palette", "blue")}


@router.get("/config/waterfall_speed")
@router.post("/config/waterfall_speed")
async def waterfall_speed(request: Request = None, token: str = Depends(verify_token)):
    """Get/Set waterfall update speed"""
    if request and request.method == "POST":
        data = await request.json()
        speed = data.get("speed", "normal")
        valid = ["fast", "normal", "slow"]
        if speed not in valid:
            raise HTTPException(status_code=400, detail=f"Speed must be one of {valid}")
        config = load_config()
        config["waterfall_speed"] = speed
        save_config(config)
        return {"status": "ok", "speed": speed}
    else:
        config = load_config()
        return {"speed": config.get("waterfall_speed", "normal")}


# ============================================================================
# Calibration Endpoints
# ============================================================================

@router.post("/calibration/tcxo")
async def calibration_tcxo(request: Request, token: str = Depends(verify_token)):
    """Set TCXO correction (XO correction in Hz)"""
    data = await request.json()
    correction = data.get("xo_correction_hz", 0)
    config = load_config()
    config["xo_correction"] = correction
    save_config(config)
    await radio_cmd.send_command("set_xo_correction", correction)
    logger.info(f"TCXO correction set to {correction} Hz")
    return {"status": "ok", "xo_correction_hz": correction}


@router.post("/calibration/lnb")
async def calibration_lnb(request: Request, token: str = Depends(verify_token)):
    """Apply LNB calibration correction.

    Takes the measured error (Hz) from the calibration panel and adjusts
    the stored LNB offset accordingly. Then sends the corrected total
    LNB offset to the C++ radio to retune.
    """
    data = await request.json()
    correction_hz = data.get("lnb_offset_hz", 0)
    config = load_config()
    # Get current LNB offset (Hz), default 9750 MHz
    current_lnb_hz = config.get("lnb_offset_hz", 9750000000)
    # Apply correction: if beacon appears high, LNB offset is too low → add correction
    new_lnb_hz = current_lnb_hz + correction_hz
    config["lnb_offset_hz"] = new_lnb_hz
    config["lnb_calibration_hz"] = correction_hz  # Store last calibration delta
    save_config(config)
    # Send corrected total LNB offset in MHz to C++ radio
    new_lnb_mhz = new_lnb_hz / 1e6
    await radio_cmd.send_command("set_lnb_offset", new_lnb_mhz)
    logger.info(f"LNB calibration: correction={correction_hz} Hz, new LNB offset={new_lnb_mhz} MHz")
    return {"status": "ok", "lnb_offset_hz": correction_hz, "total_lnb_offset_mhz": new_lnb_mhz}


# ============================================================================
# Calibration Alias Routes (UI compatibility)
# ============================================================================

@router.post("/radio/tcxo_calibrate")
async def tcxo_calibrate_alias(request: Request, token: str = Depends(verify_token)):
    """Alias for /calibration/tcxo — Set TCXO correction (XO correction in Hz)"""
    return await calibration_tcxo(request)


@router.post("/radio/lnb_calibrate")
async def lnb_calibrate_alias(request: Request, token: str = Depends(verify_token)):
    """Alias for /calibration/lnb — Set LNB offset correction (Hz)"""
    return await calibration_lnb(request)


# ============================================================================
# Radio Test Endpoints
# ============================================================================

@router.post("/radio/ber_test")
async def ber_test(request: Request, token: str = Depends(verify_token)):
    """BER (Bit Error Rate) test endpoint

    Request:
        {
            "action": "start" | "stop" | "status" | "get_result",
            "pattern_size_bytes": 12800 (optional, default 12800)
        }

    Response:
        {
            "status": "ok",
            "action": "start" | "stop" | "status" | "get_result",
            "test_running": bool,
            "pattern_sent": int (bits),
            "errors_detected": int,
            "ber": float (0.0-1.0),
            "duration_sec": float
        }
    """
    global ber_test_state

    try:
        data = await request.json()
        action = data.get("action", "stop")
        pattern_size = data.get("pattern_size_bytes", 12800)

        if action not in ["start", "stop", "status", "get_result"]:
            raise HTTPException(status_code=400, detail="Action must be 'start', 'stop', 'status', or 'get_result'")

        if action == "start":
            # Generate PRBS pattern
            generator = BERTestGenerator(polynomial=0x9, seed=0x12345)
            pattern_bytes = generator.next_bytes(pattern_size)

            ber_test_state["running"] = True
            ber_test_state["pattern_sent"] = len(pattern_bytes) * 8  # bits
            ber_test_state["errors_detected"] = 0
            ber_test_state["ber"] = 0.0
            ber_test_state["start_time"] = time.time()
            ber_test_state["duration_sec"] = 0.0
            ber_test_state["pattern_bytes"] = pattern_bytes.hex()
            ber_test_state["received_bytes"] = None

            logger.info(f"BER test started: {len(pattern_bytes)} bytes ({ber_test_state['pattern_sent']} bits)")
            await radio_cmd.send_command("ber_test_start", pattern_bytes.hex())

            return {
                "status": "ok",
                "action": "start",
                "test_running": True,
                "pattern_sent": ber_test_state["pattern_sent"],
                "errors_detected": 0,
                "ber": 0.0,
                "duration_sec": 0.0,
                "message": f"BER test started with {len(pattern_bytes)} bytes"
            }

        elif action == "stop":
            if not ber_test_state["running"]:
                return {
                    "status": "ok",
                    "action": "stop",
                    "test_running": False,
                    "message": "BER test was not running"
                }

            ber_test_state["running"] = False
            ber_test_state["duration_sec"] = time.time() - ber_test_state["start_time"]

            logger.info(f"BER test stopped after {ber_test_state['duration_sec']:.2f} sec")
            await radio_cmd.send_command("ber_test_stop", None)

            return {
                "status": "ok",
                "action": "stop",
                "test_running": False,
                "pattern_sent": ber_test_state["pattern_sent"],
                "errors_detected": ber_test_state["errors_detected"],
                "ber": ber_test_state["ber"],
                "duration_sec": ber_test_state["duration_sec"]
            }

        elif action == "status":
            # Return current test status
            if ber_test_state["running"]:
                duration = time.time() - ber_test_state["start_time"]
            else:
                duration = ber_test_state["duration_sec"]

            return {
                "status": "ok",
                "action": "status",
                "test_running": ber_test_state["running"],
                "pattern_sent": ber_test_state["pattern_sent"],
                "errors_detected": ber_test_state["errors_detected"],
                "ber": ber_test_state["ber"],
                "duration_sec": duration
            }

        elif action == "get_result":
            # Calculate BER if we have received bytes
            if ber_test_state["pattern_bytes"] and ber_test_state["received_bytes"]:
                pattern_hex = ber_test_state["pattern_bytes"]
                received_hex = ber_test_state["received_bytes"]

                # Convert hex to bytes
                try:
                    pattern_data = bytes.fromhex(pattern_hex)
                    received_data = bytes.fromhex(received_hex)
                except ValueError:
                    logger.error("Invalid hex data in BER test state")
                    raise HTTPException(status_code=400, detail="Invalid BER test state")

                # Count bit errors
                errors = 0
                total_bits = min(len(pattern_data), len(received_data)) * 8

                for i in range(min(len(pattern_data), len(received_data))):
                    xor = pattern_data[i] ^ received_data[i]
                    # Count set bits using Brian Kernighan's algorithm
                    while xor:
                        xor &= xor - 1
                        errors += 1

                ber = errors / total_bits if total_bits > 0 else 0.0
                ber_test_state["errors_detected"] = errors
                ber_test_state["ber"] = ber

            return {
                "status": "ok",
                "action": "get_result",
                "test_running": ber_test_state["running"],
                "pattern_sent": ber_test_state["pattern_sent"],
                "errors_detected": ber_test_state["errors_detected"],
                "ber": ber_test_state["ber"],
                "duration_sec": ber_test_state["duration_sec"]
            }

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON request")
    except Exception as e:
        logger.error(f"BER test error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/radio/shutdown")
async def radio_shutdown(token: str = Depends(verify_token)):
    """Shutdown radio (system shutdown)"""
    import subprocess
    logger.warning("System shutdown requested")
    try:
        # Schedule shutdown in 5 seconds to allow response
        subprocess.Popen(["shutdown", "-h", "+1"], start_new_session=True)
        return {"status": "ok", "message": "System shutdown initiated"}
    except Exception as e:
        logger.error(f"Shutdown command failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/radio/reset")
async def radio_reset(token: str = Depends(verify_token)):
    """Reset modem state"""
    await radio_cmd.send_command("reset_modem", True)
    logger.info("Modem reset command sent")
    return {"status": "ok", "message": "Modem reset"}


@router.post("/config/reset_radio")
async def reset_radio_config(token: str = Depends(verify_token)):
    """Reset radio config to defaults (preserves identity, Bitcoin, Lightning settings)"""
    config = load_config()
    # Radio defaults — reset only radio-related keys
    radio_defaults = {
        "pluto_ip": "192.168.1.200",
        "lnb_offset_hz": 9750000000,
        "rf_offset_hz": 0,
        "center_freq_mhz": 10489.55,
        "rx_gain_db": 60.0,
        "tx_gain_db": 10.0,
        "bandwidth_hz": 2700,
        "beacon_mode": "AUTO",
        "modem_scheme": 7,
        "xo_correction": 0,
        "saved_rx_mhz": 10489.55,
        "saved_tx_mhz": 10489.55,
        "rit_offset_hz": 0,
        "xit_offset_hz": 0,
        "tx_power_dbm": -10,
        "ptt_mode": "toggle",
        "rf_loopback": False,
        "audio_loopback": False,
        "test_tone_hz": 0,
    }
    config.update(radio_defaults)
    save_config(config)
    logger.info("Radio config reset to defaults")
    return {"status": "ok", "message": "Radio config reset to defaults"}


# ============================================================================
# SDR Connection Management (Manual Connect Flow)
# ============================================================================

# Storage for last successful SDR connection info
_sdr_info_cache = {"connected": False}

# Persistent UDP response socket bound once at startup (avoid port 40136 collision on rapid calls)
_sdr_response_sock = None

def _get_sdr_response_sock():
    """Get or create the persistent UDP response socket on port 40136"""
    global _sdr_response_sock
    if _sdr_response_sock is None:
        _sdr_response_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        _sdr_response_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        _sdr_response_sock.settimeout(12.0)  # Socket-level timeout prevents zombie threads on asyncio.wait_for cancellation
        _sdr_response_sock.bind(("0.0.0.0", 40136))
        logger.info("SDR response socket created and bound to 0.0.0.0:40136")
    return _sdr_response_sock


async def _listen_for_sdr_response(sock, timeout_sec=8):
    """Listen on provided UDP socket for SDR connect/disconnect response from C++ radio

    Uses run_in_executor to avoid blocking the event loop during recvfrom().
    Expected response format: {"connected":true/false,"hw_model":"...","fw_version":"...","serial":"..."}
    """
    loop = asyncio.get_event_loop()
    try:
        data, addr = await asyncio.wait_for(
            loop.run_in_executor(None, lambda: sock.recvfrom(1024)),
            timeout=timeout_sec
        )
        response_str = data.decode("utf-8")
        logger.info(f"SDR response received: {response_str}")
        response_json = json.loads(response_str)
        return response_json
    except asyncio.TimeoutError:
        logger.error("Timeout waiting for SDR response (C++ radio may not be responding)")
        return {"connected": False, "error": "Response timeout"}
    except Exception as e:
        logger.error(f"Failed to listen for SDR response: {e}")
        return {"connected": False, "error": str(e)}


@router.post("/radio/connect")
async def sdr_connect(request: SdrConnectRequest, token: str = Depends(verify_token)):
    """Connect to PlutoSDR (or other SDR hardware)

    Sends sdr_connect command to C++ radio via UDP 40135, waits for response on UDP 40136.
    On success, caches SDR info for /radio/probe endpoint.
    """
    global _sdr_info_cache

    logger.info(f"SDR connect request: uri={request.uri}, lnb={request.lnb_offset_mhz} MHz, bw={request.bandwidth_hz} Hz")

    try:
        # Use persistent response socket (bound once at module load)
        sock = _get_sdr_response_sock()

        # Build command dict for C++ radio (radio_command.py will JSON-serialize once)
        cmd_value = {
            "uri": request.uri,
            "lnb_offset_mhz": request.lnb_offset_mhz,
            "bandwidth_hz": request.bandwidth_hz
        }

        # Send sdr_connect command to C++ radio (UDP 40135)
        await radio_cmd.send_command("sdr_connect", cmd_value)

        # Wait for response on UDP 40136 (15s to allow PlutoSDR init + DNS resolution)
        response = await _listen_for_sdr_response(sock, timeout_sec=15)

        # Cache the response for /radio/probe
        if response.get("connected"):
            _sdr_info_cache = response
            logger.info(f"SDR connected: {response.get('hw_model')} FW {response.get('fw_version')}")
        else:
            _sdr_info_cache = {"connected": False}
            logger.error(f"SDR connection failed: {response.get('error', 'unknown error')}")

        return response

    except Exception as e:
        logger.error(f"SDR connect exception: {e}")
        _sdr_info_cache = {"connected": False}
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/radio/disconnect")
async def sdr_disconnect(token: str = Depends(verify_token)):
    """Disconnect from SDR hardware

    Sends sdr_disconnect command to C++ radio via UDP 40135.
    """
    global _sdr_info_cache

    logger.info("SDR disconnect request")

    try:
        # Use persistent response socket
        sock = _get_sdr_response_sock()

        # Send sdr_disconnect command to C++ radio (UDP 40135)
        await radio_cmd.send_command("sdr_disconnect", "")

        # Wait briefly for acknowledgment
        response = await _listen_for_sdr_response(sock, timeout_sec=2)

        # Clear cached SDR info and return actual response from C++
        _sdr_info_cache = {"connected": False}
        return response

    except Exception as e:
        logger.error(f"SDR disconnect exception: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/radio/probe")
async def sdr_probe():
    """Get last known SDR hardware info

    Returns cached device info from last successful connect attempt.
    Returns {"connected":false} if SDR is not currently connected.
    """
    return _sdr_info_cache


# ============================================================================
# Bitcoin & Lightning Configuration
# ============================================================================

@router.post("/bitcoin/config")
async def set_bitcoin_config(request: Request, token: str = Depends(verify_token)):
    """Configure Bitcoin Core RPC endpoint for TX relay"""
    data = await request.json()
    config = load_config()
    config["bitcoin_rpc_url"] = data.get("rpc_url", "")
    config["bitcoin_rpc_user"] = data.get("rpc_user", "")
    # Only update password if provided (non-empty), don't wipe saved password with empty string
    if data.get("rpc_pass"):
        config["bitcoin_rpc_pass"] = data["rpc_pass"]
    save_config(config)
    return {"status": "ok", "bitcoin_configured": bool(data.get("rpc_url"))}


@router.get("/bitcoin/config")
async def get_bitcoin_config():
    """Get Bitcoin RPC configuration status"""
    config = load_config()
    return {
        "configured": bool(config.get("bitcoin_rpc_url")),
        "rpc_url": config.get("bitcoin_rpc_url", ""),
        "rpc_user": config.get("bitcoin_rpc_user", ""),
    }


@router.get("/bitcoin/status")
async def get_bitcoin_status():
    """Get Bitcoin connectivity status"""
    config = load_config()
    if not config.get("bitcoin_rpc_url"):
        return {"connected": False, "error": "Not configured"}

    try:
        import requests
        from requests.auth import HTTPBasicAuth

        response = requests.post(
            config["bitcoin_rpc_url"],
            json={"jsonrpc": "2.0", "id": "bitlink21", "method": "getblockchaininfo", "params": []},
            auth=HTTPBasicAuth(config["bitcoin_rpc_user"], config["bitcoin_rpc_pass"]),
            timeout=5
        )
        if response.status_code == 200:
            result = response.json().get("result", {})
            return {
                "connected": True,
                "block_height": result.get("blocks", 0),
                "sync_pct": result.get("verificationprogress", 0) * 100
            }
        else:
            return {"connected": False, "error": f"RPC error: {response.status_code}"}
    except Exception as e:
        return {"connected": False, "error": str(e)}


@router.post("/lightning/config")
async def set_lightning_config(request: Request, token: str = Depends(verify_token)):
    """Configure LND REST endpoint for invoice relay"""
    data = await request.json()
    config = load_config()
    config["lnd_rest_url"] = data.get("lnd_rest_url", "")
    # Store macaroon hex string directly (not file path)
    if data.get("lnd_macaroon"):
        config["lnd_macaroon"] = data.get("lnd_macaroon")
    save_config(config)
    return {"status": "ok", "lightning_configured": bool(data.get("lnd_rest_url"))}


@router.get("/lightning/config")
async def get_lightning_config():
    """Get Lightning RPC configuration status"""
    config = load_config()
    return {
        "configured": bool(config.get("lnd_rest_url")),
        "lnd_rest_url": config.get("lnd_rest_url", ""),
    }


@router.get("/lightning/status")
async def get_lightning_status():
    """Get Lightning connectivity status"""
    config = load_config()
    if not config.get("lnd_rest_url"):
        return {"connected": False, "error": "Not configured"}

    try:
        import requests
        import base64

        headers = {}
        # Add macaroon auth header if available
        macaroon = config.get("lnd_macaroon")
        if macaroon:
            # Convert hex to base64 if needed (user pastes hex from Umbrel)
            try:
                # If it's hex (64 chars of 0-9a-f), convert to base64
                if len(macaroon) == 1030 and all(c in '0123456789abcdefABCDEF' for c in macaroon):
                    macaroon_bytes = bytes.fromhex(macaroon)
                    macaroon = base64.b64encode(macaroon_bytes).decode()
            except:
                # If conversion fails, use as-is (might already be base64)
                pass
            headers["Grpc-Metadata-macaroon"] = macaroon

        # Get node info (channels + connectivity)
        response_info = requests.get(
            f"{config['lnd_rest_url']}/v1/getinfo",
            headers=headers,
            timeout=5,
            verify=False
        )

        if response_info.status_code != 200:
            return {"connected": False, "error": f"API error: {response_info.status_code}"}

        result_info = response_info.json()
        # Note: wallet balance endpoint may not be available in all LND setups
        # Just report node info for now
        return {
            "connected": True,
            "balance_sats": 0,  # Wallet balance requires additional endpoint access
            "channels": result_info.get("num_active_channels", 0)
        }
    except Exception as e:
        return {"connected": False, "error": str(e)}


# ============================================================================
# Message Retention
# ============================================================================

@router.get("/config/retention_days")
async def get_retention_days():
    """Get message retention policy (days)"""
    config = load_config()
    return {"days": config.get("retention_days", 7)}


@router.post("/config/retention_days")
async def set_retention_days(request: Request, token: str = Depends(verify_token)):
    """Set message retention policy (days)"""
    data = await request.json()
    days = data.get("days", 7)
    if days < 1 or days > 365:
        raise HTTPException(status_code=400, detail="Retention days must be 1-365")

    config = load_config()
    config["retention_days"] = days
    save_config(config)

    # Trigger cleanup (background task in main.py)
    logger.info(f"Message retention set to {days} days")
    return {"status": "ok", "days": days}


# ============================================================================
# Radio Status
# ============================================================================

@router.get("/radio/status")
async def get_radio_status():
    """Get current radio status"""
    config = load_config()
    return {
        "center_freq_mhz": config.get("center_freq_mhz", 10489.55),
        "rx_gain_db": config.get("rx_gain_db", 60.0),
        "tx_gain_db": config.get("tx_gain_db", 10.0),
        "modem_scheme": config.get("modem_scheme", 7),
        "bandwidth_hz": config.get("bandwidth_hz", 2700),  # Modem channel BW (Hz)
        "sdr_bandwidth_hz": config.get("sdr_bandwidth_hz", 2000000),  # SDR RF BW (Hz)
        "beacon_mode": config.get("beacon_mode", "AUTO"),
        "pluto_ip": config.get("pluto_ip", "192.168.1.200"),
    }


# ============================================================================
# Message Endpoints
# ============================================================================

@router.get("/messages")
async def get_messages(limit: int = 100):
    """Get received messages"""
    try:
        async with aiosqlite.connect(str(MESSAGES_DB)) as db:
            async with db.execute(
                "SELECT timestamp_ms, direction, sender_npub, payload_type, body_base64, rssi_db, snr_db "
                "FROM messages ORDER BY timestamp_ms DESC LIMIT ?",
                (limit,)
            ) as cursor:
                rows = await cursor.fetchall()

        messages = [
            {
                "timestamp_ms": row[0],
                "direction": row[1],
                "sender_npub": row[2],
                "payload_type": row[3],
                "body": row[4],
                "rssi_db": row[5],
                "snr_db": row[6],
            }
            for row in rows
        ]
        return {"messages": messages, "count": len(messages)}
    except Exception as e:
        logger.error(f"Failed to query messages: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/queue")
async def get_queue(limit: int = 100):
    """Get pending outbox messages (TX queue)"""
    try:
        async with aiosqlite.connect(str(MESSAGES_DB)) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT id, destination_npub, payload_type, body, status, created_at "
                "FROM outbox WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?",
                (limit,)
            ) as cursor:
                rows = await cursor.fetchall()

        messages = [dict(row) for row in rows]
        return {"messages": messages, "depth": len(messages)}
    except Exception as e:
        logger.error(f"Failed to query outbox queue: {e}")
        return {"messages": [], "depth": 0, "error": str(e)}


@router.post("/send")
async def send_message(request: MessageSendRequest, token: str = Depends(verify_token)):
    """Send a message via SSP with optional encryption"""
    if not request.body:
        raise HTTPException(status_code=400, detail="Message body cannot be empty")

    # Validate payload based on type
    if request.payload_type == 1:  # bitcoin_tx
        try:
            bytes.fromhex(request.body)
        except ValueError:
            raise HTTPException(status_code=400, detail="Bitcoin TX must be valid hex")
    elif request.payload_type == 2:  # lightning
        if not request.body.lower().startswith(('lnbc', 'lntb', 'lnbcrt')):
            raise HTTPException(status_code=400, detail="Lightning body must be BOLT11 invoice")

    try:
        # Load config for nsec/broadcast_key
        config = load_config()
        nsec = config.get("nsec", "")
        broadcast_key = config.get("broadcast_key", "")
        npub = config.get("npub", "")

        # Determine encryption and broadcast flags
        payload_to_send = request.body
        is_broadcast = request.destination_npub is None

        if request.encrypted:
            from .encryption import encrypt_nip04, encrypt_broadcast

            if is_broadcast:
                # Broadcast mode: use shared key
                if not broadcast_key:
                    raise HTTPException(status_code=400, detail="Broadcast key not configured")
                payload_to_send = encrypt_broadcast(request.body, broadcast_key)
            else:
                # P2P mode: NIP-04 encrypt (plaintext, nsec, recipient_npub)
                if not nsec:
                    raise HTTPException(status_code=400, detail="NSEC not configured")
                payload_to_send = encrypt_nip04(request.body, nsec, request.destination_npub)

        # Create SSP frame
        ssp_frame = SSPFrame()
        ssp_frame.payload_type = request.payload_type
        ssp_frame.payload = payload_to_send.encode() if isinstance(payload_to_send, str) else payload_to_send
        ssp_frame.flags = 0x01 if request.encrypted else 0x00  # FLAG_ENCRYPTED bit 0
        if is_broadcast:
            ssp_frame.flags |= 0x02  # FLAG_BROADCAST bit 1

        # Assign message ID and payload length
        ssp_frame.msg_id = int(time.time() * 1000) & 0xFFFF
        ssp_frame.payload_len = len(ssp_frame.payload)

        # Send via UDP to C++ radio on port 40133 (TX)
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

        async def send_frame():
            loop = asyncio.get_event_loop()
            # Non-blocking UDP send via executor
            await loop.run_in_executor(
                None,
                lambda: sock.sendto(ssp_frame.to_bytes(), ("bitlink21-radio", 40133))
            )

            # Double-pass: queue twice with 2s delay if requested
            if request.double_pass:
                await asyncio.sleep(2.0)
                await loop.run_in_executor(
                    None,
                    lambda: sock.sendto(ssp_frame.to_bytes(), ("bitlink21-radio", 40133))
                )

        try:
            await send_frame()
        finally:
            sock.close()

        # Store in messages database (plaintext body)
        body_to_store = request.body  # Always store plaintext
        async with aiosqlite.connect(str(MESSAGES_DB)) as db:
            await db.execute("""
                INSERT INTO messages
                (timestamp_ms, direction, sender_npub, recipient_npub, payload_type, body_base64, msg_id, seq_num, total_frags, rssi_db, snr_db)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                int(time.time() * 1000),
                'TX',
                npub or 'unknown',
                request.destination_npub or '',
                request.payload_type,
                body_to_store,
                ssp_frame.msg_id,
                0,
                1,
                None,
                None
            ))
            await db.commit()

        logger.info(
            f"Message sent via TX",
            extra={
                "payload_type": request.payload_type,
                "destination": request.destination_npub or "BROADCAST",
                "body_len": len(request.body),
                "encrypted": request.encrypted,
                "double_pass": request.double_pass,
            }
        )
        return {"status": "ok", "queued": True}
    except Exception as e:
        logger.error(f"Failed to send message: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config/tx_freq_mhz")
async def get_tx_freq_mhz():
    """Get saved TX frequency"""
    config = load_config()
    value = config.get("saved_tx_mhz", 2400.0)
    return {"value": value}


@router.post("/config/tx_freq_mhz")
async def set_tx_freq_mhz(req: ConfigValueRequest, token: str = Depends(verify_token)):
    """Set saved TX frequency"""
    try:
        await radio_cmd.send_command("set_tx_freq", float(req.value))
        config = load_config()
        config["saved_tx_mhz"] = float(req.value)
        save_config(config)
        logger.info(f"TX frequency set to {req.value} MHz")
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config/tx_atten_db")
async def get_tx_atten_db():
    """Get TX attenuation (alias for tx_gain_db)"""
    config = load_config()
    value = config.get("tx_gain_db", 10.0)
    return {"value": value}


@router.post("/config/rit_enabled")
async def set_rit_enabled(req: ConfigValueRequest, token: str = Depends(verify_token)):
    """Enable/disable RIT (Receiver Incremental Tuning)"""
    config = load_config()
    config["rit_enabled"] = bool(req.value)
    save_config(config)
    return {"status": "ok"}


@router.post("/config/xit_enabled")
async def set_xit_enabled(req: ConfigValueRequest, token: str = Depends(verify_token)):
    """Enable/disable XIT (Transmitter Incremental Tuning)"""
    config = load_config()
    config["xit_enabled"] = bool(req.value)
    save_config(config)
    return {"status": "ok"}


# ============================================================================
# Identity / QR Code
# ============================================================================

@router.get("/identity/npub_qr")
async def get_npub_qr():
    """Get QR code for current NPUB as base64 PNG"""
    try:
        import qrcode
        import base64
        import io

        config = load_config()
        npub = config.get("npub", "")

        if not npub:
            raise HTTPException(status_code=400, detail="NPUB not configured")

        # Generate QR code
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=2,
        )
        qr.add_data(npub)
        qr.make(fit=True)

        # Render as PNG
        img = qr.make_image(fill_color="black", back_color="white")

        # Convert to base64
        img_buffer = io.BytesIO()
        img.save(img_buffer, format="PNG")
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode("utf-8")

        return {
            "status": "ok",
            "npub": npub,
            "qr_code_base64": img_base64,
            "qr_code_type": "image/png"
        }
    except Exception as e:
        logger.error(f"QR code generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
