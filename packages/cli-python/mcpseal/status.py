# Mirrors packages/cli-node/src/status.ts. Track A: `mcpseal status` — a
# structured, offline-first snapshot of local health, kept separate from
# Control Plane connectivity (doctor.py does that probe; status never
# makes a network call).
from __future__ import annotations

import os
from dataclasses import dataclass, field

from mcpseal.config import read_config
from mcpseal.event_log import events_log_path, read_events, recent_blocks
from mcpseal.lockfile import read_lockfile


@dataclass
class LocalStatus:
    lockfilePresent: bool = False
    lockfileError: str | None = None
    serverCount: int | None = None
    toolCount: int | None = None
    proxyInstalled: bool = False
    eventCount: int = 0
    blockCount: int = 0
    recentBlocks: list[dict] = field(default_factory=list)


@dataclass
class ConnectionStatus:
    loggedIn: bool = False
    workspaceId: str | None = None
    machineId: str | None = None
    ingestUrl: str | None = None
    lastAppliedPolicyVersion: int | None = None


@dataclass
class StatusReport:
    local: LocalStatus
    connection: ConnectionStatus


def build_status_report(
    project_dir: str | None = None,
    lockfile_path: str | None = None,
    log_path: str | None = None,
    cfg_path: str | None = None,
) -> StatusReport:
    resolved_project_dir = project_dir or os.getcwd()
    resolved_lockfile_path = lockfile_path or os.path.join(resolved_project_dir, ".mcp-lock.json")

    local = LocalStatus(proxyInstalled=os.path.exists(os.path.join(resolved_project_dir, ".mcp.json.mcpseal-backup")))

    try:
        lockfile = read_lockfile(resolved_lockfile_path)
        local.lockfilePresent = True
        local.serverCount = len(lockfile["servers"])
        local.toolCount = sum(len(s["tools"]) for s in lockfile["servers"].values())
    except ValueError as err:
        local.lockfilePresent = False
        local.lockfileError = str(err)

    events = read_events(log_path)
    local.eventCount = len(events)
    local.blockCount = sum(1 for e in events if e["type"].startswith("blocked"))
    local.recentBlocks = recent_blocks(events, 10)

    config = read_config(cfg_path)
    connection = ConnectionStatus(
        loggedIn=bool(config and config.get("workspaceId") and config.get("machineId")),
        workspaceId=config.get("workspaceId") if config else None,
        machineId=config.get("machineId") if config else None,
        ingestUrl=config.get("ingestUrl") if config else None,
        lastAppliedPolicyVersion=config.get("lastAppliedPolicyVersion") if config else None,
    )

    return StatusReport(local=local, connection=connection)


def format_status_report(report: StatusReport) -> str:
    lines = ["LOCAL HEALTH"]
    if report.local.lockfilePresent:
        lines.append(f"  lockfile:  present ({report.local.serverCount} server(s), {report.local.toolCount} tool(s) pinned)")
    else:
        suffix = f" — {report.local.lockfileError}" if report.local.lockfileError else ""
        lines.append(f"  lockfile:  MISSING or invalid{suffix}")
        lines.append("             next: mcpseal init")
    lines.append(f"  proxy:     {'installed' if report.local.proxyInstalled else 'not installed — MCP servers launch unprotected'}")
    if not report.local.proxyInstalled:
        lines.append("             next: mcpseal install")
    lines.append(f"  events:    {report.local.eventCount} recorded, {report.local.blockCount} block(s) total")
    for b in report.local.recentBlocks:
        lines.append(f"    [{b['ts']}] {b['type']} — {b['server']}/{b['tool']}")

    lines.append("")
    lines.append("CONTROL PLANE")
    if report.connection.loggedIn:
        lines.append(f"  workspace: {report.connection.workspaceId} (machine {report.connection.machineId})")
        if report.connection.lastAppliedPolicyVersion is not None:
            lines.append(f"  policy:    version {report.connection.lastAppliedPolicyVersion} last applied")
        lines.append("  next:      mcpseal doctor   # checks live connectivity")
    else:
        lines.append("  not logged in — running fully local, no workspace connection.")
        lines.append("  next:      mcpseal login   # optional; local enforcement already works without it")

    return "\n".join(lines)
