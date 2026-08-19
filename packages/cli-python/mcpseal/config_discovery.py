# Mirrors packages/cli-node/src/config-discovery.ts. build-bible.md Part
# 3.3 / Tasks.md 2.1: start with Claude Code's project-scope config,
# `.mcp.json` at the project root:
#   { "mcpServers": { "<name>": { "command": "...", "args": [...] } } }
from __future__ import annotations

import json
from pathlib import Path
from typing import TypedDict


class DiscoveredServer(TypedDict):
    name: str
    command: str
    args: list[str]


def discover_servers_from_claude_code_project_config(project_dir: str) -> list[DiscoveredServer]:
    config_path = Path(project_dir) / ".mcp.json"
    if not config_path.exists():
        return []

    try:
        parsed = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        raise ValueError(f"discover_servers: {config_path} is not valid JSON: {err}") from err

    if not isinstance(parsed, dict) or "mcpServers" not in parsed:
        raise ValueError(f'discover_servers: {config_path} is missing "mcpServers"')

    mcp_servers = parsed["mcpServers"]
    if not isinstance(mcp_servers, dict):
        raise ValueError(f'discover_servers: {config_path}\'s "mcpServers" must be an object')

    servers: list[DiscoveredServer] = []
    for name, raw in mcp_servers.items():
        if not isinstance(raw, dict) or "command" not in raw:
            raise ValueError(f'discover_servers: server "{name}" in {config_path} is missing "command"')
        command = raw["command"]
        if not isinstance(command, str):
            raise ValueError(f'discover_servers: server "{name}"\'s "command" must be a string')
        args = raw.get("args")
        if args is not None and not isinstance(args, list):
            raise ValueError(f'discover_servers: server "{name}"\'s "args" must be an array')
        servers.append({"name": name, "command": command, "args": list(args) if args else []})
    return servers
