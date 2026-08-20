# Mirrors packages/cli-node/src/event-log.ts. build-bible.md Part 3.4/4.2,
# Tasks.md 2.5: local append-only event log at ~/.mcpseal/events.jsonl.
# Purely local, no account required (CLAUDE.md invariant 2).
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import TypedDict


class McpsealEvent(TypedDict, total=False):
    eventId: str
    ts: str
    type: str
    server: str
    tool: str
    observedHash: str
    expectedHash: str
    descriptionDiff: str
    clientApp: str
    mcpsealVersion: str


def events_log_path() -> str:
    return os.path.join(os.path.expanduser("~"), ".mcpseal", "events.jsonl")


def append_event(
    type_: str,
    server: str,
    tool: str,
    observed_hash: str | None = None,
    expected_hash: str | None = None,
    old_description: str | None = None,
    new_description: str | None = None,
    client_app: str = "unknown",
    log_path: str | None = None,
) -> None:
    # Best-effort: a logging failure (e.g. unwritable home directory) must
    # never break the proxy's actual block decision, which has already
    # happened by the time this is called. Callers should not treat this as
    # fail-closed.
    resolved_path = log_path or events_log_path()
    try:
        event: McpsealEvent = {
            "eventId": str(uuid.uuid4()),
            "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
            "type": type_,
            "server": server,
            "tool": tool,
            "clientApp": client_app,
            "mcpsealVersion": "0.1.1",
        }
        if observed_hash is not None:
            event["observedHash"] = observed_hash
        if expected_hash is not None:
            event["expectedHash"] = expected_hash
        if old_description is not None and new_description is not None:
            event["descriptionDiff"] = f"- {old_description}\n+ {new_description}"

        os.makedirs(os.path.dirname(resolved_path), exist_ok=True)
        with open(resolved_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event) + "\n")
    except OSError as err:
        print(f"mcpseal: warning: could not write to local event log: {err}")


def read_events(log_path: str | None = None) -> list[McpsealEvent]:
    resolved_path = log_path or events_log_path()
    if not os.path.exists(resolved_path):
        return []
    events: list[McpsealEvent] = []
    with open(resolved_path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # skip a corrupted line rather than fail the whole read
    return events


def recent_blocks(events: list[McpsealEvent], limit: int = 10) -> list[McpsealEvent]:
    blocked = [e for e in events if e["type"].startswith("blocked")]
    blocked.sort(key=lambda e: e["ts"], reverse=True)
    return blocked[:limit]
