# Mirrors packages/cli-node/src/init.ts. build-bible.md Part 3.2 / Tasks.md
# 2.1: `mcpseal init` discovers MCP servers, launches each once, hashes
# every tool, writes .mcp-lock.json with everything at status:approved
# (trust-on-first-use, matching Part 2.3's example).
from __future__ import annotations

import os
from datetime import datetime, timezone

from mcpseal.command_hash import hash_command
from mcpseal.config_discovery import DiscoveredServer, discover_servers_from_claude_code_project_config
from mcpseal.hash import hash_tool
from mcpseal.lockfile import create_empty_lockfile, write_lockfile
from mcpseal.lockfile_schema import Lockfile, ServerEntry
from mcpseal.mcp_client import McpStdioClient


def _hash_one_server(server: DiscoveredServer, project_dir: str) -> ServerEntry:
    client = McpStdioClient(server["command"], server["args"], cwd=project_dir)
    try:
        client.initialize()
        tools = client.list_tools()

        tool_entries = {}
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        for tool in tools:
            hashed = hash_tool(tool)
            tool_entries[tool["name"]] = {
                "hash": hashed,
                "description": tool["description"],
                "approvedAt": now,
                "approvedBy": "local",
                "status": "approved",
            }

        return {
            "transport": "stdio",
            "command": server["command"],
            "args": server["args"],
            "commandHash": hash_command(server["command"], server["args"]),
            "tools": tool_entries,
        }
    finally:
        client.close()


def init(project_dir: str, lockfile_path: str | None = None, generated_by: str | None = None) -> dict:
    servers = discover_servers_from_claude_code_project_config(project_dir)

    lockfile: Lockfile = create_empty_lockfile(generated_by) if generated_by else create_empty_lockfile()
    tool_count = 0

    for server in servers:
        entry = _hash_one_server(server, project_dir)
        lockfile["servers"][server["name"]] = entry
        tool_count += len(entry["tools"])

    resolved_path = lockfile_path or os.path.join(project_dir, ".mcp-lock.json")
    write_lockfile(resolved_path, lockfile)

    return {
        "lockfile": lockfile,
        "lockfilePath": resolved_path,
        "serverCount": len(servers),
        "toolCount": tool_count,
    }
