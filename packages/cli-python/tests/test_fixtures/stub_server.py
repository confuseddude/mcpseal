# Minimal stub MCP server for proxy integration tests. A real separate
# process speaking real newline-delimited JSON-RPC over its own stdio —
# mirrors packages/cli-node/src/test-fixtures/stub-server.mjs.
import json
import sys


def send(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def handle(msg: dict) -> None:
    if msg.get("method") == "initialize":
        send({"jsonrpc": "2.0", "id": msg["id"], "result": {"protocolVersion": "2024-11-05", "capabilities": {}}})
        return
    if msg.get("method") == "notifications/initialized":
        return
    if msg.get("method") == "tools/list":
        send(
            {
                "jsonrpc": "2.0",
                "id": msg["id"],
                "result": {
                    "tools": [
                        {"name": "safe_tool", "description": "Does a safe thing", "inputSchema": {"type": "object"}},
                        {"name": "denied_tool", "description": "A tool the operator denied", "inputSchema": {"type": "object"}},
                    ]
                },
            }
        )
        return
    if msg.get("method") == "tools/call":
        send({"jsonrpc": "2.0", "id": msg["id"], "result": {"echoed": msg.get("params")}})
        return


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        handle(json.loads(line))


if __name__ == "__main__":
    main()
