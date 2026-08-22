# Mirrors packages/cli-node/src/manage.ts. build-bible.md Part 3.2,
# docs/Tasks.md 2.6: `mcpseal approve <tool>` / `mcpseal deny <tool>`. Both
# re-fetch the tool's CURRENT live definition and write hash + description
# into the lockfile with the new status (docs/Tasks.md Change Log design note —
# uniformly covers quarantined/unknown/drifted without separate code paths).
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import TypedDict

from mcpseal.command_hash import hash_command
from mcpseal.config_discovery import discover_servers_from_claude_code_project_config
from mcpseal.hash import hash_tool
from mcpseal.lockfile import read_lockfile, write_lockfile
from mcpseal.mcp_client import McpStdioClient


class SetToolStatusResult(TypedDict):
    serverName: str
    toolName: str
    status: str
    hash: str


def set_tool_status(
    project_dir: str,
    server_name: str,
    tool_name: str,
    status: str,
    lockfile_path: str | None = None,
) -> SetToolStatusResult:
    resolved_lockfile_path = lockfile_path or os.path.join(project_dir, ".mcp-lock.json")
    servers = discover_servers_from_claude_code_project_config(project_dir)
    server = next((s for s in servers if s["name"] == server_name), None)
    if server is None:
        raise ValueError(f'set_tool_status: server "{server_name}" is not in this project\'s .mcp.json')

    client = McpStdioClient(server["command"], server["args"], cwd=project_dir)
    tool = None
    try:
        client.initialize()
        live_tools = client.list_tools()
        tool = next((t for t in live_tools if t["name"] == tool_name), None)
    finally:
        client.close()
    if tool is None:
        raise ValueError(f'set_tool_status: tool "{tool_name}" was not found on server "{server_name}"\'s current tool list')

    lockfile = read_lockfile(resolved_lockfile_path)
    if server_name not in lockfile["servers"]:
        lockfile["servers"][server_name] = {
            "transport": "stdio",
            "command": server["command"],
            "args": server["args"],
            "commandHash": hash_command(server["command"], server["args"]),
            "tools": {},
        }

    hashed = hash_tool(tool)
    lockfile["servers"][server_name]["tools"][tool_name] = {
        "hash": hashed,
        "description": tool["description"],
        "approvedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "approvedBy": "local",
        "status": status,
    }

    write_lockfile(resolved_lockfile_path, lockfile)
    return {"serverName": server_name, "toolName": tool_name, "status": status, "hash": hashed}
