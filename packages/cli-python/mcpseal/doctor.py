# Mirrors packages/cli-node/src/doctor.ts. Track A: `mcpseal doctor` — a
# read-only diagnostic of the local installation, ending with a
# best-effort, short-timeout, non-fatal Control Plane reachability probe.
# Never repairs anything automatically.
from __future__ import annotations

import os
from dataclasses import dataclass, field

from mcpseal.config import read_config
from mcpseal.config_discovery import discover_servers_from_claude_code_project_config
from mcpseal.event_log import events_log_path, read_events
from mcpseal.http_client import HttpRequestFn, request as default_request
from mcpseal.keychain import get_secret
from mcpseal.lockfile import read_lockfile


@dataclass
class DoctorCheck:
    name: str
    category: str  # "local" | "control-plane"
    ok: bool
    detail: str
    remediation: list[str] | None = None


@dataclass
class DoctorReport:
    checks: list[DoctorCheck] = field(default_factory=list)
    allLocalOk: bool = True


def run_doctor(
    project_dir: str | None = None,
    lockfile_path: str | None = None,
    log_path: str | None = None,
    cfg_path: str | None = None,
    request_fn: HttpRequestFn | None = None,
    timeout_s: float = 3.0,
) -> DoctorReport:
    resolved_project_dir = project_dir or os.getcwd()
    checks: list[DoctorCheck] = []

    try:
        servers = discover_servers_from_claude_code_project_config(resolved_project_dir)
        checks.append(
            DoctorCheck(
                category="local",
                name="MCP configuration",
                ok=True,
                detail=("no .mcp.json found (or it defines zero servers)" if len(servers) == 0 else f"{len(servers)} server(s) configured in .mcp.json"),
            )
        )
    except ValueError as err:
        checks.append(
            DoctorCheck(
                category="local",
                name="MCP configuration",
                ok=False,
                detail=str(err),
                remediation=['Fix .mcp.json\'s JSON syntax/shape (each server entry needs a "command").'],
            )
        )

    resolved_lockfile_path = lockfile_path or os.path.join(resolved_project_dir, ".mcp-lock.json")
    try:
        lockfile = read_lockfile(resolved_lockfile_path)
        server_count = len(lockfile["servers"])
        tool_count = sum(len(s["tools"]) for s in lockfile["servers"].values())
        checks.append(DoctorCheck(category="local", name="Lockfile", ok=True, detail=f"{server_count} server(s), {tool_count} tool(s) pinned"))
    except ValueError as err:
        checks.append(DoctorCheck(category="local", name="Lockfile", ok=False, detail=str(err), remediation=["mcpseal init"]))

    backup_path = os.path.join(resolved_project_dir, ".mcp.json.mcpseal-backup")
    installed = os.path.exists(backup_path)
    checks.append(
        DoctorCheck(
            category="local",
            name="Proxy installed",
            ok=installed,
            detail="MCP servers route through mcpseal proxy" if installed else "MCP servers launch directly — unprotected",
            remediation=None if installed else ["mcpseal install"],
        )
    )

    try:
        events = read_events(log_path)
        checks.append(
            DoctorCheck(
                category="local",
                name="Local event log",
                ok=True,
                detail=f"readable ({len(events)} event(s)) at {log_path or events_log_path()}",
            )
        )
    except OSError as err:
        checks.append(DoctorCheck(category="local", name="Local event log", ok=False, detail=str(err)))

    try:
        secret = get_secret("machine-private-key")
        checks.append(
            DoctorCheck(
                category="local",
                name="OS keychain",
                ok=True,
                detail="reachable — machine identity present" if secret else "reachable — no machine identity yet (not logged in)",
            )
        )
    except Exception as err:  # noqa: BLE001 — a backend failure here is itself the diagnostic
        checks.append(
            DoctorCheck(
                category="local",
                name="OS keychain",
                ok=False,
                detail=str(err),
                remediation=["Check that your OS keychain/credential manager is available (Windows Credential Manager / macOS Keychain / a Secret Service on Linux)."],
            )
        )

    config = read_config(cfg_path)
    if not config or not config.get("workspaceId"):
        checks.append(
            DoctorCheck(category="control-plane", name="Control Plane", ok=True, detail="not logged in — local enforcement remains fully active without it")
        )
    else:
        req = request_fn or default_request
        try:
            res = req("GET", f"{config['ingestUrl']}/healthz", {}, None)
            checks.append(
                DoctorCheck(
                    category="control-plane",
                    name="Control Plane",
                    ok=res.ok,
                    detail=(f"reachable at {config['ingestUrl']}" if res.ok else f"responded with HTTP {res.status}"),
                    remediation=None if res.ok else ["Local enforcement remains active regardless of Control Plane status."],
                )
            )
        except Exception as err:  # noqa: BLE001 — any transport failure is a diagnosable, non-fatal check result
            checks.append(
                DoctorCheck(
                    category="control-plane",
                    name="Control Plane",
                    ok=False,
                    detail=f"unreachable: {err}",
                    remediation=[
                        "Local enforcement remains active regardless — this only affects org visibility and policy sync.",
                        "Events recorded while offline are retained locally and shipped once connectivity returns.",
                    ],
                )
            )

    all_local_ok = all(c.ok for c in checks if c.category == "local")
    return DoctorReport(checks=checks, allLocalOk=all_local_ok)


def format_doctor_report(report: DoctorReport) -> str:
    lines = ["MCPSEAL DOCTOR", ""]
    for c in report.checks:
        mark = "✔" if c.ok else "⚠"
        lines.append(f"{mark} {c.name}")
        lines.append(f"    {c.detail}")
        if not c.ok and c.remediation:
            for r in c.remediation:
                lines.append(f"    next: {r}")
    lines.append("")
    lines.append("Local enforcement: healthy." if report.allLocalOk else "Local enforcement: DEGRADED — see the checks above marked with a warning.")
    return "\n".join(lines)
