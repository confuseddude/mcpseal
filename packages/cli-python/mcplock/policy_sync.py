# Mirrors packages/cli-node/src/policy-sync.ts. build-bible.md Part 8.1 /
# Part 9 / Part 13: "the pushed-policy channel is your worst-case attack
# surface... design it into the policy format from the first Enterprise
# line of code." CLAUDE.md invariant 5: "A pushed policy is only trusted
# if it verifies against the org signing key pinned at login. Never add a
# code path that applies a policy update without that signature check."
#
# Every exit from pull_and_apply_policy() that isn't "verified and
# applied" must leave the existing .mcp-lock.json completely untouched.
# That's the single property this whole module exists to guarantee — read
# it with that in mind.
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Literal

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from mcplock.config import config_path as default_config_path, read_config, write_config
from mcplock.http_client import HttpRequestFn, request as default_request

Outcome = Literal[
    "applied",
    "no-newer-version",
    "skipped-not-logged-in",
    "skipped-no-pinned-key",
    "skipped-no-policy-published",
    "rejected-invalid-signature",
    "rejected-malformed-response",
    "rejected-network-error",
]


@dataclass
class PolicySyncResult:
    outcome: Outcome
    version: int | None = None
    currentVersion: int | None = None
    message: str | None = None


def _verify(signature_hex: str, message: bytes, public_key_hex: str) -> bool:
    try:
        public_key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key_hex))
        public_key.verify(bytes.fromhex(signature_hex), message)
        return True
    except (InvalidSignature, ValueError):
        return False


def pull_and_apply_policy(
    cfg_path: str | None = None,
    lockfile_path: str | None = None,
    request_fn: HttpRequestFn | None = None,
    api_key_token: str | None = None,
) -> PolicySyncResult:
    resolved_cfg_path = cfg_path or default_config_path()
    config = read_config(resolved_cfg_path)
    if not config or not config.get("workspaceId") or not config.get("ingestUrl"):
        return PolicySyncResult(outcome="skipped-not-logged-in")
    if not config.get("orgPublicKeyHex"):
        # Fail closed by refusing to trust ANY policy rather than trusting
        # one with no pinned key to check it against — the whole point of
        # pinning.
        return PolicySyncResult(outcome="skipped-no-pinned-key")
    if not api_key_token:
        return PolicySyncResult(outcome="skipped-not-logged-in")

    req = request_fn or default_request
    try:
        res = req("GET", f"{config['ingestUrl']}/v1/policy/current", {"authorization": f"Bearer {api_key_token}"}, None)
    except Exception as err:  # noqa: BLE001 — fail-closed boundary: any transport failure must reject, not raise
        return PolicySyncResult(outcome="rejected-network-error", message=str(err))

    if res.status == 404:
        return PolicySyncResult(outcome="skipped-no-policy-published")
    if not res.ok:
        return PolicySyncResult(outcome="rejected-network-error", message=f"HTTP {res.status}")

    try:
        body = res.json()
        if not isinstance(body.get("version"), int) or not isinstance(body.get("lockfileJson"), str):
            raise ValueError("missing required fields")
    except (json.JSONDecodeError, ValueError, AttributeError):
        # Interrupted/corrupted download: the existing lockfile is
        # untouched because we haven't written anything yet.
        return PolicySyncResult(outcome="rejected-malformed-response")

    signature = body.get("signature")
    if not signature:
        return PolicySyncResult(outcome="rejected-invalid-signature")

    # The signature check: fail closed on every possible way this can go
    # wrong — malformed hex, wrong-length key, actual cryptographic
    # mismatch.
    try:
        verified = _verify(signature, body["lockfileJson"].encode("utf-8"), config["orgPublicKeyHex"])
    except Exception:
        verified = False
    if not verified:
        return PolicySyncResult(outcome="rejected-invalid-signature")

    # Malformed JSON inside a validly-signed body should be structurally
    # impossible (the server only signs valid JSON — see app-api's
    # POST /v1/policies), but parse defensively anyway: never write bytes
    # to the real lockfile path without confirming they're at least valid
    # JSON.
    try:
        json.loads(body["lockfileJson"])
    except json.JSONDecodeError:
        return PolicySyncResult(outcome="rejected-malformed-response")

    current_version = config.get("lastAppliedPolicyVersion", 0)
    if body["version"] <= current_version:
        # Never downgrade (build-bible Part 9's replay/old-version
        # handling): a server returning a version we've already applied or
        # an older one is a no-op, not an error and not an update.
        return PolicySyncResult(outcome="no-newer-version", currentVersion=current_version)

    resolved_lockfile_path = lockfile_path or os.path.join(os.getcwd(), ".mcp-lock.json")
    # Atomic replace: write to a temp file, then rename over the target.
    # If the process dies mid-write, the temp file is orphaned but the
    # real lockfile is never left partially written.
    tmp_path = f"{resolved_lockfile_path}.tmp-{os.getpid()}"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(body["lockfileJson"])
        os.replace(tmp_path, resolved_lockfile_path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass  # best-effort cleanup only

    config["lastAppliedPolicyVersion"] = body["version"]
    write_config(config, resolved_cfg_path)
    return PolicySyncResult(outcome="applied", version=body["version"])


# Exposed for the CLI/tests to read what's actually on disk without
# re-implementing the read.
def read_lockfile_raw(lockfile_path: str) -> str | None:
    if not os.path.exists(lockfile_path):
        return None
    with open(lockfile_path, "r", encoding="utf-8") as f:
        return f.read()
