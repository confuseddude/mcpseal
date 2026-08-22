import os

import pytest

from mcpseal.keychain import delete_secret, get_secret, set_secret

# Real OS keychain integration is unreliable inside headless/ephemeral CI
# containers -- there's no real desktop session backing gnome-keyring's
# SecretStorage on Linux runners, which causes both hangs and spurious
# failures (see CHECKLIST.md). Covered by manual cross-OS verification
# before each release instead; this still runs locally on every OS.
TEST_ACCOUNT = "test-account-mcpseal-pytest"


@pytest.fixture(autouse=True)
def cleanup():
    yield
    delete_secret(TEST_ACCOUNT)


def test_round_trips_a_secret_through_the_real_os_keychain():
    set_secret(TEST_ACCOUNT, "s3cr3t-value")
    assert get_secret(TEST_ACCOUNT) == "s3cr3t-value"


def test_returns_none_for_a_secret_that_was_never_set():
    assert get_secret("account-that-does-not-exist-mcpseal-pytest") is None


def test_delete_is_idempotent_and_get_returns_none_after_delete():
    set_secret(TEST_ACCOUNT, "temp")
    delete_secret(TEST_ACCOUNT)
    assert get_secret(TEST_ACCOUNT) is None
    delete_secret(TEST_ACCOUNT)  # must not raise


def test_overwriting_a_secret_replaces_the_old_value():
    set_secret(TEST_ACCOUNT, "first")
    set_secret(TEST_ACCOUNT, "second")
    assert get_secret(TEST_ACCOUNT) == "second"
