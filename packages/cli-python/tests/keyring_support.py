"""Shared guard for the tests that need a REAL OS credential store.

These four modules (keychain, login, machine_identity, ship_events)
deliberately exercise the actual platform keychain rather than a mock --
that is the point of them, since invariant 6 is about where secrets
physically live.

They were previously skipped whenever CI=true, on the belief that a
hosted runner cannot do real keychain work. That was too broad: on
GitHub's runners macOS and Windows both handle the real keychain fine,
and skipping there discarded the only automated coverage of the macOS
Keychain path. Only Linux genuinely lacks a backend -- python-keyring
falls through to backends.fail.Keyring there, because reaching the
Secret Service additionally needs the `secretstorage` package and a
session bus that a headless runner has no reason to provide.

So the guard asks the real question -- "is there a usable backend right
now?" -- instead of guessing from CI or sys.platform. It runs the tests
everywhere they can actually run, including every developer machine,
and skips only where the work is genuinely impossible.
"""

import pytest


def keyring_backend_available() -> bool:
    try:
        import keyring
        from keyring.backends.fail import Keyring as FailKeyring

        return not isinstance(keyring.get_keyring(), FailKeyring)
    except Exception:
        # No keyring package, or it raised while resolving a backend --
        # either way there is nothing real to test against here.
        return False


requires_real_keyring = pytest.mark.skipif(
    not keyring_backend_available(),
    reason="no usable OS keyring backend on this machine (expected on headless Linux)",
)
