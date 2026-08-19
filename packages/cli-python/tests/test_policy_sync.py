# build-bible.md Part 8.1 / Part 9 / Part 13 attack matrix — the pushed-
# policy channel is explicitly called out as the highest-value attack
# surface in the whole system. Every rejection path here must leave the
# existing .mcp-lock.json byte-for-byte untouched. Mirrors
# packages/cli-node/src/policy-sync.test.ts.
import json
import uuid

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from mcpseal.config import write_config
from mcpseal.http_client import HttpResponse
from mcpseal.policy_sync import pull_and_apply_policy


class OrgKeypair:
    def __init__(self):
        self._private_key = Ed25519PrivateKey.generate()
        self.public_key_hex = self._private_key.public_key().public_bytes_raw().hex()

    def sign(self, message: str) -> str:
        return self._private_key.sign(message.encode("utf-8")).hex()


def mock_request_json(status: int, body: dict):
    def request_fn(method, url, headers, req_body):
        return HttpResponse(status=status, text=json.dumps(body))

    return request_fn


@pytest.fixture
def paths(tmp_path):
    return {"cfg_path": str(tmp_path / "config.json"), "lockfile_path": str(tmp_path / ".mcp-lock.json")}


def base_config(org_public_key_hex=None, last_applied_policy_version=None):
    cfg = {"workspaceId": "w", "machineId": "m", "ingestUrl": "http://127.0.0.1:8787"}
    if org_public_key_hex is not None:
        cfg["orgPublicKeyHex"] = org_public_key_hex
    if last_applied_policy_version is not None:
        cfg["lastAppliedPolicyVersion"] = last_applied_policy_version
    return cfg


def test_valid_policy_accepted_and_applied_atomically(paths):
    org = OrgKeypair()
    write_config(base_config(org.public_key_hex), paths["cfg_path"])
    lockfile_json = json.dumps({"version": 1, "servers": {"github": {"tools": {}}}})
    request_fn = mock_request_json(200, {"version": 1, "lockfileJson": lockfile_json, "signature": org.sign(lockfile_json)})

    result = pull_and_apply_policy(cfg_path=paths["cfg_path"], lockfile_path=paths["lockfile_path"], request_fn=request_fn, api_key_token="k.s")
    assert result.outcome == "applied"
    assert result.version == 1
    with open(paths["lockfile_path"], "r", encoding="utf-8") as f:
        assert f.read() == lockfile_json


def test_modified_policy_rejected_lockfile_untouched(paths):
    org = OrgKeypair()
    write_config(base_config(org.public_key_hex), paths["cfg_path"])
    with open(paths["lockfile_path"], "w", encoding="utf-8") as f:
        f.write("ORIGINAL-LOCKFILE-CONTENT")

    original_lockfile = json.dumps({"version": 1, "servers": {}})
    signature = org.sign(original_lockfile)  # sign the ORIGINAL...
    tampered_lockfile = json.dumps({"version": 1, "servers": {"evil": {"tools": {"steal": {"status": "approved"}}}}})  # ...ship TAMPERED
    request_fn = mock_request_json(200, {"version": 1, "lockfileJson": tampered_lockfile, "signature": signature})

    result = pull_and_apply_policy(cfg_path=paths["cfg_path"], lockfile_path=paths["lockfile_path"], request_fn=request_fn, api_key_token="k.s")
    assert result.outcome == "rejected-invalid-signature"
    with open(paths["lockfile_path"], "r", encoding="utf-8") as f:
        assert f.read() == "ORIGINAL-LOCKFILE-CONTENT"


def test_wrong_org_key_rejected(paths):
    our_org = OrgKeypair()
    attacker_org = OrgKeypair()
    write_config(base_config(our_org.public_key_hex), paths["cfg_path"])
    lockfile_json = json.dumps({"version": 1, "servers": {}})
    request_fn = mock_request_json(200, {"version": 1, "lockfileJson": lockfile_json, "signature": attacker_org.sign(lockfile_json)})

    result = pull_and_apply_policy(cfg_path=paths["cfg_path"], lockfile_path=paths["lockfile_path"], request_fn=request_fn, api_key_token="k.s")
    assert result.outcome == "rejected-invalid-signature"


def test_garbage_signature_hex_rejected_without_throwing(paths):
    org = OrgKeypair()
    write_config(base_config(org.public_key_hex), paths["cfg_path"])
    lockfile_json = json.dumps({"version": 1, "servers": {}})
    request_fn = mock_request_json(200, {"version": 1, "lockfileJson": lockfile_json, "signature": "not-hex-zzz"})

    result = pull_and_apply_policy(cfg_path=paths["cfg_path"], lockfile_path=paths["lockfile_path"], request_fn=request_fn, api_key_token="k.s")
    assert result.outcome == "rejected-invalid-signature"


def test_malformed_response_missing_fields_rejected(paths):
    org = OrgKeypair()
    write_config(base_config(org.public_key_hex), paths["cfg_path"])
    request_fn = mock_request_json(200, {"version": 1})  # missing lockfileJson

    result = pull_and_apply_policy(cfg_path=paths["cfg_path"], lockfile_path=paths["lockfile_path"], request_fn=request_fn, api_key_token="k.s")
    assert result.outcome == "rejected-malformed-response"


def test_replay_old_version_is_a_no_op_never_a_downgrade(paths):
    org = OrgKeypair()
    write_config(base_config(org.public_key_hex, last_applied_policy_version=5), paths["cfg_path"])
    lockfile_json = json.dumps({"version": 3, "servers": {}})
    request_fn = mock_request_json(200, {"version": 3, "lockfileJson": lockfile_json, "signature": org.sign(lockfile_json)})

    result = pull_and_apply_policy(cfg_path=paths["cfg_path"], lockfile_path=paths["lockfile_path"], request_fn=request_fn, api_key_token="k.s")
    assert result.outcome == "no-newer-version"
    assert result.currentVersion == 5
    import os

    assert not os.path.exists(paths["lockfile_path"])


def test_network_failure_leaves_existing_policy_active(paths):
    org = OrgKeypair()
    write_config(base_config(org.public_key_hex), paths["cfg_path"])
    with open(paths["lockfile_path"], "w", encoding="utf-8") as f:
        f.write("EXISTING")

    def failing_request(method, url, headers, body):
        raise RuntimeError("network down")

    result = pull_and_apply_policy(cfg_path=paths["cfg_path"], lockfile_path=paths["lockfile_path"], request_fn=failing_request, api_key_token="k.s")
    assert result.outcome == "rejected-network-error"
    with open(paths["lockfile_path"], "r", encoding="utf-8") as f:
        assert f.read() == "EXISTING"


def test_no_pinned_key_refused_before_ever_calling_request(paths):
    write_config(base_config(org_public_key_hex=None), paths["cfg_path"])

    def forbidden_request(method, url, headers, body):
        raise AssertionError("must never be called with no pinned key")

    result = pull_and_apply_policy(cfg_path=paths["cfg_path"], lockfile_path=paths["lockfile_path"], request_fn=forbidden_request, api_key_token="k.s")
    assert result.outcome == "skipped-no-pinned-key"


def test_no_policy_published_yet(paths):
    org = OrgKeypair()
    write_config(base_config(org.public_key_hex), paths["cfg_path"])
    request_fn = lambda method, url, headers, body: HttpResponse(status=404, text="{}")  # noqa: E731

    result = pull_and_apply_policy(cfg_path=paths["cfg_path"], lockfile_path=paths["lockfile_path"], request_fn=request_fn, api_key_token="k.s")
    assert result.outcome == "skipped-no-policy-published"


def test_not_logged_in_when_no_config(tmp_path):
    result = pull_and_apply_policy(cfg_path=str(tmp_path / "missing.json"), api_key_token="k.s")
    assert result.outcome == "skipped-not-logged-in"
