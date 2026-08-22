# Mirrors packages/cli-node/src/mcp-client.ts: a minimal MCP stdio client,
# newline-delimited JSON-RPC (empirically confirmed against a real reference
# server — see docs/Tasks.md 2.1). Lives in the CLI package, not mcpseal's
# hashing/drift core, for the same reason as the TS version: spawning
# processes and speaking a wire protocol is CLI plumbing, not the
# canonical, trust-critical hashing spec.
from __future__ import annotations

import json
import subprocess
import threading
import time
from typing import Any, TypedDict

from mcpseal.process_utils import USE_SHELL, kill_process_tree
from mcpseal.version import VERSION

DEFAULT_TIMEOUT_S = 15.0


class McpToolDefinition(TypedDict, total=False):
    name: str
    description: str
    inputSchema: dict


class McpStdioClient:
    def __init__(self, command: str, args: list[str], cwd: str | None = None):
        self._proc = subprocess.Popen(
            [command, *args],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            # Forward the spawned process's stderr so diagnostics (e.g. a
            # blocked-tool log line) are visible, not silently swallowed —
            # matches the TS client piping child.stderr to process.stderr.
            stderr=None,
            cwd=cwd,
            shell=USE_SHELL,
            text=True,
            bufsize=1,
        )
        self._next_id = 1
        self._id_lock = threading.Lock()
        self._cond = threading.Condition()
        self._responses: dict[int, dict] = {}
        self._closed = False
        self._close_error: Exception | None = None
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def _read_loop(self) -> None:
        try:
            assert self._proc.stdout is not None
            for raw_line in self._proc.stdout:
                line = raw_line.rstrip("\n")
                if not line.strip():
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue  # not a JSON-RPC message we can correlate; ignore
                if not isinstance(msg, dict) or msg.get("id") is None:
                    continue  # notification, not a response to a request
                with self._cond:
                    self._responses[msg["id"]] = msg
                    self._cond.notify_all()
        except Exception:
            pass
        finally:
            with self._cond:
                self._closed = True
                if self._close_error is None:
                    self._close_error = RuntimeError("server process exited before responding")
                self._cond.notify_all()

    def _request(self, method: str, params: Any, timeout_s: float = DEFAULT_TIMEOUT_S) -> Any:
        if self._closed:
            raise self._close_error or RuntimeError("MCP client is closed")
        with self._id_lock:
            req_id = self._next_id
            self._next_id += 1
        payload = json.dumps({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params})
        assert self._proc.stdin is not None
        self._proc.stdin.write(payload + "\n")
        self._proc.stdin.flush()

        deadline = time.monotonic() + timeout_s
        with self._cond:
            while req_id not in self._responses:
                if self._closed:
                    raise self._close_error or RuntimeError("MCP client is closed")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError(f'MCP request "{method}" timed out after {timeout_s}s')
                self._cond.wait(timeout=remaining)
            msg = self._responses.pop(req_id)

        if msg.get("error"):
            err = msg["error"]
            raise RuntimeError(f"MCP server error {err.get('code')}: {err.get('message')}")
        return msg.get("result")

    def _notify(self, method: str, params: Any = None) -> None:
        if self._closed:
            return
        payload = json.dumps({"jsonrpc": "2.0", "method": method, "params": params})
        assert self._proc.stdin is not None
        self._proc.stdin.write(payload + "\n")
        self._proc.stdin.flush()

    def initialize(self) -> Any:
        result = self._request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "mcpseal", "version": VERSION},
            },
        )
        self._notify("notifications/initialized")
        return result

    def list_tools(self) -> list[McpToolDefinition]:
        result = self._request("tools/list", {})
        if isinstance(result, dict):
            return result.get("tools") or []
        return []

    def close(self) -> None:
        with self._cond:
            if self._closed:
                return
            self._closed = True
            self._cond.notify_all()
        kill_process_tree(self._proc)
