"""BitLink21 Encryption — NIP-04 (AES-256-CBC + ECDH secp256k1) + broadcast key support."""

import base64
import os
import logging
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from nostr.key import PrivateKey

logger = logging.getLogger(__name__)


def encrypt_nip04(plaintext: str, sender_nsec: str, recipient_npub: str) -> str:
    """NIP-04 encryption: AES-256-CBC with ECDH shared secret.

    Wire format: base64(ciphertext)?iv=base64(IV) per NIP-04 standard

    Args:
        plaintext: Message to encrypt (plaintext, will be encrypted)
        sender_nsec: Sender's private key (32-byte hex string)
        recipient_npub: Recipient's public key (32-byte hex string)

    Returns:
        NIP-04 encrypted content: base64(ciphertext)?iv=base64(IV)

    Raises:
        ValueError: If keys are invalid or encryption fails
    """
    try:
        logger.debug(f"[ENCRYPT] NIP-04 encrypt called: plaintext_len={len(plaintext)}, sender_nsec={sender_nsec[:8]}..., recipient_npub={recipient_npub[:8]}...")
        # Validate key formats
        if len(sender_nsec) != 64 or len(recipient_npub) != 64:
            logger.error(f"[ENCRYPT] Invalid key length: sender_nsec={len(sender_nsec)}, recipient_npub={len(recipient_npub)}")
            raise ValueError("Invalid key length (must be 32 bytes hex = 64 chars)")

        bytes.fromhex(sender_nsec)
        bytes.fromhex(recipient_npub)
        logger.debug(f"[ENCRYPT] Keys validated successfully")

        # Use nostr library to compute shared secret (proven ECDH implementation)
        logger.debug(f"[ENCRYPT] Computing ECDH shared secret")
        private_key = PrivateKey(bytes.fromhex(sender_nsec))
        shared_secret = private_key.compute_shared_secret(recipient_npub)
        logger.debug(f"[ENCRYPT] Shared secret computed: {len(shared_secret)} bytes")

        # Generate random 16-byte IV
        iv = os.urandom(16)
        logger.debug(f"[ENCRYPT] Generated IV: {len(iv)} bytes")

        # Add PKCS7 padding
        plaintext_bytes = plaintext.encode("utf-8")
        block_size = 16
        padding_len = block_size - (len(plaintext_bytes) % block_size)
        padded_plaintext = plaintext_bytes + bytes([padding_len] * padding_len)
        logger.debug(f"[ENCRYPT] PKCS7 padding applied: original={len(plaintext_bytes)}, padded={len(padded_plaintext)}")

        # Encrypt with AES-256-CBC using shared_secret as key
        cipher = Cipher(
            algorithms.AES(shared_secret),
            modes.CBC(iv),
            backend=default_backend()
        )
        encryptor = cipher.encryptor()
        ciphertext = encryptor.update(padded_plaintext) + encryptor.finalize()
        logger.debug(f"[ENCRYPT] Encryption complete: ciphertext={len(ciphertext)} bytes")

        # NIP-04 wire format: base64(ciphertext)?iv=base64(IV)
        encrypted_content = (
            base64.b64encode(ciphertext).decode("utf-8") +
            "?iv=" +
            base64.b64encode(iv).decode("utf-8")
        )

        logger.debug(f"[ENCRYPT] NIP-04 wire format created: {len(encrypted_content)} bytes")
        return encrypted_content

    except Exception as e:
        logger.error(f"[ENCRYPT] NIP-04 encryption failed: {e}")
        raise ValueError(f"NIP-04 encryption failed: {e}")


def decrypt_nip04(encrypted_content: str, recipient_nsec: str, sender_npub: str) -> str:
    """NIP-04 decryption using ECDH shared secret.

    Handles NIP-04 wire format: base64(ciphertext)?iv=base64(IV)

    Args:
        encrypted_content: NIP-04 encrypted content (base64(ciphertext)?iv=base64(IV))
        recipient_nsec: Recipient's private key (32-byte hex string)
        sender_npub: Sender's public key (32-byte hex string)

    Returns:
        Decrypted plaintext

    Raises:
        ValueError: If decryption fails or keys are invalid
    """
    try:
        logger.debug(f"[DECRYPT] NIP-04 decrypt called: content_len={len(encrypted_content)}, recipient_nsec={recipient_nsec[:8]}..., sender_npub={sender_npub[:8]}...")
        # Validate key formats
        if len(recipient_nsec) != 64 or len(sender_npub) != 64:
            logger.error(f"[DECRYPT] Invalid key length: recipient_nsec={len(recipient_nsec)}, sender_npub={len(sender_npub)}")
            raise ValueError("Invalid key length (must be 32 bytes hex = 64 chars)")

        bytes.fromhex(recipient_nsec)
        bytes.fromhex(sender_npub)
        logger.debug(f"[DECRYPT] Keys validated successfully")

        # Parse NIP-04 wire format: base64(ciphertext)?iv=base64(IV)
        if "?iv=" not in encrypted_content:
            logger.error(f"[DECRYPT] Invalid NIP-04 format: missing ?iv= separator")
            raise ValueError("Invalid NIP-04 format: missing ?iv= separator")

        parts = encrypted_content.split("?iv=")
        ciphertext = base64.b64decode(parts[0])
        iv = base64.b64decode(parts[1])
        logger.debug(f"[DECRYPT] Parsed wire format: ciphertext={len(ciphertext)} bytes, iv={len(iv)} bytes")

        # Compute shared secret using nostr library
        logger.debug(f"[DECRYPT] Computing ECDH shared secret")
        private_key = PrivateKey(bytes.fromhex(recipient_nsec))
        shared_secret = private_key.compute_shared_secret(sender_npub)
        logger.debug(f"[DECRYPT] Shared secret computed: {len(shared_secret)} bytes")

        # Decrypt using AES-256-CBC
        cipher = Cipher(
            algorithms.AES(shared_secret),
            modes.CBC(iv),
            backend=default_backend()
        )
        decryptor = cipher.decryptor()
        padded_plaintext = decryptor.update(ciphertext) + decryptor.finalize()
        logger.debug(f"[DECRYPT] Decryption complete: padded_len={len(padded_plaintext)} bytes")

        # Remove PKCS7 padding
        padding_len = padded_plaintext[-1]
        if padding_len > len(padded_plaintext) or padding_len > 16:
            logger.error(f"[DECRYPT] Invalid padding: {padding_len}")
            raise ValueError(f"Invalid padding: {padding_len}")
        plaintext = padded_plaintext[:-padding_len]
        logger.debug(f"[DECRYPT] PKCS7 padding removed: plaintext_len={len(plaintext)} bytes")

        return plaintext.decode("utf-8")

    except Exception as e:
        logger.error(f"[DECRYPT] NIP-04 decryption failed: {e}")
        raise ValueError(f"NIP-04 decryption failed: {e}")


def derive_broadcast_key(passphrase: str, salt: bytes = None) -> tuple:
    """Derive AES key from passphrase using PBKDF2.

    Args:
        passphrase: User-provided shared key
        salt: Optional salt; if None, random salt is generated

    Returns:
        Tuple of (key, salt) both as bytes
    """
    logger.debug(f"[ENCRYPT] Deriving broadcast key from passphrase, salt_provided={salt is not None}")
    if salt is None:
        salt = os.urandom(16)
        logger.debug(f"[ENCRYPT] Generated random salt: {len(salt)} bytes")

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
        backend=default_backend()
    )
    key = kdf.derive(passphrase.encode("utf-8"))
    logger.debug(f"[ENCRYPT] Broadcast key derived: {len(key)} bytes (32 byte AES key)")
    return key, salt


def encrypt_broadcast(plaintext: str, shared_key: str, salt: bytes = None) -> str:
    """Encrypt using shared broadcast key (AES-256-CBC).

    Args:
        plaintext: Message to encrypt
        shared_key: Shared passphrase
        salt: Optional salt for key derivation

    Returns:
        Base64 encoded (salt + IV + ciphertext)
    """
    try:
        logger.debug(f"[ENCRYPT] Broadcast encrypt called: plaintext_len={len(plaintext)}, salt_provided={salt is not None}")
        key, salt = derive_broadcast_key(shared_key, salt)

        iv = os.urandom(16)
        logger.debug(f"[ENCRYPT] Generated IV: {len(iv)} bytes")
        cipher = Cipher(
            algorithms.AES(key),
            modes.CBC(iv),
            backend=default_backend()
        )
        encryptor = cipher.encryptor()

        plaintext_bytes = plaintext.encode("utf-8")
        block_size = 16
        padding_len = block_size - (len(plaintext_bytes) % block_size)
        padded = plaintext_bytes + bytes([padding_len] * padding_len)
        logger.debug(f"[ENCRYPT] PKCS7 padding: original={len(plaintext_bytes)}, padded={len(padded)}")

        ciphertext = encryptor.update(padded) + encryptor.finalize()
        logger.debug(f"[ENCRYPT] Broadcast encryption complete: ciphertext={len(ciphertext)} bytes")

        # Return base64(salt + IV + ciphertext)
        result = base64.b64encode(salt + iv + ciphertext).decode("utf-8")
        logger.debug(f"[ENCRYPT] Broadcast wire format: {len(result)} bytes (base64)")
        return result

    except Exception as e:
        logger.error(f"[ENCRYPT] Broadcast encryption failed: {e}")
        raise ValueError(f"Broadcast encryption failed: {e}")


def decrypt_broadcast(ciphertext_b64: str, shared_key: str) -> str:
    """Decrypt broadcast message.

    Args:
        ciphertext_b64: Base64 encoded (salt + IV + ciphertext)
        shared_key: Shared passphrase

    Returns:
        Decrypted plaintext

    Raises:
        ValueError: If decryption fails
    """
    try:
        logger.debug(f"[DECRYPT] Broadcast decrypt called: ciphertext_len={len(ciphertext_b64)} bytes (base64)")
        data = base64.b64decode(ciphertext_b64)
        salt = data[:16]
        iv = data[16:32]
        ciphertext = data[32:]
        logger.debug(f"[DECRYPT] Parsed wire format: salt={len(salt)}, iv={len(iv)}, ciphertext={len(ciphertext)}")

        key, _ = derive_broadcast_key(shared_key, salt)

        cipher = Cipher(
            algorithms.AES(key),
            modes.CBC(iv),
            backend=default_backend()
        )
        decryptor = cipher.decryptor()
        padded_plaintext = decryptor.update(ciphertext) + decryptor.finalize()
        logger.debug(f"[DECRYPT] Broadcast decryption complete: padded_len={len(padded_plaintext)}")

        padding_len = padded_plaintext[-1]
        plaintext_bytes = padded_plaintext[:-padding_len]
        logger.debug(f"[DECRYPT] PKCS7 padding removed: plaintext_len={len(plaintext_bytes)}")

        return plaintext_bytes.decode("utf-8")

    except Exception as e:
        logger.error(f"[DECRYPT] Broadcast decryption failed: {e}")
        raise ValueError(f"Broadcast decryption failed: {e}")


def is_valid_npub(npub: str) -> bool:
    """Check if NPUB is valid hex (32 bytes)."""
    try:
        if len(npub) != 64:
            return False
        bytes.fromhex(npub)
        return True
    except ValueError:
        return False


def is_valid_nsec(nsec: str) -> bool:
    """Check if NSEC is valid hex (32 bytes)."""
    try:
        if len(nsec) != 64:
            return False
        bytes.fromhex(nsec)
        return True
    except ValueError:
        return False


def encrypt_nsec_at_rest(nsec: str, password: str, salt: bytes = None) -> str:
    """Encrypt NSEC with user password using AES-256-GCM.

    Wire format: base64(salt + IV + ciphertext + auth_tag)
    - salt: 16 bytes for PBKDF2
    - IV: 12 bytes for GCM
    - ciphertext: variable length
    - auth_tag: 16 bytes from GCM

    Args:
        nsec: NSEC hex string to encrypt (64 chars)
        password: User password (arbitrary length)
        salt: Optional salt; if None, random 16 bytes are generated

    Returns:
        base64(salt + IV + ciphertext + auth_tag)

    Raises:
        ValueError: If encryption fails
    """
    try:
        if not is_valid_nsec(nsec):
            raise ValueError("Invalid NSEC format")
        if not password:
            raise ValueError("Password cannot be empty")

        # Generate or use provided salt
        if salt is None:
            salt = os.urandom(16)

        # Derive key using PBKDF2
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        key = kdf.derive(password.encode("utf-8"))

        # Generate random IV for GCM (12 bytes for GCM, not 16)
        iv = os.urandom(12)

        # Encrypt NSEC bytes with AES-256-GCM
        cipher = Cipher(
            algorithms.AES(key),
            modes.GCM(iv),
            backend=default_backend()
        )
        encryptor = cipher.encryptor()
        nsec_bytes = nsec.encode("utf-8")
        ciphertext = encryptor.update(nsec_bytes) + encryptor.finalize()
        auth_tag = encryptor.tag

        # Concatenate: salt + IV + ciphertext + auth_tag
        encrypted_data = salt + iv + ciphertext + auth_tag

        return base64.b64encode(encrypted_data).decode("utf-8")

    except Exception as e:
        raise ValueError(f"NSEC encryption failed: {e}")


def decrypt_nsec_at_rest(encrypted_nsec_b64: str, password: str) -> str:
    """Decrypt NSEC encrypted with AES-256-GCM.

    Args:
        encrypted_nsec_b64: base64(salt + IV + ciphertext + auth_tag)
        password: User password

    Returns:
        Decrypted NSEC hex string

    Raises:
        ValueError: If decryption fails
    """
    try:
        if not password:
            raise ValueError("Password cannot be empty")

        # Decode base64
        encrypted_data = base64.b64decode(encrypted_nsec_b64)

        # Extract components
        if len(encrypted_data) < 16 + 12 + 16:  # salt + IV + min_ciphertext + tag
            raise ValueError("Invalid encrypted data length")

        salt = encrypted_data[:16]
        iv = encrypted_data[16:28]
        ciphertext_and_tag = encrypted_data[28:]

        # Auth tag is last 16 bytes
        if len(ciphertext_and_tag) < 16:
            raise ValueError("Invalid encrypted data: missing auth tag")

        ciphertext = ciphertext_and_tag[:-16]
        auth_tag = ciphertext_and_tag[-16:]

        # Derive same key using PBKDF2
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        key = kdf.derive(password.encode("utf-8"))

        # Decrypt with AES-256-GCM
        cipher = Cipher(
            algorithms.AES(key),
            modes.GCM(iv, auth_tag),
            backend=default_backend()
        )
        decryptor = cipher.decryptor()
        nsec_bytes = decryptor.update(ciphertext) + decryptor.finalize()

        nsec = nsec_bytes.decode("utf-8")

        # Validate decrypted NSEC
        if not is_valid_nsec(nsec):
            raise ValueError("Decrypted data is not a valid NSEC")

        return nsec

    except Exception as e:
        raise ValueError(f"NSEC decryption failed: {e}")
