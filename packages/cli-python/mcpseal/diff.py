# Mirrors packages/cli-node/src/diff.ts. build-bible.md Part 3.2, Tasks.md
# 2.6: `mcpseal diff` — human-readable old-vs-new for any drifted tool.
# Only descriptions can be text-diffed (the lockfile stores description,
# not the full tool object — Tasks.md 2.3 Change Log). When the hash
# differs but the description text is identical, the change must be in
# inputSchema — say so honestly rather than fabricate a schema diff.
from __future__ import annotations

from typing import TypedDict

from mcpseal.scan import ScanDecision, scan


class DriftDiff(TypedDict):
    serverName: str
    toolName: str
    oldDescription: str
    newDescription: str
    descriptionChanged: bool
    possibleSchemaChange: bool


def diff_drifted(project_dir: str, lockfile_path: str | None = None) -> list[DriftDiff]:
    decisions: list[ScanDecision] = scan(project_dir, lockfile_path)
    diffs: list[DriftDiff] = []
    for d in decisions:
        if d["result"].get("reason") != "blocked_drift":
            continue
        old_description = d["result"].get("oldDescription", "")
        new_description = d["result"].get("newDescription", "")
        diffs.append(
            {
                "serverName": d["serverName"],
                "toolName": d["toolName"],
                "oldDescription": old_description,
                "newDescription": new_description,
                "descriptionChanged": old_description != new_description,
                "possibleSchemaChange": old_description == new_description,
            }
        )
    return diffs


def format_diff(diff: DriftDiff) -> str:
    lines = [f"{diff['serverName']}/{diff['toolName']}:"]
    if diff["descriptionChanged"]:
        lines.append(f"  - {diff['oldDescription']}")
        lines.append(f"  + {diff['newDescription']}")
    if diff["possibleSchemaChange"]:
        lines.append("  (description unchanged — the change is in inputSchema; full schema diff not available)")
    return "\n".join(lines)
