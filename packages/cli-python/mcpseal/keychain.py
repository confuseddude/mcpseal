# Mirrors packages/cli-node/src/keychain.ts. build-bible.md Part 6.2 /
# CLAUDE.md invariant 6: "workspace API key... stored in the OS keychain —
# keytar on Node, keyring on Python, never a plaintext dotfile." `keyring`
# wraps Windows Credential Manager / macOS Keychain / Linux Secret Service.
#
# Fail closed: if the OS keychain is unavailable, secrets are never written
# to a fallback plaintext location — a login that can't reach the keychain
# must fail loudly (keyring.errors.PasswordSetError propagates), not
# silently degrade to a dotfile.
import keyring
import keyring.errors

SERVICE = "mcpseal"


def set_secret(account: str, secret: str) -> None:
    keyring.set_password(SERVICE, account, secret)


def get_secret(account: str) -> str | None:
    try:
        return keyring.get_password(SERVICE, account)
    except keyring.errors.KeyringError:
        # Normalize any backend error to None so callers can distinguish
        # "not logged in" from a real keychain failure at the call site,
        # same as the TS version's try/catch-to-null.
        return None


def delete_secret(account: str) -> None:
    try:
        keyring.delete_password(SERVICE, account)
    except keyring.errors.PasswordDeleteError:
        pass  # already absent — deletion is idempotent
    except keyring.errors.NoKeyringError:
        # No backend at all (e.g. a headless Linux box with no Secret
        # Service): set_secret() fails loudly there, so nothing was ever
        # stored and there is nothing to delete. Deliberately NOT a broad
        # KeyringError catch — a locked or erroring keychain that DOES
        # hold a secret must still fail loudly rather than let the user
        # believe they logged out while the credential survives.
        pass
