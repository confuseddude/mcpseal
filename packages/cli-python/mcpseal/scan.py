# Mirrors packages/cli-node/src/scan.ts. build-bible.md Part 3.2, Tasks.md
# 2.6: `mcpseal scan` — one-shot re-hash of all currently configured tools
# against the lockfile, CI-friendly (non-zero exit on any drift/block).
from __future__ import annotations

import os
from typing import TypedDict

from mcpseal.config_discovery import discover_servers_from_claude_code_project_config
from mcpseal.drift import DriftResult, check_drift
from mcpseal.lockfile import read_lockfile
from mcpseal.mcp_client import McpStdioClient


class ScanDecision(TypedDict):
    serverName: str
    toolName: str
    result: DriftResult


def scan(project_dir: str, lockfile_path: str | None = None) -> list[ScanDecision]:
    resolved_lockfile_path = lockfile_path or os.path.join(project_dir, ".mcp-lock.json")
    lockfile = read_lockfile(resolved_lockfile_path)
    servers = discover_servers_from_claude_code_project_config(project_dir)

    decisions: list[ScanDecision] = []

    for server in servers:
        client = McpStdioClient(server["command"], server["args"], cwd=project_dir)
        try:
            client.initialize()
            live_tools = client.list_tools()
            live_names = {t["name"] for t in live_tools}

            for tool in live_tools:
                decisions.append(
                    {
                        "serverName": server["name"],
                        "toolName": tool["name"],
                        "result": check_drift(tool, tool["name"], lockfile, server["name"]),
                    }
                )

            # Case 5 (Part 2.4): lockfile tools no longer present on the live server.
            server_entry = lockfile["servers"].get(server["name"])
            lockfile_tools = server_entry["tools"] if server_entry else {}
            for tool_name in lockfile_tools:
                if tool_name not in live_names:
                    decisions.append(
                        {
                            "serverName": server["name"],
                            "toolName": tool_name,
                            "result": check_drift(None, tool_name, lockfile, server["name"]),
                        }
                    )
        finally:
            client.close()

    return decisions
