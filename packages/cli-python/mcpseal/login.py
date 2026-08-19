# Mirrors packages/cli-node/src/login.ts. build-bible.md Part 6.2:
# `mcpseal login` — device-authorization flow, ed25519 machine keypair,
# workspace API key in the OS keychain. This is the ONLY place in the free
# CLI that ever makes a network call (CLAUDE.md invariant 2) — every other
# command is fully local.
from __future__ import annotations

import json
import math
import os
import time
import uuid
from dataclasses import dataclass
from typing import Callable

from mcpseal.config import McpsealConfig, config_path as default_config_path, read_config, write_config
from mcpseal.http_client import HttpRequestFn, request as default_request
from mcpseal.keychain import set_secret
from mcpseal.machine_identity import load_or_create_machine_identity

API_KEY_ACCOUNT = "workspace-api-key"
DEFAULT_INGEST_URL = os.environ.get("MCPSEAL_INGEST_URL", "http://127.0.0.1:8787")


@dataclass
class LoginResult:
    workspaceId: str
    machineId: str


class LoginError(Exception):
    pass


def login(
    ingest_url: str | None = None,
    request_fn: HttpRequestFn | None = None,
    sleep: Callable[[float], None] | None = None,
    on_waiting_for_approval: Callable[[str], None] | None = None,
    max_polls: int | None = None,
    cfg_path: str | None = None,
) -> LoginResult:
    resolved_ingest_url = ingest_url or DEFAULT_INGEST_URL
    req = request_fn or default_request
    sleep_fn = sleep or time.sleep

    start_res = req("POST", f"{resolved_ingest_url}/v1/auth/device/start", {"content-type": "application/json"}, "{}")
    if not start_res.ok:
        raise LoginError(f"device authorization failed to start: HTTP {start_res.status}")
    start = start_res.json()

    if on_waiting_for_approval:
        on_waiting_for_approval(start["userCode"])

    resolved_max_polls = max_polls if max_polls is not None else math.ceil(start["expiresIn"] / start["interval"])
    for _ in range(resolved_max_polls):
        sleep_fn(start["interval"])
        poll_res = req(
            "POST",
            f"{resolved_ingest_url}/v1/auth/device/poll",
            {"content-type": "application/json"},
            json.dumps({"deviceCode": start["deviceCode"]}),
        )
        if not poll_res.ok:
            raise LoginError(f"device authorization poll failed: HTTP {poll_res.status}")
        poll = poll_res.json()

        if poll["status"] == "pending":
            continue
        if poll["status"] == "denied":
            raise LoginError("login was denied")
        if poll["status"] == "expired":
            raise LoginError("login code expired before it was approved")

        # approved
        identity = load_or_create_machine_identity()
        machine_id = str(uuid.uuid4())

        reg_res = req(
            "POST",
            f"{resolved_ingest_url}/v1/machines/register",
            {"content-type": "application/json", "authorization": f"Bearer {poll['apiKeyToken']}"},
            json.dumps(
                {
                    "workspaceId": poll["workspaceId"],
                    "machineId": machine_id,
                    "publicKey": identity.public_key_hex,
                    "mcpsealVersion": "0.1.0",
                }
            ),
        )
        if not reg_res.ok:
            raise LoginError(f"machine registration failed: HTTP {reg_res.status}")
        registration = reg_res.json()

        # build-bible.md Part 8.1: pin once, never silently re-pin. If a
        # config already exists with a DIFFERENT pinned key, something is
        # wrong (compromised org, or logging into a different workspace
        # without explicitly logging out first) — refuse rather than
        # quietly trusting a new key.
        resolved_cfg_path = cfg_path or default_config_path()
        existing = read_config(resolved_cfg_path)
        org_public_key = registration.get("orgPublicKey")
        if existing and existing.get("orgPublicKeyHex") and org_public_key and existing["orgPublicKeyHex"] != org_public_key:
            raise LoginError(
                "refusing to overwrite a previously pinned org signing key with a different one — "
                "run `mcpseal logout` first if this is intentional"
            )

        set_secret(API_KEY_ACCOUNT, poll["apiKeyToken"])
        config: McpsealConfig = {
            "workspaceId": poll["workspaceId"],
            "machineId": machine_id,
            "ingestUrl": resolved_ingest_url,
        }
        pinned_key = org_public_key or (existing.get("orgPublicKeyHex") if existing else None)
        if pinned_key:
            config["orgPublicKeyHex"] = pinned_key
        write_config(config, resolved_cfg_path)
        return LoginResult(workspaceId=poll["workspaceId"], machineId=machine_id)

    raise LoginError("login timed out waiting for approval")
