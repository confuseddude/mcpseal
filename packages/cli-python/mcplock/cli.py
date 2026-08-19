#!/usr/bin/env python3
# Mirrors packages/cli-node/src/cli.ts's command surface (build-bible.md
# Part 3.2). Track A ("wedge completion"): every command's failure output
# now goes through events.py's classify_thrown()/describe_drift_reason()/
# describe_policy_outcome() for diagnosis + consequence + remediation,
# without changing any underlying security decision or existing message
# text (several existing tests assert on those exact strings).
from __future__ import annotations

import json
import os
import sys
import threading

from mcplock.config import clear_config, is_logged_in, read_config
from mcplock.diff import diff_drifted, format_diff
from mcplock.doctor import format_doctor_report, run_doctor
from mcplock.event_log import append_event
from mcplock.events import classify_thrown, describe_drift_reason, describe_policy_outcome, format_event_block
from mcplock.init import init as init_cmd
from mcplock.install import install as install_cmd
from mcplock.install import uninstall as uninstall_cmd
from mcplock.keychain import delete_secret, get_secret
from mcplock.lockfile import read_lockfile
from mcplock.login import API_KEY_ACCOUNT, LoginError, login as login_cmd
from mcplock.machine_identity import PRIVATE_KEY_ACCOUNT
from mcplock.manage import set_tool_status
from mcplock.policy_sync import pull_and_apply_policy
from mcplock.proxy import run_proxy
from mcplock.scan import scan as scan_cmd
from mcplock.ship_events import ship_events_best_effort
from mcplock.status import build_status_report, format_status_report

USAGE = (
    "Unknown or missing command: {command}\n"
    "Usage: mcplock init|install|uninstall|status|doctor|scan|diff|login|logout|policy-pull [projectDir] [--json] | "
    "mcplock proxy <serverName> <command> [args...] | "
    "mcplock approve|deny <serverName> <toolName>"
)


def _extract_json_flag(args: list[str]) -> tuple[bool, list[str]]:
    return "--json" in args, [a for a in args if a != "--json"]


def _print_classified(err: BaseException, file=None) -> None:
    # `file` must resolve sys.stderr at CALL time, not def time -- a
    # default of `file=sys.stderr` would bind whatever sys.stderr WAS when
    # this module was first imported, which breaks output-capturing test
    # fixtures (pytest's capsys monkeypatches sys.stderr per-test) and
    # would silently write to the wrong stream after any stderr swap.
    print(format_event_block(classify_thrown(err)), file=file or sys.stderr)


def main(argv: list[str] | None = None) -> int:
    raw_args = argv if argv is not None else sys.argv[1:]
    command = raw_args[0] if raw_args else None
    json_flag, rest = _extract_json_flag(raw_args[1:])

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
        try:
            lockfile = read_lockfile(lockfile_path)
        except ValueError as err:
            _print_classified(err)
            return 1

        def on_decision(tool_name: str, result: dict) -> None:
            if result["decision"] != "block":
                return
            desc = describe_drift_reason(result["reason"])
            extra = {"server": server_name, "tool": tool_name, "expected": result.get("oldHash"), "observed": result.get("newHash")}
            if result["reason"] == "blocked_drift":
                extra["old description"] = result.get("oldDescription")
                extra["new description"] = result.get("newDescription")
            print(format_event_block(desc, extra), file=sys.stderr)
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
        any_blocked = any(d["result"]["decision"] == "block" for d in decisions)
        if json_flag:
            rows = []
            for d in decisions:
                desc = describe_drift_reason(d["result"]["reason"])
                rows.append(
                    {
                        "server": d["serverName"],
                        "tool": d["toolName"],
                        "decision": d["result"]["decision"],
                        "reason": d["result"]["reason"],
                        "code": desc.code,
                        "severity": desc.severity,
                    }
                )
            print(json.dumps({"decisions": rows, "blocked": any_blocked}, indent=2))
        else:
            for d in decisions:
                label = "BLOCK" if d["result"]["decision"] == "block" else "OK   "
                print(f"{label} {d['serverName']}/{d['toolName']} ({d['result']['reason']})")
                if d["result"]["decision"] == "block":
                    desc = describe_drift_reason(d["result"]["reason"])
                    if desc.remediation:
                        print(f"      next: {desc.remediation[0]}")
        # CI-friendly (Part 3.2): non-zero exit specifically signals drift/blocks.
        return 1 if any_blocked else 0

    if command in ("approve", "deny"):
        if len(rest) < 2:
            print(f"Usage: mcplock {command} <serverName> <toolName>", file=sys.stderr)
            return 1
        server_name, tool_name = rest[0], rest[1]
        status = "approved" if command == "approve" else "denied"
        try:
            result = set_tool_status(os.getcwd(), server_name, tool_name, status)
        except ValueError as err:
            _print_classified(err)
            return 1
        # Approve/deny only ever change the LOCAL lockfile — say so
        # explicitly so this is never confused with organization-wide
        # policy, which only an admin can push via the Control Plane and
        # `mcplock policy-pull`.
        print(
            f"mcplock {command}: {result['serverName']}/{result['toolName']} is now "
            f"\"{result['status']}\" ({result['hash']}) — local lockfile only, not organization policy"
        )
        return 0

    if command == "diff":
        project_dir = rest[0] if rest else os.getcwd()
        diffs = diff_drifted(project_dir)
        if not diffs:
            print("mcplock diff: no drifted tools.")
            return 0
        for d in diffs:
            print(format_diff(d))
            print("  next:")
            print(f"    mcplock approve {d['serverName']} {d['toolName']}   # only after reviewing the change above")
            print(f"    mcplock deny {d['serverName']} {d['toolName']}")
            print("")
        return 0

    if command == "status":
        report = build_status_report(os.getcwd())
        if json_flag:
            print(json.dumps(_status_to_dict(report), indent=2))
        else:
            print(format_status_report(report))
        return 0

    if command == "doctor":
        report = run_doctor(os.getcwd())
        if json_flag:
            print(json.dumps(_doctor_to_dict(report), indent=2))
        else:
            print(format_doctor_report(report))
        # Only local-health failures affect the exit code — Control Plane
        # unreachability is never a doctor failure (offline-first: Part 13).
        return 0 if report.allLocalOk else 1

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
            _print_classified(err)
            return 1

    if command == "logout":
        # Reverses login: clears the non-secret config AND both keychain
        # secrets (the workspace API key and the machine's ed25519 private
        # key). A fresh `mcplock login` afterward creates a brand-new
        # machine identity rather than reusing a possibly-compromised one.
        clear_config()
        delete_secret(API_KEY_ACCOUNT)
        delete_secret(PRIVATE_KEY_ACCOUNT)
        print("mcplock logout: cleared workspace connection and local credentials. Local enforcement is unaffected.")
        return 0

    if command == "policy-pull":
        # build-bible.md Part 8.1 (Milestone 6). Fail closed on every
        # rejection path: never touches .mcp-lock.json unless the
        # signature verifies against the pinned org key AND the version
        # is newer than what's already applied.
        api_key_token = get_secret(API_KEY_ACCOUNT)
        result = pull_and_apply_policy(api_key_token=api_key_token)
        desc = describe_policy_outcome(result.outcome)
        is_rejection = result.outcome.startswith("rejected") or result.outcome == "skipped-no-pinned-key"
        extra = None
        if result.outcome == "applied":
            extra = {"version": str(result.version)}
        elif result.outcome == "no-newer-version":
            extra = {"current version": str(result.currentVersion)}
        elif result.outcome == "rejected-network-error":
            extra = {"detail": result.message}
        line = format_event_block(desc, extra)
        if is_rejection:
            print(line, file=sys.stderr)
            return 1
        print(line)
        return 0

    print(USAGE.format(command=command or "(none)"), file=sys.stderr)
    return 1


def _status_to_dict(report) -> dict:
    return {
        "local": {
            "lockfilePresent": report.local.lockfilePresent,
            "lockfileError": report.local.lockfileError,
            "serverCount": report.local.serverCount,
            "toolCount": report.local.toolCount,
            "proxyInstalled": report.local.proxyInstalled,
            "eventCount": report.local.eventCount,
            "blockCount": report.local.blockCount,
            "recentBlocks": report.local.recentBlocks,
        },
        "connection": {
            "loggedIn": report.connection.loggedIn,
            "workspaceId": report.connection.workspaceId,
            "machineId": report.connection.machineId,
            "ingestUrl": report.connection.ingestUrl,
            "lastAppliedPolicyVersion": report.connection.lastAppliedPolicyVersion,
        },
    }


def _doctor_to_dict(report) -> dict:
    return {
        "checks": [
            {"name": c.name, "category": c.category, "ok": c.ok, "detail": c.detail, "remediation": c.remediation}
            for c in report.checks
        ],
        "allLocalOk": report.allLocalOk,
    }


def entrypoint() -> None:
    try:
        sys.exit(main())
    except Exception as err:  # noqa: BLE001 — top-level CLI error boundary
        _print_classified(err)
        sys.exit(1)


if __name__ == "__main__":
    entrypoint()
