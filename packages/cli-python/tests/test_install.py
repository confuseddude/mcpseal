import hashlib
import json
import os

import pytest

from mcpseal.install import install, uninstall


def write_config(tmp_path, content):
    path = tmp_path / ".mcp.json"
    path.write_text(content, encoding="utf-8")
    return str(path)


def md5(path):
    return hashlib.md5(open(path, "rb").read()).hexdigest()


def test_install_rewrites_command_and_args(tmp_path):
    write_config(tmp_path, json.dumps({"mcpServers": {"a": {"command": "node", "args": ["server.js"]}}}))
    result = install(str(tmp_path))
    config = json.loads((tmp_path / ".mcp.json").read_text(encoding="utf-8"))
    assert config["mcpServers"]["a"]["command"] == "uvx"
    assert config["mcpServers"]["a"]["args"] == ["mcpseal", "proxy", "a", "node", "server.js"]
    assert result["serverCount"] == 1
    assert os.path.exists(result["backupPath"])


def test_install_then_uninstall_is_byte_identical(tmp_path):
    original = json.dumps({"mcpServers": {"a": {"command": "node", "args": ["server.js"]}}}, indent=2)
    config_path = write_config(tmp_path, original)
    before_hash = md5(config_path)

    install(str(tmp_path))
    assert md5(config_path) != before_hash

    uninstall(str(tmp_path))
    assert md5(config_path) == before_hash


def test_install_missing_config_raises(tmp_path):
    with pytest.raises(ValueError):
        install(str(tmp_path))


def test_install_twice_raises(tmp_path):
    write_config(tmp_path, json.dumps({"mcpServers": {"a": {"command": "node", "args": []}}}))
    install(str(tmp_path))
    with pytest.raises(ValueError):
        install(str(tmp_path))


def test_uninstall_without_install_raises(tmp_path):
    write_config(tmp_path, json.dumps({"mcpServers": {}}))
    with pytest.raises(ValueError):
        uninstall(str(tmp_path))
