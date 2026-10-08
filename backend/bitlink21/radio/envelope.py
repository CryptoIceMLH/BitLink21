"""BitLink21 message envelope.

A BitLink21 message travels as an ordinary HSModem binary file, so any
HSModem / oscardata / gr-satellites station can receive it; BitLink21
stations additionally recognise the envelope and route the payload.

File name:  BL21-<msg id hex>.<ext>   (ext: txt, btc, ln, bin)
Content:
    magic   "BL21"                     4 B
    version 1                          1 B
    type    0 text | 1 bitcoin tx | 2 lightning invoice | 3 binary   1 B
    flags   bit0 = encrypted           1 B
    msg id                             8 B
    unix time (big endian)             4 B
    callsign length + ASCII callsign   1 + n B
    body (clear payload, or salt16 | nonce12 | AES-256-GCM ciphertext+tag)

Encryption is optional and uses a shared passphrase (PBKDF2-HMAC-SHA256).
Clear text is the default: on amateur bands encrypted traffic is generally
not permitted, so the operator has to opt in deliberately.
"""

import os
import struct
import time
from dataclasses import dataclass
from typing import Optional

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

MAGIC = b"BL21"
VERSION = 1

TYPE_TEXT = 0
TYPE_BITCOIN_TX = 1
TYPE_LIGHTNING_INVOICE = 2
TYPE_BINARY = 3

TYPE_NAMES = {
    TYPE_TEXT: "text",
    TYPE_BITCOIN_TX: "bitcoin_tx",
    TYPE_LIGHTNING_INVOICE: "lightning_invoice",
    TYPE_BINARY: "binary",
}
TYPE_EXT = {TYPE_TEXT: "txt", TYPE_BITCOIN_TX: "btc", TYPE_LIGHTNING_INVOICE: "ln", TYPE_BINARY: "bin"}

FLAG_ENCRYPTED = 0x01
PBKDF2_ITERATIONS = 200_000


class EnvelopeError(ValueError):
    pass


@dataclass
class Message:
    payload_type: int
    body: bytes  # clear payload (decrypted if needed)
    msg_id: bytes
    timestamp: int
    callsign: str
    encrypted: bool = False

    @property
    def msg_id_hex(self) -> str:
        return self.msg_id.hex()

    @property
    def type_name(self) -> str:
        return TYPE_NAMES.get(self.payload_type, "unknown")


def _derive_key(passphrase: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=PBKDF2_ITERATIONS)
    return kdf.derive(passphrase.encode("utf-8"))


def encode(
    payload_type: int,
    body: bytes,
    callsign: str = "",
    passphrase: Optional[str] = None,
    msg_id: Optional[bytes] = None,
    timestamp: Optional[int] = None,
) -> tuple:
    """Build (filename, file content) for a message."""
    if payload_type not in TYPE_NAMES:
        raise EnvelopeError(f"unknown payload type {payload_type}")
    msg_id = msg_id or os.urandom(8)
    timestamp = int(time.time()) if timestamp is None else int(timestamp)
    call = callsign.strip().upper().encode("ascii", "replace")[:20]
    flags = 0
    content = bytes(body)
    header = MAGIC + bytes([VERSION, payload_type])
    meta = msg_id + struct.pack(">I", timestamp) + bytes([len(call)]) + call
    if passphrase:
        flags |= FLAG_ENCRYPTED
        salt, nonce = os.urandom(16), os.urandom(12)
        aad = header + bytes([flags]) + meta
        content = salt + nonce + AESGCM(_derive_key(passphrase, salt)).encrypt(nonce, content, aad)
    data = header + bytes([flags]) + meta + content
    name = f"BL21-{msg_id.hex()}.{TYPE_EXT[payload_type]}"
    return name, data


def is_envelope(data: bytes) -> bool:
    return len(data) >= 20 and data[:4] == MAGIC


def decode(data: bytes, passphrase: Optional[str] = None) -> Message:
    """Parse an envelope. Raises EnvelopeError if it cannot be read.

    Encrypted messages without (or with a wrong) passphrase raise
    EnvelopeError with .encrypted = True so the caller can store them as
    locked.
    """
    if not is_envelope(data):
        raise EnvelopeError("not a BitLink21 envelope")
    version, payload_type, flags = data[4], data[5], data[6]
    if version != VERSION:
        raise EnvelopeError(f"unsupported envelope version {version}")
    msg_id = data[7:15]
    (timestamp,) = struct.unpack(">I", data[15:19])
    clen = data[19]
    callsign = data[20: 20 + clen].decode("ascii", "replace")
    body = data[20 + clen:]
    encrypted = bool(flags & FLAG_ENCRYPTED)
    if encrypted:
        if not passphrase:
            err = EnvelopeError("message is encrypted and no passphrase is set")
            err.encrypted = True
            raise err
        if len(body) < 16 + 12 + 16:
            raise EnvelopeError("encrypted body too short")
        salt, nonce, ct = body[:16], body[16:28], body[28:]
        aad = data[: 20 + clen]
        try:
            body = AESGCM(_derive_key(passphrase, salt)).decrypt(nonce, ct, aad)
        except InvalidTag:
            err = EnvelopeError("wrong passphrase or corrupted message")
            err.encrypted = True
            raise err
    return Message(payload_type, bytes(body), msg_id, timestamp, callsign, encrypted)
