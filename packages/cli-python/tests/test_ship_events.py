import json
import uuid

import pytest

from mcplock.config import write_config
from mcplock.event_log import append_event
from mcplock.http_client import HttpResponse
from mcplock.keychain import delete_secret, set_secret
from mcplock.login import API_KEY_ACCOUNT
from mcplock.machine_identity import PRIVATE_KEY_ACCOUNT, load_or_create_machine_identity
from mcplock.ship_events import ship_events


class NetworkCallNotAllowed(Exception):
    pass


def forbidden_request(*args, **kwargs):
    raise NetworkCallNotAllowed("network must never be called before login")


def test_zero_network_calls_with_no_config_at_all(tmp_path):
    cfg_path = str(tmp_path / "config.json")  # deliberately never written
    log_path = str(tmp_path / "events.jsonl")
    append_event(type_="blocked_drift", server="s", tool="t", log_path=log_path)

    result = ship_events(log_path=log_path, cfg_path=cfg_path, request_fn=forbidden_request)
    assert result.skipped is True


def test_zero_network_calls_with_config_but_no_keychain_credentials(tmp_path):
    cfg_path = str(tmp_path / "config.json")
    log_path = str(tmp_path / "events.jsonl")
    write_config({"workspaceId": str(uuid.uuid4()), "machineId": str(uuid.uuid4()), "ingestUrl": "http://127.0.0.1:8787"}, cfg_path)
    append_event(type_="blocked_drift", server="s", tool="t", log_path=log_path)

    result = ship_events(log_path=log_path, cfg_path=cfg_path, request_fn=forbidden_request)
    assert result.skipped is True


@pytest.fixture(autouse=True)
def cleanup():
    yield
    delete_secret(API_KEY_ACCOUNT)
    delete_secret(PRIVATE_KEY_ACCOUNT)


def test_ships_unshipped_events_signs_batch_advances_cursor(tmp_path):
    cfg_path = str(tmp_path / "config.json")
    log_path = str(tmp_path / "events.jsonl")
    workspace_id = str(uuid.uuid4())
    machine_id = str(uuid.uuid4())

    write_config({"workspaceId": workspace_id, "machineId": machine_id, "ingestUrl": "http://127.0.0.1:8787"}, cfg_path)
    set_secret(API_KEY_ACCOUNT, "keyid.secret")
    load_or_create_machine_identity()

    append_event(type_="blocked_drift", server="github", tool="create_issue", log_path=log_path)
    append_event(type_="blocked_unknown", server="github", tool="delete_repo", log_path=log_path)

    captured = {}

    def request_fn(method, url, headers, body):
        captured["body"] = body
        captured["headers"] = headers
        return HttpResponse(status=202, text=json.dumps({"accepted": 2, "duplicates": 0}))

    result = ship_events(log_path=log_path, cfg_path=cfg_path, request_fn=request_fn)
    assert result.skipped is False
    assert result.shipped == 2
    assert result.duplicates == 0
    assert captured["headers"]["authorization"] == "Bearer keyid.secret"
    assert captured["headers"]["x-mcplock-signature"]
    body = json.loads(captured["body"])
    assert body["workspaceId"] == workspace_id
    assert body["machineId"] == machine_id
    assert len(body["batch"]) == 2


def test_does_not_reship_events_already_covered_by_cursor(tmp_path):
    cfg_path = str(tmp_path / "config.json")
    log_path = str(tmp_path / "events.jsonl")
    write_config({"workspaceId": str(uuid.uuid4()), "machineId": str(uuid.uuid4()), "ingestUrl": "http://127.0.0.1:8787"}, cfg_path)
    set_secret(API_KEY_ACCOUNT, "keyid.secret")
    load_or_create_machine_identity()

    append_event(type_="blocked_drift", server="s", tool="t1", log_path=log_path)

    call_count = {"n": 0}

    def request_fn(method, url, headers, body):
        call_count["n"] += 1
        return HttpResponse(status=202, text=json.dumps({"accepted": 1, "duplicates": 0}))

    ship_events(log_path=log_path, cfg_path=cfg_path, request_fn=request_fn)
    assert call_count["n"] == 1

    result = ship_events(log_path=log_path, cfg_path=cfg_path, request_fn=request_fn)
    assert call_count["n"] == 1
    assert result.skipped is False
    assert result.shipped == 0


def test_leaves_cursor_unchanged_on_network_failure_for_retry(tmp_path):
    cfg_path = str(tmp_path / "config.json")
    log_path = str(tmp_path / "events.jsonl")
    write_config({"workspaceId": str(uuid.uuid4()), "machineId": str(uuid.uuid4()), "ingestUrl": "http://127.0.0.1:8787"}, cfg_path)
    set_secret(API_KEY_ACCOUNT, "keyid.secret")
    load_or_create_machine_identity()
    append_event(type_="blocked_drift", server="s", tool="t1", log_path=log_path)

    def failing_request(method, url, headers, body):
        raise RuntimeError("network down")

    result1 = ship_events(log_path=log_path, cfg_path=cfg_path, request_fn=failing_request)
    assert result1.shipped == 0

    called = {"flag": False}

    def working_request(method, url, headers, body):
        called["flag"] = True
        return HttpResponse(status=202, text=json.dumps({"accepted": 1, "duplicates": 0}))

    result2 = ship_events(log_path=log_path, cfg_path=cfg_path, request_fn=working_request)
    assert called["flag"] is True
    assert result2.shipped == 1
