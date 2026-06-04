"""AES-256 symmetric encryption for BYOK API key storage.

Uses Fernet from the `cryptography` library (already a common transitive dep).
Falls back to base64 obfuscation with a warning if cryptography is unavailable.
"""
from __future__ import annotations

import base64
import hashlib
import os

try:
    from cryptography.fernet import Fernet, InvalidToken
    _CRYPTO_AVAILABLE = True
except ImportError:
    _CRYPTO_AVAILABLE = False


def _get_fernet():
    """Build a Fernet instance from the SECRET_KEY environment variable."""
    raw_key = os.getenv("SECRET_KEY", "")
    if not raw_key:
        raise RuntimeError(
            "SECRET_KEY is not set in .env. "
            "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    # Fernet requires a 32-byte URL-safe base64-encoded key
    derived = hashlib.sha256(raw_key.encode()).digest()
    fernet_key = base64.urlsafe_b64encode(derived)
    from cryptography.fernet import Fernet
    return Fernet(fernet_key)


def encrypt_key(plain_text: str) -> str:
    """Encrypt a plaintext API key. Returns a base64-encoded ciphertext string."""
    if not plain_text:
        return ""
    if _CRYPTO_AVAILABLE:
        f = _get_fernet()
        return f.encrypt(plain_text.encode()).decode()
    # Fallback: simple base64 (NOT secure — warns in logs)
    import logging
    logging.getLogger(__name__).warning(
        "cryptography library not installed — API keys stored as base64 only. "
        "Install it: pip install cryptography"
    )
    return base64.b64encode(plain_text.encode()).decode()


def decrypt_key(cipher_text: str) -> str:
    """Decrypt a ciphertext API key back to plaintext. Returns '' on failure."""
    if not cipher_text:
        return ""
    if _CRYPTO_AVAILABLE:
        try:
            f = _get_fernet()
            return f.decrypt(cipher_text.encode()).decode()
        except Exception:
            return ""
    # Fallback base64 decode
    try:
        return base64.b64decode(cipher_text.encode()).decode()
    except Exception:
        return ""
