# build-bible.md Part 2.3: read/write for .mcp-lock.json.
# Fail-closed path (CLAUDE.md invariant 1): a missing or malformed lockfile
# must raise, never silently return None/empty - a caller that forgets to
# handle the exception should crash loudly rather than proceed as if
# everything were unapproved (or worse, approved).
import json
from datetime import datetime, timezone
from pathlib import Path

from mcpseal.lockfile_schema import Lockfile

REQUIRED_TOP_LEVEL_KEYS = ("version", "generatedAt", "generatedBy", "servers", "policy", "signature")


def _assert_valid_lockfile_shape(value: object, path: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"read_lockfile: {path} does not contain a JSON object")
    for key in REQUIRED_TOP_LEVEL_KEYS:
        if key not in value:
            raise ValueError(f'read_lockfile: {path} is missing required field "{key}"')


def read_lockfile(path: str) -> Lockfile:
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as err:
        raise ValueError(f"read_lockfile: could not read {path}: {err}") from err

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as err:
        raise ValueError(f"read_lockfile: {path} is not valid JSON: {err}") from err

    _assert_valid_lockfile_shape(parsed, path)
    return parsed


def write_lockfile(path: str, lockfile: Lockfile) -> None:
    Path(path).write_text(json.dumps(lockfile, indent=2), encoding="utf-8")


def create_empty_lockfile(generated_by: str = "mcpseal@0.1.0") -> Lockfile:
    return {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generatedBy": generated_by,
        "servers": {},
        "policy": {
            "onDrift": "block",
            "onUnknownTool": "block",
            "allowNewToolsFromApprovedServer": False,
        },
        "signature": None,
    }
