// build-bible.md Part 8.1 / Part 9 / Part 13: "the pushed-policy channel is
// your worst-case attack surface... design it into the policy format from
// the first Enterprise line of code." CLAUDE.md invariant 5: "A pushed
// policy is only trusted if it verifies against the org signing key pinned
// at login. Never add a code path that applies a policy update without
// that signature check."
//
// Every exit from pullAndApplyPolicy() that isn't "verified and applied"
// must leave the existing .mcp-lock.json completely untouched. That's the
// single property this whole module exists to guarantee — read it with
// that in mind.
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { readConfig, writeConfig, configPath as defaultConfigPath } from "./config.js";

export type PolicySyncResult =
  | { outcome: "applied"; version: number }
  | { outcome: "no-newer-version"; currentVersion: number }
  | { outcome: "skipped-not-logged-in" }
  | { outcome: "skipped-no-pinned-key" }
  | { outcome: "skipped-no-policy-published" }
  | { outcome: "rejected-invalid-signature" }
  | { outcome: "rejected-malformed-response" }
  | { outcome: "rejected-network-error"; message: string };

export interface PolicySyncOptions {
  cfgPath?: string;
  lockfilePath?: string;
  fetchImpl?: typeof fetch;
  apiKeyToken?: string; // injectable for tests; real callers read the keychain
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

export async function pullAndApplyPolicy(opts: PolicySyncOptions = {}): Promise<PolicySyncResult> {
  const cfgPath = opts.cfgPath ?? defaultConfigPath();
  const config = readConfig(cfgPath);
  if (!config?.workspaceId || !config?.ingestUrl) {
    return { outcome: "skipped-not-logged-in" };
  }
  if (!config.orgPublicKeyHex) {
    // Fail closed by refusing to trust ANY policy rather than trusting one
    // with no pinned key to check it against — the whole point of pinning.
    return { outcome: "skipped-no-pinned-key" };
  }

  const apiKeyToken = opts.apiKeyToken;
  if (!apiKeyToken) {
    return { outcome: "skipped-not-logged-in" };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${config.ingestUrl}/v1/policy/current`, {
      headers: { authorization: `Bearer ${apiKeyToken}` },
    });
  } catch (err) {
    return { outcome: "rejected-network-error", message: (err as Error).message };
  }

  if (res.status === 404) return { outcome: "skipped-no-policy-published" };
  if (!res.ok) return { outcome: "rejected-network-error", message: `HTTP ${res.status}` };

  let body: { version: number; lockfileJson: string; signature: string | null };
  try {
    body = await res.json();
    if (typeof body.version !== "number" || typeof body.lockfileJson !== "string") {
      throw new Error("missing required fields");
    }
  } catch {
    // Interrupted/corrupted download: the existing lockfile is untouched
    // because we haven't written anything yet.
    return { outcome: "rejected-malformed-response" };
  }

  if (!body.signature) return { outcome: "rejected-invalid-signature" };

  // The signature check: fail closed on every possible way this can go
  // wrong — malformed hex, wrong-length key, actual cryptographic mismatch.
  // verifyEd25519-equivalent inlined here (cli-node has no shared verify
  // helper yet — see docs/history/NIGHT_SHIFT_LOG.md for the parity note) but the same
  // fail-to-false behavior as services/ingest/src/crypto.ts's verifyEd25519.
  let verified: boolean;
  try {
    verified = ed25519.verify(hexToBytes(body.signature), Buffer.from(body.lockfileJson, "utf-8"), hexToBytes(config.orgPublicKeyHex));
  } catch {
    verified = false;
  }
  if (!verified) return { outcome: "rejected-invalid-signature" };

  // Malformed JSON inside a validly-signed body should be structurally
  // impossible (the server only signs valid JSON — see app-api's
  // POST /v1/policies), but parse defensively anyway: never write bytes to
  // the real lockfile path without confirming they're at least valid JSON.
  try {
    JSON.parse(body.lockfileJson);
  } catch {
    return { outcome: "rejected-malformed-response" };
  }

  const currentVersion = config.lastAppliedPolicyVersion ?? 0;
  if (body.version <= currentVersion) {
    // Never downgrade (build-bible Part 9's replay/old-version handling):
    // a server returning a version we've already applied or an older one
    // is a no-op, not an error and not an update.
    return { outcome: "no-newer-version", currentVersion };
  }

  const lockfilePath = opts.lockfilePath ?? path.join(process.cwd(), ".mcp-lock.json");
  // Atomic replace: write to a temp file, then rename over the target.
  // If the process dies mid-write, the temp file is orphaned but the real
  // lockfile is never left partially written — this is what "interrupted
  // download / corrupted local replacement leaves the existing policy
  // active" (Part 9) means in practice.
  const tmpPath = `${lockfilePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmpPath, body.lockfileJson, "utf-8");
    renameSync(tmpPath, lockfilePath);
  } finally {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // best-effort cleanup only
      }
    }
  }

  writeConfig({ ...config, lastAppliedPolicyVersion: body.version }, cfgPath);
  return { outcome: "applied", version: body.version };
}

// Exposed for the CLI/tests to read what's actually on disk without
// re-implementing the read.
export function readLockfileRaw(lockfilePath: string): string | null {
  if (!existsSync(lockfilePath)) return null;
  return readFileSync(lockfilePath, "utf-8");
}
