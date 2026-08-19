# Mirrors packages/cli-node/src/install.ts. build-bible.md Part 3.3,
# Tasks.md 2.4: `mcpseal install` rewrites each server entry in the client
# config so the client launches `mcpseal proxy <serverName> <original
# command...>` instead of the original command directly. `mcpseal
# uninstall` reverses it exactly.
#
# Byte-for-byte guarantee: rather than regenerating JSON and hoping it
# matches the original formatting, install() snapshots the exact original
# file bytes to a backup file before rewriting; uninstall() just restores
# those exact bytes verbatim.
from __future__ import annotations

import json
import os
from typing import TypedDict

BACKUP_SUFFIX = ".mcpseal-backup"

# Default matches Part 3.1's zero-install distribution model ("uvx mcpseal").
DEFAULT_MCPSEAL_INVOCATION: dict = {"command": "uvx", "args": ["mcpseal"]}


class InstallResult(TypedDict):
    configPath: str
    backupPath: str
    serverCount: int


class UninstallResult(TypedDict):
    configPath: str


def install(project_dir: str, mcpseal_invocation: dict | None = None) -> InstallResult:
    invocation = mcpseal_invocation or DEFAULT_MCPSEAL_INVOCATION
    config_path = os.path.join(project_dir, ".mcp.json")
    backup_path = config_path + BACKUP_SUFFIX

    if not os.path.exists(config_path):
        raise ValueError(f"install: no config found at {config_path}")
    if os.path.exists(backup_path):
        raise ValueError(f"install: {backup_path} already exists — mcpseal appears to already be installed here")

    with open(config_path, "r", encoding="utf-8") as f:
        original_bytes = f.read()

    try:
        parsed = json.loads(original_bytes)
    except json.JSONDecodeError as err:
        raise ValueError(f"install: {config_path} is not valid JSON: {err}") from err
    if not isinstance(parsed, dict) or "mcpServers" not in parsed:
        raise ValueError(f'install: {config_path} is missing "mcpServers"')

    mcp_servers = parsed["mcpServers"]
    rewritten = {}
    server_count = 0
    for name, entry in mcp_servers.items():
        rewritten[name] = {
            "command": invocation["command"],
            "args": [*invocation["args"], "proxy", name, entry["command"], *entry.get("args", [])],
        }
        server_count += 1

    # Snapshot the exact original bytes BEFORE writing the rewritten config,
    # so a crash between these two steps still leaves a restorable backup.
    with open(backup_path, "w", encoding="utf-8") as f:
        f.write(original_bytes)

    new_config = {**parsed, "mcpServers": rewritten}
    with open(config_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(new_config, indent=2) + "\n")

    return {"configPath": config_path, "backupPath": backup_path, "serverCount": server_count}


def uninstall(project_dir: str) -> UninstallResult:
    config_path = os.path.join(project_dir, ".mcp.json")
    backup_path = config_path + BACKUP_SUFFIX

    if not os.path.exists(backup_path):
        raise ValueError(f"uninstall: no backup found at {backup_path} — mcpseal does not appear to be installed here")

    with open(backup_path, "r", encoding="utf-8") as f:
        original_bytes = f.read()
    with open(config_path, "w", encoding="utf-8") as f:
        f.write(original_bytes)
    os.remove(backup_path)

    return {"configPath": config_path}
