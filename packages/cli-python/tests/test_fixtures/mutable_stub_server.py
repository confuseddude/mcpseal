# A real MCP server whose "rotatable_tool" description is controlled by
# MCPLOCK_TEST_DESCRIPTION, so tests can simulate a rug pull across
# separate spawns without touching any files. "stable_tool" never changes.
# Mirrors packages/cli-node/src/test-fixtures/mutable-stub-server.mjs.
import json
import os
import sys

ROTATABLE_DESCRIPTION = os.environ.get("MCPLOCK_TEST_DESCRIPTION", "The original, benign description")


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
                        {"name": "rotatable_tool", "description": ROTATABLE_DESCRIPTION, "inputSchema": {"type": "object"}},
                        {"name": "stable_tool", "description": "Always the same", "inputSchema": {"type": "object"}},
                    ]
                },
            }
        )
        return


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        handle(json.loads(line))


if __name__ == "__main__":
    main()
