# Mirrors packages/cli-node/src/ship-events.ts. build-bible.md Part
# 3.4/4.2: "The event log is what gets *optionally* shipped to the Control
# Plane if the user joins a workspace — same records, different
# destination."
#
# CLAUDE.md invariant 2 is enforced structurally here, not just by intent:
# ship_events() reads is_logged_in() FIRST and returns before doing
# anything else — including before ever constructing an HTTP request — if
# there's no config. No credentials, no config, no call. Tested explicitly
# by passing a request_fn that raises if invoked at all.
from __future__ import annotations

import json
from dataclasses import dataclass

from mcpseal.config import config_path as default_config_path, read_config, write_config
from mcpseal.event_log import McpsealEvent, events_log_path, read_events
from mcpseal.http_client import HttpRequestFn, request as default_request
from mcpseal.keychain import get_secret
from mcpseal.login import API_KEY_ACCOUNT
from mcpseal.machine_identity import PRIVATE_KEY_ACCOUNT, sign_with_machine_key

MAX_BATCH_SIZE = 500


@dataclass
class ShipResult:
    skipped: bool
    reason: str | None = None
    shipped: int = 0
    duplicates: int = 0


def _index_after(events: list[McpsealEvent], last_shipped_event_id: str) -> int:
    for i, e in enumerate(events):
        if e["eventId"] == last_shipped_event_id:
            return i + 1
    return 0


def ship_events(
    log_path: str | None = None,
    cfg_path: str | None = None,
    request_fn: HttpRequestFn | None = None,
) -> ShipResult:
    resolved_cfg_path = cfg_path or default_config_path()
    config = read_config(resolved_cfg_path)
    if not config or not config.get("workspaceId") or not config.get("machineId"):
        return ShipResult(skipped=True, reason="not logged in")

    api_key_token = get_secret(API_KEY_ACCOUNT)
    private_key_hex = get_secret(PRIVATE_KEY_ACCOUNT)
    if not api_key_token or not private_key_hex:
        return ShipResult(skipped=True, reason="missing credentials in keychain")

    resolved_log_path = log_path or events_log_path()
    all_events = read_events(resolved_log_path)
    last_shipped = config.get("lastShippedEventId")
    unshipped = all_events[_index_after(all_events, last_shipped):] if last_shipped else all_events

    if not unshipped:
        return ShipResult(skipped=False, shipped=0, duplicates=0)

    req = request_fn or default_request
    shipped_total = 0
    duplicate_total = 0

    for i in range(0, len(unshipped), MAX_BATCH_SIZE):
        batch = unshipped[i : i + MAX_BATCH_SIZE]
        body = {"machineId": config["machineId"], "workspaceId": config["workspaceId"], "batch": batch}
        raw = json.dumps(body)
        signature = sign_with_machine_key(private_key_hex, raw.encode("utf-8"))

        try:
            res = req(
                "POST",
                f"{config['ingestUrl']}/v1/events",
                {
                    "content-type": "application/json",
                    "authorization": f"Bearer {api_key_token}",
                    "x-mcpseal-signature": signature,
                },
                raw,
            )
        except Exception:
            # Leave the cursor where it is; the next call retries this
            # same batch. A shipping failure must never surface as a CLI
            # error — it's best-effort, same as local event logging.
            break

        if not res.ok:
            break

        result = res.json()
        shipped_total += result["accepted"]
        duplicate_total += result["duplicates"]

        last_event = batch[-1]
        config["lastShippedEventId"] = last_event["eventId"]
        write_config(config, resolved_cfg_path)

    return ShipResult(skipped=False, shipped=shipped_total, duplicates=duplicate_total)


# Fire-and-forget helper for call sites (e.g. the proxy's block handler)
# that must never let a shipping failure — or shipping itself — block or
# slow down the actual proxy decision.
def ship_events_best_effort(log_path: str | None = None, cfg_path: str | None = None, request_fn: HttpRequestFn | None = None) -> None:
    try:
        ship_events(log_path=log_path, cfg_path=cfg_path, request_fn=request_fn)
    except Exception:
        # Intentionally swallowed — see module comment.
        pass
