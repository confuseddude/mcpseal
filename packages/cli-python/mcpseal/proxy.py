# Mirrors packages/cli-node/src/proxy.ts. build-bible.md Part 3.3:
# `mcpseal proxy` — the transparent stdio wrapper. Sits between the real
# MCP client (this process's stdin/stdout) and the real MCP server (a
# spawned child process), passing ordinary traffic through byte-for-byte,
# intercepting only responses that carry tool definitions.
#
# Fail-closed contract (CLAUDE.md invariant 1, Part 13): any error while
# intercepting a tools-bearing response must result in stripping the tools
# from that response, never forwarding them unfiltered. check_drift() never
# raises (mcpseal.drift); this file's own try/except exists for errors in
# the interception plumbing around it (e.g. an unexpected response shape).
from __future__ import annotations

import json
import subprocess
import threading
from typing import Any, Callable, TextIO, TypedDict

from mcpseal.drift import DriftResult, check_drift
from mcpseal.lockfile_schema import Lockfile
from mcpseal.process_utils import kill_process_tree


class ToolDecision(TypedDict):
    toolName: str
    result: DriftResult


def filter_tools_list_result(
    result: dict, lockfile: Lockfile, server_name: str
) -> tuple[dict, list[ToolDecision]]:
    """Pure, unit-testable: given a raw tools/list-shaped result, returns the
    filtered result (blocked tools removed) plus the per-tool decisions."""
    decisions: list[ToolDecision] = []
    kept: list[dict] = []

    for tool in result.get("tools", []):
        decision = check_drift(tool, tool["name"], lockfile, server_name)
        decisions.append({"toolName": tool["name"], "result": decision})
        if decision["decision"] == "allow":
            kept.append(tool)

    return {"tools": kept}, decisions


def _has_tools_array(result: Any) -> bool:
    return isinstance(result, dict) and isinstance(result.get("tools"), list)


class ProxyHandle:
    def __init__(self, proc: subprocess.Popen, output_thread: threading.Thread):
        self.proc = proc
        self._output_thread = output_thread

    def stop(self) -> None:
        kill_process_tree(self.proc)

    def wait_closed(self) -> None:
        self.proc.wait()
        self._output_thread.join(timeout=5)


def run_proxy(
    command: str,
    args: list[str],
    server_name: str,
    lockfile: Lockfile,
    input_stream: TextIO,
    output_stream: TextIO,
    cwd: str | None = None,
    on_decision: Callable[[str, DriftResult], None] | None = None,
) -> ProxyHandle:
    proc = subprocess.Popen(
        [command, *args],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=None,
        cwd=cwd,
        shell=True,
        text=True,
        bufsize=1,
    )

    # client -> child: pass every line through byte-for-byte. No
    # interception is needed in this direction — only responses (child ->
    # client) carry tool definitions.
    def pump_input() -> None:
        try:
            for line in input_stream:
                stripped = line.rstrip("\n")
                if not stripped:
                    continue
                assert proc.stdin is not None
                proc.stdin.write(stripped + "\n")
                proc.stdin.flush()
        except (ValueError, OSError):
            pass  # stream closed underneath us — the child exiting ends this too
        finally:
            try:
                if proc.stdin:
                    proc.stdin.close()
            except OSError:
                pass

    # child -> client: intercept only lines whose parsed result carries a
    # `tools` array; everything else forwarded as the exact original line.
    def pump_output() -> None:
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                stripped = line.rstrip("\n")
                if not stripped:
                    continue

                forward_line = stripped
                try:
                    msg = json.loads(stripped)
                    if isinstance(msg, dict) and _has_tools_array(msg.get("result")):
                        filtered, decisions = filter_tools_list_result(msg["result"], lockfile, server_name)
                        for d in decisions:
                            if on_decision:
                                on_decision(d["toolName"], d["result"])
                        forward_line = json.dumps({**msg, "result": filtered})
                    # else: not a tools-bearing message — forward the
                    # original line unchanged, not a re-serialization.
                except (json.JSONDecodeError, KeyError, TypeError):
                    # Not parseable JSON on a line boundary (or an
                    # unexpected shape) — pass through unchanged; it can't
                    # contain a tool list we'd need to filter.
                    pass

                output_stream.write(forward_line + "\n")
                output_stream.flush()
        except (ValueError, OSError):
            pass

    input_thread = threading.Thread(target=pump_input, daemon=True)
    output_thread = threading.Thread(target=pump_output, daemon=True)
    input_thread.start()
    output_thread.start()

    return ProxyHandle(proc, output_thread)
