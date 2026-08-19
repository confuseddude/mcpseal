import re

import pytest

from mcpseal.keychain import delete_secret
from mcpseal.machine_identity import PRIVATE_KEY_ACCOUNT, load_or_create_machine_identity, sign_with_machine_key


@pytest.fixture(autouse=True)
def cleanup():
    yield
    delete_secret(PRIVATE_KEY_ACCOUNT)


def test_creates_a_new_keypair_when_none_exists():
    identity = load_or_create_machine_identity()
    assert re.match(r"^[0-9a-f]{64}$", identity.private_key_hex)
    assert re.match(r"^[0-9a-f]{64}$", identity.public_key_hex)


def test_reuses_an_existing_keypair_rather_than_replacing_it():
    first = load_or_create_machine_identity()
    second = load_or_create_machine_identity()
    assert first.private_key_hex == second.private_key_hex
    assert first.public_key_hex == second.public_key_hex


def test_sign_produces_a_verifiable_signature():
    identity = load_or_create_machine_identity()
    signature_hex = sign_with_machine_key(identity.private_key_hex, b"hello world")
    assert re.match(r"^[0-9a-f]{128}$", signature_hex)

    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    public_key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(identity.public_key_hex))
    public_key.verify(bytes.fromhex(signature_hex), b"hello world")  # raises if invalid


def test_tampered_message_fails_verification():
    identity = load_or_create_machine_identity()
    signature_hex = sign_with_machine_key(identity.private_key_hex, b"original")

    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    public_key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(identity.public_key_hex))
    with pytest.raises(InvalidSignature):
        public_key.verify(bytes.fromhex(signature_hex), b"tampered")
