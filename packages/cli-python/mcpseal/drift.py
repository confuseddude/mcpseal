# build-bible.md Part 2.4: the drift-detection state machine.
#
# Fail-closed contract (CLAUDE.md invariant 1, Tasks.md 1.6): this function
# must NEVER raise. Any internal error (malformed observed tool, missing
# server entry, etc.) is caught and converted into a "block" decision - an
# uncaught exception could be caught-and-ignored by a careless caller
# upstream and silently fail open, which is the one thing this product must
# never do.
from typing import Optional, TypedDict

from mcpseal.hash import hash_tool
from mcpseal.lockfile_schema import Lockfile


class DriftResult(TypedDict, total=False):
    decision: str  # "allow" | "block"
    reason: str
    oldHash: str
    newHash: str
    detail: str


def _block_error(detail: str) -> DriftResult:
    return {"decision": "block", "reason": "blocked_error", "detail": detail}


def check_drift(
    observed_tool: Optional[dict],
    tool_name: str,
    lockfile: Lockfile,
    server_name: str,
) -> DriftResult:
    try:
        server = lockfile["servers"].get(server_name)
        entry = server["tools"].get(tool_name) if server else None

        # Case 5: lockfile tool absent from the server's current tool list.
        if observed_tool is None:
            if entry is None:
                return _block_error(
                    f'check_drift: no observed tool and no lockfile entry for "{tool_name}" '
                    f'on server "{server_name}"'
                )
            return {"decision": "allow", "reason": "tool_removed", "oldHash": entry["hash"]}

        new_hash = hash_tool(observed_tool)

        # Case 4: tool name not in lockfile - apply onUnknownTool policy.
        if entry is None:
            block = lockfile["policy"]["onUnknownTool"] == "block"
            return {
                "decision": "block" if block else "allow",
                "reason": "blocked_unknown" if block else "allowed_unknown",
                "newHash": new_hash,
            }

        # Case 3: hash differs from the pinned lockfile hash - the rug pull.
        if new_hash != entry["hash"]:
            return {
                "decision": "block",
                "reason": "blocked_drift",
                "oldHash": entry["hash"],
                "newHash": new_hash,
                "oldDescription": entry["description"],
                "newDescription": observed_tool["description"],
            }

        # Hash matches - decision now depends on the pinned status.
        if entry["status"] == "denied":
            return {"decision": "block", "reason": "blocked_denied", "oldHash": entry["hash"], "newHash": new_hash}
        if entry["status"] == "quarantined":
            return {
                "decision": "block",
                "reason": "blocked_quarantined",
                "oldHash": entry["hash"],
                "newHash": new_hash,
            }

        # Case 1: hash matches an approved entry - forward normally.
        return {"decision": "allow", "reason": "approved", "oldHash": entry["hash"], "newHash": new_hash}
    except Exception as err:  # noqa: BLE001 - fail-closed boundary, must never propagate
        return _block_error(f"check_drift: internal error: {err}")
