#!/usr/bin/env python3
# Mirrors packages/cli-node/src/cli.ts's command surface (build-bible.md
# Part 3.2): init, proxy, install, uninstall, scan, approve, deny, diff,
# status, login, policy-pull.
from __future__ import annotations

import os
import sys
import threading

from mcplock.config import is_logged_in, read_config
from mcplock.diff import diff_drifted, format_diff
from mcplock.event_log import append_event, read_events, recent_blocks
from mcplock.init import init as init_cmd
from mcplock.install import install as install_cmd
from mcplock.install import uninstall as uninstall_cmd
from mcplock.keychain import get_secret
from mcplock.lockfile import read_lockfile
from mcplock.login import API_KEY_ACCOUNT, LoginError, login as login_cmd
from mcplock.manage import set_tool_status
from mcplock.policy_sync import pull_and_apply_policy
from mcplock.proxy import run_proxy
from mcplock.scan import scan as scan_cmd
from mcplock.ship_events import ship_events_best_effort

USAGE = (
    "Unknown or missing command: {command}\n"
    "Usage: mcplock init|install|uninstall|status|scan|diff|login|policy-pull [projectDir] | "
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
            # Opt-in only (CLAUDE.md invariant 2): ship_events_best_effort()
            # checks is_logged_in() first and is a total no-op — zero
            # network calls — if the user never ran `mcplock login`. Run in
            # a background daemon thread (not called synchronously) so a
            # shipping failure or slow network never adds latency to the
            # block itself, which has already happened by this point —
            # mirrors the TS version's fire-and-forget promise, just via a
            # thread instead of the event loop.
            threading.Thread(target=ship_events_best_effort, daemon=True).start()

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
        config = read_config()
        if config and config.get("workspaceId"):
            print(f"mcplock status: connected to workspace {config['workspaceId']} (machine {config['machineId']})")
        else:
            print("mcplock status: not logged in — running fully local, no workspace connection.")
        if not events:
            print("mcplock status: no events recorded yet on this machine.")
            return 0
        print(f"mcplock status: {len(events)} event(s) recorded, {len(blocks)} recent block(s):")
        for b in blocks:
            print(f"  [{b['ts']}] {b['type']} — {b['server']}/{b['tool']}")
        return 0

    if command == "login":
        if is_logged_in():
            print("mcplock login: already logged in. Run `mcplock logout` first to switch workspaces.")
            return 0

        def on_waiting(user_code: str) -> None:
            print(f"mcplock login: go approve this device — user code: {user_code}")
            print("mcplock login: waiting for approval...")

        try:
            result = login_cmd(on_waiting_for_approval=on_waiting)
            print(f"mcplock login: connected to workspace {result.workspaceId} (machine {result.machineId})")
            return 0
        except LoginError as err:
            print(f"mcplock login: failed — {err}", file=sys.stderr)
            return 1

    if command == "policy-pull":
        # build-bible.md Part 8.1 (Milestone 6). Fail closed on every
        # rejection path: never touches .mcp-lock.json unless the
        # signature verifies against the pinned org key AND the version
        # is newer than what's already applied.
        api_key_token = get_secret(API_KEY_ACCOUNT)
        result = pull_and_apply_policy(api_key_token=api_key_token)
        if result.outcome == "applied":
            print(f"mcplock policy-pull: applied signed policy version {result.version}")
            return 0
        if result.outcome == "no-newer-version":
            print(f"mcplock policy-pull: already on the latest policy (version {result.currentVersion})")
            return 0
        if result.outcome == "skipped-not-logged-in":
            print("mcplock policy-pull: not logged in — run `mcplock login` first")
            return 0
        if result.outcome == "skipped-no-pinned-key":
            print("mcplock policy-pull: no org signing key pinned — refusing to trust any policy. Run `mcplock login` again.", file=sys.stderr)
            return 1
        if result.outcome == "skipped-no-policy-published":
            print("mcplock policy-pull: no policy has been published for this workspace yet")
            return 0
        if result.outcome == "rejected-invalid-signature":
            print("mcplock policy-pull: REJECTED — signature verification failed. Existing lockfile left unchanged.", file=sys.stderr)
            return 1
        if result.outcome == "rejected-malformed-response":
            print("mcplock policy-pull: REJECTED — malformed response from server. Existing lockfile left unchanged.", file=sys.stderr)
            return 1
        if result.outcome == "rejected-network-error":
            print(f"mcplock policy-pull: could not reach the server ({result.message}). Existing lockfile left unchanged.", file=sys.stderr)
            return 1
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
