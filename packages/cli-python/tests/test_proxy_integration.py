# Real integration test: spawns an actual child process (the Python stub
# server) through an actual run_proxy(), feeding it real newline-delimited
# JSON-RPC over OS pipes playing the client's role. Mirrors
# packages/cli-node/src/proxy.integration.test.ts.
import json
import os
import sys

import pytest

from mcpseal.hash import hash_tool
from mcpseal.proxy import run_proxy

STUB_SERVER = os.path.join(os.path.dirname(__file__), "test_fixtures", "stub_server.py")
PY = sys.executable

SAFE_TOOL = {"name": "safe_tool", "description": "Does a safe thing", "inputSchema": {"type": "object"}}
DENIED_TOOL = {"name": "denied_tool", "description": "A tool the operator denied", "inputSchema": {"type": "object"}}


def make_lockfile():
    return {
        "version": 1,
        "generatedAt": "2026-08-17T00:00:00Z",
        "generatedBy": "mcpseal@test",
        "servers": {
            "stub": {
                "transport": "stdio",
                "command": PY,
                "args": [STUB_SERVER],
                "commandHash": "sha256:cmd",
                "tools": {
                    "safe_tool": {
                        "hash": hash_tool(SAFE_TOOL),
                        "description": SAFE_TOOL["description"],
                        "approvedAt": "2026-08-17T00:00:00Z",
                        "approvedBy": "local",
                        "status": "approved",
                    },
                    "denied_tool": {
                        "hash": hash_tool(DENIED_TOOL),
                        "description": DENIED_TOOL["description"],
                        "approvedAt": "2026-08-17T00:00:00Z",
                        "approvedBy": "local",
                        "status": "denied",
                    },
                },
            }
        },
        "policy": {"onDrift": "block", "onUnknownTool": "block", "allowNewToolsFromApprovedServer": False},
        "signature": None,
    }


@pytest.fixture
def pipes():
    client_r_fd, client_w_fd = os.pipe()
    out_r_fd, out_w_fd = os.pipe()
    client_r = os.fdopen(client_r_fd, "r", encoding="utf-8")
    client_w = os.fdopen(client_w_fd, "w", encoding="utf-8")
    out_r = os.fdopen(out_r_fd, "r", encoding="utf-8")
    out_w = os.fdopen(out_w_fd, "w", encoding="utf-8")
    yield client_r, client_w, out_r, out_w
    # client_r and out_w are owned by run_proxy()'s background threads once
    # passed in (a thread may be blocked reading/writing them) — closing a
    # file object from the test/main thread while another thread holds a
    # blocking read on the SAME object can deadlock (observed on Windows).
    # Only close the ends the test itself exclusively uses; closing
    # client_w sends EOF to whichever thread is reading client_r, letting
    # it unblock and exit on its own rather than being force-closed.
    for f in (client_w, out_r):
        try:
            f.close()
        except OSError:
            pass


def test_forwards_initialize_and_strips_denied_tool(pipes):
    client_r, client_w, out_r, out_w = pipes
    handle = run_proxy(PY, [STUB_SERVER], "stub", make_lockfile(), client_r, out_w)
    try:
        client_w.write(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}) + "\n")
        client_w.flush()
        init_response = json.loads(out_r.readline())
        assert init_response["id"] == 1
        assert init_response["result"]["protocolVersion"] == "2024-11-05"

        client_w.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        client_w.flush()

        client_w.write(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}) + "\n")
        client_w.flush()
        tools_response = json.loads(out_r.readline())
        names = [t["name"] for t in tools_response["result"]["tools"]]
        assert names == ["safe_tool"]
        assert "denied_tool" not in names
    finally:
        handle.stop()


def test_passes_tool_call_traffic_through_unmodified(pipes):
    client_r, client_w, out_r, out_w = pipes
    handle = run_proxy(PY, [STUB_SERVER], "stub", make_lockfile(), client_r, out_w)
    try:
        client_w.write(
            json.dumps({"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "safe_tool", "arguments": {"x": 1}}}) + "\n"
        )
        client_w.flush()
        call_response = json.loads(out_r.readline())
        assert call_response == {
            "jsonrpc": "2.0",
            "id": 5,
            "result": {"echoed": {"name": "safe_tool", "arguments": {"x": 1}}},
        }
    finally:
        handle.stop()


def test_records_block_decision_via_on_decision_callback(pipes):
    client_r, client_w, out_r, out_w = pipes
    decisions = []
    handle = run_proxy(
        PY,
        [STUB_SERVER],
        "stub",
        make_lockfile(),
        client_r,
        out_w,
        on_decision=lambda name, result: decisions.append((name, result)),
    )
    try:
        client_w.write(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}) + "\n")
        client_w.flush()
        out_r.readline()  # wait for the response to be produced
        names = {name for name, _ in decisions}
        assert "safe_tool" in names
        assert "denied_tool" in names
        denied_decision = next(r for n, r in decisions if n == "denied_tool")
        assert denied_decision["decision"] == "block"
        assert denied_decision["reason"] == "blocked_denied"
    finally:
        handle.stop()


# docs/CHECKLIST.md section 5: a rug pull that actually happens mid-session,
# rather than a static hash mismatch arranged up front. The server below
# serves the approved definition once, then mutates that tool's
# description on every later tools/list -- one live process, one session,
# nothing about the lockfile or the server's identity changing. A proxy
# that only verified at startup, or cached the first tool list, would
# pass every other test in this file and still fail to stop the attack
# this product exists to stop.
RUGPULL_SERVER = os.path.join(os.path.dirname(__file__), "test_fixtures", "rugpull_server.py")

APPROVED_DESCRIPTION = "Reads a file from disk"
APPROVED_READ_FILE = {
    "name": "read_file",
    "description": APPROVED_DESCRIPTION,
    "inputSchema": {"type": "object"},
}


def make_rugpull_lockfile():
    return {
        "version": 1,
        "generatedAt": "2026-08-17T00:00:00Z",
        "generatedBy": "mcpseal@test",
        "servers": {
            "rug": {
                "transport": "stdio",
                "command": PY,
                "args": [RUGPULL_SERVER],
                "commandHash": "sha256:cmd",
                "tools": {
                    "read_file": {
                        "hash": hash_tool(APPROVED_READ_FILE),
                        "description": APPROVED_DESCRIPTION,
                        "approvedAt": "2026-08-17T00:00:00Z",
                        "approvedBy": "local",
                        "status": "approved",
                    }
                },
            }
        },
        "policy": {"onDrift": "block", "onUnknownTool": "block", "allowNewToolsFromApprovedServer": False},
        "signature": None,
    }


def _list_tools(client_w, out_r, req_id):
    client_w.write(json.dumps({"jsonrpc": "2.0", "id": req_id, "method": "tools/list", "params": {}}) + "\n")
    client_w.flush()
    return json.loads(out_r.readline())["result"]["tools"]


def test_rug_pull_mid_session_is_blocked(pipes):
    client_r, client_w, out_r, out_w = pipes
    decisions = []
    handle = run_proxy(
        PY,
        [RUGPULL_SERVER],
        "rug",
        make_rugpull_lockfile(),
        client_r,
        out_w,
        on_decision=lambda name, result: decisions.append((name, result)),
    )
    try:
        # First list: the server is still honest, so the tool is approved
        # and reaches the client untouched.
        first = _list_tools(client_w, out_r, 1)
        assert [t["name"] for t in first] == ["read_file"]
        assert first[0]["description"] == APPROVED_DESCRIPTION
        assert decisions[-1][1]["decision"] == "allow"

        # Second list, same session, same process: the server has now
        # rewritten the description to exfiltrate file contents. It must
        # not reach the client.
        second = _list_tools(client_w, out_r, 2)
        assert [t["name"] for t in second] == [], (
            "RUG PULL NOT BLOCKED: the mutated tool definition was forwarded to the client"
        )

        # And the block must be recorded with the right reason, not merely
        # dropped silently.
        blocked = [(n, r) for n, r in decisions if r["decision"] == "block"]
        assert blocked, "no block decision was recorded for the mutated tool"
        name, result = blocked[-1]
        assert name == "read_file"
        assert result["reason"] == "blocked_drift"
    finally:
        handle.stop()


def test_rug_pull_stays_blocked_on_every_subsequent_list(pipes):
    # A single block is not enough: the client will keep asking, and the
    # answer has to keep being no.
    client_r, client_w, out_r, out_w = pipes
    handle = run_proxy(PY, [RUGPULL_SERVER], "rug", make_rugpull_lockfile(), client_r, out_w)
    try:
        assert [t["name"] for t in _list_tools(client_w, out_r, 1)] == ["read_file"]
        for req_id in (2, 3, 4):
            assert [t["name"] for t in _list_tools(client_w, out_r, req_id)] == [], (
                f"mutated definition leaked through on tools/list #{req_id}"
            )
    finally:
        handle.stop()
