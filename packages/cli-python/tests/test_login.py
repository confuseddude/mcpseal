import json
import os
import re
import uuid

import pytest

from mcplock.config import read_config
from mcplock.keychain import delete_secret, get_secret
from mcplock.login import API_KEY_ACCOUNT, LoginError, login
from mcplock.http_client import HttpResponse
from mcplock.machine_identity import PRIVATE_KEY_ACCOUNT


def mock_request_sequence(responses):
    state = {"i": 0}

    def request_fn(method, url, headers, body):
        r = responses[min(state["i"], len(responses) - 1)]
        state["i"] += 1
        return HttpResponse(status=r["status"], text=json.dumps(r["body"]))

    return request_fn


@pytest.fixture(autouse=True)
def cleanup():
    yield
    delete_secret(API_KEY_ACCOUNT)
    delete_secret(PRIVATE_KEY_ACCOUNT)


def test_completes_device_flow_stores_api_key_writes_config(tmp_path):
    cfg_path = str(tmp_path / "config.json")
    workspace_id = str(uuid.uuid4())
    api_key_token = "keyid123.secretvalue"

    request_fn = mock_request_sequence(
        [
            {"status": 200, "body": {"deviceCode": "dc-1", "userCode": "ABC123", "expiresIn": 60, "interval": 0.01}},
            {"status": 200, "body": {"status": "approved", "apiKeyToken": api_key_token, "workspaceId": workspace_id}},
            {"status": 200, "body": {"machineId": "whatever", "workspaceId": workspace_id, "orgPublicKey": None}},
        ]
    )

    saw_waiting = {"flag": False}

    def on_waiting(user_code):
        assert user_code == "ABC123"
        saw_waiting["flag"] = True

    result = login(request_fn=request_fn, cfg_path=cfg_path, sleep=lambda s: None, on_waiting_for_approval=on_waiting)

    assert saw_waiting["flag"] is True
    assert result.workspaceId == workspace_id
    assert get_secret(API_KEY_ACCOUNT) == api_key_token
    assert re.match(r"^[0-9a-f]{64}$", get_secret(PRIVATE_KEY_ACCOUNT))

    config = read_config(cfg_path)
    assert config["workspaceId"] == workspace_id
    assert config["machineId"] == result.machineId


def test_polls_through_pending_states_before_approval(tmp_path):
    cfg_path = str(tmp_path / "config.json")
    workspace_id = str(uuid.uuid4())

    request_fn = mock_request_sequence(
        [
            {"status": 200, "body": {"deviceCode": "dc-2", "userCode": "XYZ999", "expiresIn": 60, "interval": 0.01}},
            {"status": 200, "body": {"status": "pending"}},
            {"status": 200, "body": {"status": "pending"}},
            {"status": 200, "body": {"status": "approved", "apiKeyToken": "k.s", "workspaceId": workspace_id}},
            {"status": 200, "body": {"machineId": "m", "workspaceId": workspace_id, "orgPublicKey": None}},
        ]
    )

    result = login(request_fn=request_fn, cfg_path=cfg_path, sleep=lambda s: None, max_polls=10)
    assert result.workspaceId == workspace_id


def test_raises_if_denied(tmp_path):
    cfg_path = str(tmp_path / "config.json")
    request_fn = mock_request_sequence(
        [
            {"status": 200, "body": {"deviceCode": "dc-3", "userCode": "DEN000", "expiresIn": 60, "interval": 0.01}},
            {"status": 200, "body": {"status": "denied"}},
        ]
    )
    with pytest.raises(LoginError, match="denied"):
        login(request_fn=request_fn, cfg_path=cfg_path, sleep=lambda s: None)
    assert read_config(cfg_path) is None


def test_raises_if_expired(tmp_path):
    cfg_path = str(tmp_path / "config.json")
    request_fn = mock_request_sequence(
        [
            {"status": 200, "body": {"deviceCode": "dc-4", "userCode": "EXP000", "expiresIn": 60, "interval": 0.01}},
            {"status": 200, "body": {"status": "expired"}},
        ]
    )
    with pytest.raises(LoginError, match="expired"):
        login(request_fn=request_fn, cfg_path=cfg_path, sleep=lambda s: None)


def test_raises_on_non_2xx_from_device_start(tmp_path):
    cfg_path = str(tmp_path / "config.json")
    request_fn = mock_request_sequence([{"status": 500, "body": {}}])
    with pytest.raises(LoginError, match="HTTP 500"):
        login(request_fn=request_fn, cfg_path=cfg_path, sleep=lambda s: None)


def test_refuses_to_silently_repin_a_different_org_key(tmp_path):
    cfg_path = str(tmp_path / "config.json")
    workspace_id = str(uuid.uuid4())
    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump({"workspaceId": "old", "machineId": "old", "ingestUrl": "x", "orgPublicKeyHex": "a" * 64}, f)

    request_fn = mock_request_sequence(
        [
            {"status": 200, "body": {"deviceCode": "dc-5", "userCode": "REPIN1", "expiresIn": 60, "interval": 0.01}},
            {"status": 200, "body": {"status": "approved", "apiKeyToken": "k.s", "workspaceId": workspace_id}},
            {"status": 200, "body": {"machineId": "m", "workspaceId": workspace_id, "orgPublicKey": "b" * 64}},
        ]
    )
    with pytest.raises(LoginError, match="refusing to overwrite"):
        login(request_fn=request_fn, cfg_path=cfg_path, sleep=lambda s: None)
