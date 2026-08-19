# Mirrors packages/cli-node/src/machine-identity.ts. build-bible.md Part
# 4.3/6.2: "the CLI generates its ed25519 machine keypair and registers the
# public key to the workspace." The private key never leaves the machine
# (Part 9) — it lives only in the OS keychain (keychain.py), keyed
# separately from the workspace API key so revoking one doesn't require
# touching the other.
from __future__ import annotations

from typing import NamedTuple

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

from mcpseal.keychain import get_secret, set_secret

PRIVATE_KEY_ACCOUNT = "machine-private-key"


class MachineIdentity(NamedTuple):
    private_key_hex: str
    public_key_hex: str


def _private_key_from_hex(hex_str: str) -> Ed25519PrivateKey:
    return Ed25519PrivateKey.from_private_bytes(bytes.fromhex(hex_str))


def _public_key_hex(private_key: Ed25519PrivateKey) -> str:
    raw = private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return raw.hex()


# Idempotent: an existing keypair (from a prior login) is reused rather
# than silently replaced, since a new keypair would need re-registration
# and would orphan the previously-registered public key.
def load_or_create_machine_identity() -> MachineIdentity:
    existing = get_secret(PRIVATE_KEY_ACCOUNT)
    if existing:
        private_key = _private_key_from_hex(existing)
        return MachineIdentity(private_key_hex=existing, public_key_hex=_public_key_hex(private_key))

    private_key = Ed25519PrivateKey.generate()
    private_key_hex = private_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption()).hex()
    set_secret(PRIVATE_KEY_ACCOUNT, private_key_hex)
    return MachineIdentity(private_key_hex=private_key_hex, public_key_hex=_public_key_hex(private_key))


def sign_with_machine_key(private_key_hex: str, message: bytes) -> str:
    private_key = _private_key_from_hex(private_key_hex)
    return private_key.sign(message).hex()
