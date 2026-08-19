# Mirrors packages/cli-node/src/config.ts. Non-secret local state for the
# opted-in workspace connection (build-bible.md Part 6.2/4.2). Everything
# secret (the workspace API key, the machine's ed25519 private key) lives
# in the OS keychain (keychain.py), never here.
from __future__ import annotations

import json
import os
from typing import TypedDict


class McplockConfig(TypedDict, total=False):
    workspaceId: str
    machineId: str
    ingestUrl: str
    lastShippedEventId: str
    # build-bible.md Part 8.1: "the client pins the org's public key at
    # login." Once set, this value must never be silently overwritten by a
    # later login — see login.py's pinning check.
    orgPublicKeyHex: str
    lastAppliedPolicyVersion: int


def config_path() -> str:
    return os.path.join(os.path.expanduser("~"), ".mcplock", "config.json")


# Absence of this file (or of a config entirely) is the CLI's definition of
# "not logged in" — CLAUDE.md invariant 2 depends on this being reliably
# checkable before anything ever touches the network.
def read_config(cfg_path: str | None = None) -> McplockConfig | None:
    resolved = cfg_path or config_path()
    if not os.path.exists(resolved):
        return None
    try:
        with open(resolved, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def write_config(config: McplockConfig, cfg_path: str | None = None) -> None:
    resolved = cfg_path or config_path()
    os.makedirs(os.path.dirname(resolved), exist_ok=True)
    with open(resolved, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)


def clear_config(cfg_path: str | None = None) -> None:
    resolved = cfg_path or config_path()
    if os.path.exists(resolved):
        with open(resolved, "w", encoding="utf-8") as f:
            f.write("{}")


def is_logged_in(cfg_path: str | None = None) -> bool:
    cfg = read_config(cfg_path)
    return bool(cfg and cfg.get("workspaceId") and cfg.get("machineId"))
