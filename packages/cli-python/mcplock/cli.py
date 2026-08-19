#!/usr/bin/env python3
# Mirrors packages/cli-node/src/cli.ts's command surface (build-bible.md
# Part 3.2), scoped to the free-tier local-only commands: init, proxy,
# install, uninstall, scan, approve, deny, diff, status. `login` and
# `policy-pull` (Milestones 3/6 — network, OS keychain, ed25519 machine
# identity/signature verification) are deliberately NOT included in this
# pass: see NIGHT_SHIFT_LOG.md for why porting those is scoped as a
# separate follow-up rather than bundled with this one. Running `mcplock
# status` without ever having logged in still works — it just always
# reports "not logged in", since no Control Plane connection exists yet
# on the Python CLI.
from __future__ import annotations

import os
import sys

from mcplock.diff import diff_drifted, format_diff
from mcplock.event_log import append_event, read_events, recent_blocks
from mcplock.init import init as init_cmd
from mcplock.install import install as install_cmd
from mcplock.install import uninstall as uninstall_cmd
from mcplock.lockfile import read_lockfile
from mcplock.manage import set_tool_status
from mcplock.proxy import run_proxy
from mcplock.scan import scan as scan_cmd

USAGE = (
    "Unknown or missing command: {command}\n"
    "Usage: mcplock init|install|uninstall|status|scan|diff [projectDir] | "
    "mcplock proxy <serverName> <command> [args...] | "
    "mcplock approve|deny <serverName> <toolName>"
)


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    command = args[0] if args else None
    rest = args[1:]

    if command == "init":
        project_dir = rest[0] if rest else os.getcwd()
        result = init_cmd(project_dir)
        print(
            f"mcplock init: wrote {result['lockfilePath']} "
            f"({result['serverCount']} server(s), {result['toolCount']} tool(s) approved)"
        )
        return 0

    if command == "proxy":
        # Same syntax judgment call as cli-node (Tasks.md 2.2 Change Log):
        # `mcplock proxy <serverName> <command> [args...]` — `install`
        # rewrites client configs to invoke it this way.
        if len(rest) < 2:
            print("Usage: mcplock proxy <serverName> <command> [args...]", file=sys.stderr)
            return 1
        server_name, command_, *server_args = rest

        # Fail closed (CLAUDE.md invariant 1): if the lockfile can't be
        # read, refuse to start rather than proxying traffic unchecked.
        lockfile_path = os.path.join(os.getcwd(), ".mcp-lock.json")
        lockfile = read_lockfile(lockfile_path)

        def on_decision(tool_name: str, result: dict) -> None:
            if result["decision"] != "block":
                return
            print(f'mcplock: blocked tool "{tool_name}" ({result["reason"]})', file=sys.stderr)
            if result["reason"] == "blocked_drift":
                print(f"  old description: {result.get('oldDescription')}", file=sys.stderr)
                print(f"  new description: {result.get('newDescription')}", file=sys.stderr)
            append_event(
                type_=result["reason"],
                server=server_name,
                tool=tool_name,
                observed_hash=result.get("newHash"),
                expected_hash=result.get("oldHash"),
                old_description=result.get("oldDescription"),
                new_description=result.get("newDescription"),
            )
            # No event-shipping here: this CLI has no `login`/Control-Plane
            # connection yet (see module header) — CLAUDE.md invariant 2 is
            # trivially satisfied since there's no network code at all.

        handle = run_proxy(
            command_,
            server_args,
            server_name,
            lockfile,
            sys.stdin,
            sys.stdout,
            on_decision=on_decision,
        )
        handle.wait_closed()
        return 0

    if command == "install":
        project_dir = rest[0] if rest else os.getcwd()
        result = install_cmd(project_dir)
        print(f"mcplock install: rewrote {result['configPath']} ({result['serverCount']} server(s)), backup at {result['backupPath']}")
        return 0

    if command == "uninstall":
        project_dir = rest[0] if rest else os.getcwd()
        result = uninstall_cmd(project_dir)
        print(f"mcplock uninstall: restored {result['configPath']} from backup")
        return 0

    if command == "scan":
        project_dir = rest[0] if rest else os.getcwd()
        decisions = scan_cmd(project_dir)
        any_blocked = False
        for d in decisions:
            label = "BLOCK" if d["result"]["decision"] == "block" else "OK   "
            print(f"{label} {d['serverName']}/{d['toolName']} ({d['result']['reason']})")
            if d["result"]["decision"] == "block":
                any_blocked = True
        # CI-friendly (Part 3.2): non-zero exit specifically signals drift/blocks.
        return 1 if any_blocked else 0

    if command in ("approve", "deny"):
        if len(rest) < 2:
            print(f"Usage: mcplock {command} <serverName> <toolName>", file=sys.stderr)
            return 1
        server_name, tool_name = rest[0], rest[1]
        status = "approved" if command == "approve" else "denied"
        result = set_tool_status(os.getcwd(), server_name, tool_name, status)
        print(f"mcplock {command}: {result['serverName']}/{result['toolName']} is now \"{result['status']}\" ({result['hash']})")
        return 0

    if command == "diff":
        project_dir = rest[0] if rest else os.getcwd()
        diffs = diff_drifted(project_dir)
        if not diffs:
            print("mcplock diff: no drifted tools.")
            return 0
        for d in diffs:
            print(format_diff(d))
        return 0

    if command == "status":
        events = read_events()
        blocks = recent_blocks(events, 10)
        print("mcplock status: not logged in — running fully local, no workspace connection.")
        if not events:
            print("mcplock status: no events recorded yet on this machine.")
            return 0
        print(f"mcplock status: {len(events)} event(s) recorded, {len(blocks)} recent block(s):")
        for b in blocks:
            print(f"  [{b['ts']}] {b['type']} — {b['server']}/{b['tool']}")
        return 0

    print(USAGE.format(command=command or "(none)"), file=sys.stderr)
    return 1


def entrypoint() -> None:
    try:
        sys.exit(main())
    except Exception as err:  # noqa: BLE001 — top-level CLI error boundary
        print(f"mcplock: fatal error: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    entrypoint()
