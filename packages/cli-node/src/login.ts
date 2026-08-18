// build-bible.md Part 6.2: `mcplock login` — device-authorization flow,
// ed25519 machine keypair, workspace API key in the OS keychain. This is
// the ONLY place in the free CLI that ever makes a network call
// (CLAUDE.md invariant 2) — every other command is fully local.
import { randomUUID } from "node:crypto";
import { setSecret } from "./keychain.js";
import { loadOrCreateMachineIdentity } from "./machine-identity.js";
import { writeConfig, configPath as defaultConfigPath, type McplockConfig } from "./config.js";

export const API_KEY_ACCOUNT = "workspace-api-key";
export const DEFAULT_INGEST_URL = process.env.MCPLOCK_INGEST_URL ?? "http://127.0.0.1:8787";

export interface LoginOptions {
  ingestUrl?: string;
  // Injectable for tests; defaults to the real fetch.
  fetchImpl?: typeof fetch;
  // Injectable for tests; defaults to real timers.
  sleep?: (ms: number) => Promise<void>;
  onWaitingForApproval?: (userCode: string) => void;
  maxPolls?: number;
  cfgPath?: string;
}

export interface LoginResult {
  workspaceId: string;
  machineId: string;
}

export async function login(opts: LoginOptions = {}): Promise<LoginResult> {
  const ingestUrl = opts.ingestUrl ?? DEFAULT_INGEST_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const startRes = await fetchImpl(`${ingestUrl}/v1/auth/device/start`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (!startRes.ok) throw new Error(`device authorization failed to start: HTTP ${startRes.status}`);
  const start = (await startRes.json()) as { deviceCode: string; userCode: string; expiresIn: number; interval: number };

  opts.onWaitingForApproval?.(start.userCode);

  const maxPolls = opts.maxPolls ?? Math.ceil(start.expiresIn / start.interval);
  for (let i = 0; i < maxPolls; i++) {
    await sleep(start.interval * 1000);
    const pollRes = await fetchImpl(`${ingestUrl}/v1/auth/device/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: start.deviceCode }),
    });
    if (!pollRes.ok) throw new Error(`device authorization poll failed: HTTP ${pollRes.status}`);
    const poll = (await pollRes.json()) as
      | { status: "pending" }
      | { status: "denied" }
      | { status: "expired" }
      | { status: "approved"; apiKeyToken: string; workspaceId: string };

    if (poll.status === "pending") continue;
    if (poll.status === "denied") throw new Error("login was denied");
    if (poll.status === "expired") throw new Error("login code expired before it was approved");

    // approved
    const identity = loadOrCreateMachineIdentity();
    const machineId = randomUUID();

    const regRes = await fetchImpl(`${ingestUrl}/v1/machines/register`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${poll.apiKeyToken}` },
      body: JSON.stringify({ workspaceId: poll.workspaceId, machineId, publicKey: identity.publicKeyHex, mcplockVersion: "0.1.0" }),
    });
    if (!regRes.ok) throw new Error(`machine registration failed: HTTP ${regRes.status}`);

    setSecret(API_KEY_ACCOUNT, poll.apiKeyToken);
    const config: McplockConfig = { workspaceId: poll.workspaceId, machineId, ingestUrl };
    writeConfig(config, opts.cfgPath ?? defaultConfigPath());
    return { workspaceId: poll.workspaceId, machineId };
  }

  throw new Error("login timed out waiting for approval");
}
