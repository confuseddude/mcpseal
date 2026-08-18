import json
from pathlib import Path

import pytest

from mcplock.lockfile import create_empty_lockfile, read_lockfile, write_lockfile


def test_create_empty_lockfile_matches_part_2_3_skeleton():
    lf = create_empty_lockfile()
    assert lf["version"] == 1
    assert lf["signature"] is None
    assert lf["servers"] == {}
    assert lf["policy"] == {
        "onDrift": "block",
        "onUnknownTool": "block",
        "allowNewToolsFromApprovedServer": False,
    }


def test_write_then_read_round_trips_exactly(tmp_path):
    file_path = tmp_path / ".mcp-lock.json"
    original = create_empty_lockfile("mcplock@test")
    original["servers"]["github"] = {
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "commandHash": "sha256:abc123",
        "tools": {
            "create_issue": {
                "hash": "sha256:def456",
                "description": "Create a new GitHub issue",
                "approvedAt": original["generatedAt"],
                "approvedBy": "local",
                "status": "approved",
            }
        },
    }

    write_lockfile(str(file_path), original)
    read_back = read_lockfile(str(file_path))
    assert read_back == original


def test_read_lockfile_raises_on_missing_file(tmp_path):
    missing = tmp_path / "does-not-exist.json"
    with pytest.raises(ValueError):
        read_lockfile(str(missing))


def test_read_lockfile_raises_on_malformed_json(tmp_path):
    file_path = tmp_path / "malformed.json"
    file_path.write_text("{ not valid json", encoding="utf-8")
    with pytest.raises(ValueError):
        read_lockfile(str(file_path))


def test_read_lockfile_raises_on_missing_required_fields(tmp_path):
    file_path = tmp_path / "incomplete.json"
    file_path.write_text(json.dumps({"version": 1}), encoding="utf-8")
    with pytest.raises(ValueError):
        read_lockfile(str(file_path))


def test_read_lockfile_raises_when_not_an_object(tmp_path):
    file_path = tmp_path / "not-an-object.json"
    file_path.write_text(json.dumps([1, 2, 3]), encoding="utf-8")
    with pytest.raises(ValueError):
        read_lockfile(str(file_path))
