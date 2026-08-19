// Non-secret local state for the opted-in workspace connection
// (build-bible.md Part 6.2 / 4.2). Everything secret (the workspace API key,
// the machine's ed25519 private key) lives in the OS keychain (keychain.ts),
// never here — this file only ever holds IDs, a server URL, and a shipping
// cursor, all safe to read in plaintext.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface McpsealConfig {
  workspaceId: string;
  machineId: string;
  ingestUrl: string;
  lastShippedEventId?: string;
  // build-bible.md Part 8.1: "the client pins the org's public key at
  // login." Once set, this value must never be silently overwritten by a
  // later login — see login.ts's pinning check.
  orgPublicKeyHex?: string;
  lastAppliedPolicyVersion?: number;
}

export function configPath(): string {
  return path.join(homedir(), ".mcpseal", "config.json");
}

// Absence of this file (or of a config entirely) is the CLI's definition of
// "not logged in" — CLAUDE.md invariant 2 depends on this being reliably
// checkable before anything ever touches the network.
export function readConfig(cfgPath: string = configPath()): McpsealConfig | null {
  if (!existsSync(cfgPath)) return null;
  try {
    return JSON.parse(readFileSync(cfgPath, "utf-8"));
  } catch {
    return null;
  }
}

export function writeConfig(config: McpsealConfig, cfgPath: string = configPath()): void {
  mkdirSync(path.dirname(cfgPath), { recursive: true });
  writeFileSync(cfgPath, JSON.stringify(config, null, 2), "utf-8");
}

export function clearConfig(cfgPath: string = configPath()): void {
  if (existsSync(cfgPath)) writeFileSync(cfgPath, "{}", "utf-8");
}

export function isLoggedIn(cfgPath: string = configPath()): boolean {
  const cfg = readConfig(cfgPath);
  return !!cfg?.workspaceId && !!cfg?.machineId;
}
