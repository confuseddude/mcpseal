// Device-authorization flow (build-bible Part 6.2): "the CLI shows a code,
// the user approves it in the already-authenticated Dashboard, and the CLI
// receives a workspace API key."
//
// MOCK: the Dashboard (Milestone 4) doesn't exist yet, so there is nothing
// for a human to click "approve" in. The production approve step —
// POST /v1/auth/device/approve, called by an authenticated Dashboard
// session — is implemented for real below. For local/dev use without a
// dashboard, set MCPLOCK_DEV_AUTO_APPROVE_DEVICE=1 on the ingest server to
// have it call the same approve() function immediately after a device code
// is issued, standing in for the human click. This is clearly a dev-only
// substitute, not a security shortcut: the approve endpoint itself performs
// no different checks in dev vs prod, only *who calls it* differs.
import { randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { generateApiKey, hashSecret } from "./crypto.js";
import { insertApiKey } from "./db.js";

const DEVICE_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface DeviceStartResult {
  deviceCode: string;
  userCode: string;
  expiresIn: number;
  interval: number;
}

// Note: no workspaceId parameter — at start time the CLI is still
// anonymous, so which workspace this login joins isn't known yet (Part
// 6.2: "the user approves it in the already-authenticated Dashboard").
export function startDeviceFlow(db: Database.Database): DeviceStartResult {
  const deviceCode = randomUUID();
  const userCode = randomBytes(3).toString("hex").toUpperCase();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEVICE_CODE_TTL_MS);
  db.prepare(
    `INSERT INTO device_codes (device_code, user_code, workspace_id, status, created_at, expires_at)
     VALUES (?, ?, NULL, 'pending', ?, ?)`
  ).run(deviceCode, userCode, now.toISOString(), expiresAt.toISOString());
  return { deviceCode, userCode, expiresIn: DEVICE_CODE_TTL_MS / 1000, interval: 2 };
}

// Called by an authenticated Dashboard session in production — workspaceId
// comes from THAT session's org, not from the CLI — or by the dev
// auto-approve path locally with a hardcoded dev workspace. Either way this
// is the only function that flips a device code to approved; there is one
// code path, not two.
export function approveDeviceCode(db: Database.Database, userCode: string, workspaceId: string): boolean {
  const row = db.prepare("SELECT * FROM device_codes WHERE user_code = ?").get(userCode) as
    | { device_code: string; status: string; expires_at: string }
    | undefined;
  if (!row) return false;
  if (row.status !== "pending") return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  db.prepare("UPDATE device_codes SET status = 'approved', workspace_id = ? WHERE user_code = ?").run(workspaceId, userCode);
  return true;
}

export type PollResult =
  | { status: "pending" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "approved"; apiKeyToken: string; workspaceId: string };

// Approval issues a fresh API key exactly once: the row is deleted on the
// approved branch so a second poll for the same device code can never mint
// a second credential from the same authorization.
export async function pollDeviceFlow(db: Database.Database, deviceCode: string): Promise<PollResult> {
  const row = db.prepare("SELECT * FROM device_codes WHERE device_code = ?").get(deviceCode) as
    | { device_code: string; workspace_id: string | null; status: string; expires_at: string }
    | undefined;
  if (!row) return { status: "denied" };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM device_codes WHERE device_code = ?").run(deviceCode);
    return { status: "expired" };
  }
  if (row.status === "pending") return { status: "pending" };
  if (row.status !== "approved" || !row.workspace_id) return { status: "denied" };

  const { keyId, secret, token } = generateApiKey();
  const keyHash = await hashSecret(secret);
  insertApiKey(db, {
    id: randomUUID(),
    workspaceId: row.workspace_id,
    keyId,
    keyHash,
    name: "mcplock login",
    createdAt: new Date().toISOString(),
    lastUsed: null,
    revokedAt: null,
  });
  db.prepare("DELETE FROM device_codes WHERE device_code = ?").run(deviceCode);
  return { status: "approved", apiKeyToken: token, workspaceId: row.workspace_id };
}
