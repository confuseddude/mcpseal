import json
import os

import pytest

from mcplock.config_discovery import discover_servers_from_claude_code_project_config


def write_mcp_json(tmp_path, content):
    (tmp_path / ".mcp.json").write_text(json.dumps(content), encoding="utf-8")


def test_no_config_returns_empty_list(tmp_path):
    assert discover_servers_from_claude_code_project_config(str(tmp_path)) == []


def test_discovers_servers_with_args(tmp_path):
    write_mcp_json(tmp_path, {"mcpServers": {"a": {"command": "node", "args": ["server.js"]}}})
    servers = discover_servers_from_claude_code_project_config(str(tmp_path))
    assert servers == [{"name": "a", "command": "node", "args": ["server.js"]}]


def test_defaults_missing_args_to_empty_list(tmp_path):
    write_mcp_json(tmp_path, {"mcpServers": {"a": {"command": "node"}}})
    servers = discover_servers_from_claude_code_project_config(str(tmp_path))
    assert servers[0]["args"] == []


def test_invalid_json_raises(tmp_path):
    (tmp_path / ".mcp.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(ValueError):
        discover_servers_from_claude_code_project_config(str(tmp_path))


def test_missing_mcp_servers_key_raises(tmp_path):
    write_mcp_json(tmp_path, {})
    with pytest.raises(ValueError):
        discover_servers_from_claude_code_project_config(str(tmp_path))


def test_missing_command_raises(tmp_path):
    write_mcp_json(tmp_path, {"mcpServers": {"a": {}}})
    with pytest.raises(ValueError):
        discover_servers_from_claude_code_project_config(str(tmp_path))


def test_non_string_command_raises(tmp_path):
    write_mcp_json(tmp_path, {"mcpServers": {"a": {"command": 5}}})
    with pytest.raises(ValueError):
        discover_servers_from_claude_code_project_config(str(tmp_path))


def test_non_array_args_raises(tmp_path):
    write_mcp_json(tmp_path, {"mcpServers": {"a": {"command": "node", "args": "oops"}}})
    with pytest.raises(ValueError):
        discover_servers_from_claude_code_project_config(str(tmp_path))
