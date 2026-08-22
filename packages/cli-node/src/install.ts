// build-bible.md Part 3.3 / docs/Tasks.md 2.4: `mcpseal install` rewrites each
// server entry in the client config so the client launches
// `mcpseal proxy <serverName> <original-command...>` instead of the
// original command directly. `mcpseal uninstall` reverses it exactly.
//
// Byte-for-byte guarantee: rather than regenerating JSON and hoping it
// matches the original formatting, install() snapshots the exact original
// file bytes to a backup file before rewriting, and uninstall() just
// restores those exact bytes verbatim. Simpler and provably correct.
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";

const BACKUP_SUFFIX = ".mcpseal-backup";

export interface McpsealInvocation {
  command: string;
  args: string[];
}

// Default matches Part 3.1's zero-install distribution model ("npx mcpseal").
const DEFAULT_MCPSEAL_INVOCATION: McpsealInvocation = { command: "npx", args: ["-y", "mcpseal"] };

export interface InstallResult {
  configPath: string;
  backupPath: string;
  serverCount: number;
}

export function install(projectDir: string, mcpsealInvocation: McpsealInvocation = DEFAULT_MCPSEAL_INVOCATION): InstallResult {
  const configPath = path.join(projectDir, ".mcp.json");
  const backupPath = configPath + BACKUP_SUFFIX;

  if (!existsSync(configPath)) {
    throw new Error(`install: no config found at ${configPath}`);
  }
  if (existsSync(backupPath)) {
    throw new Error(`install: ${backupPath} already exists — mcpseal appears to already be installed here`);
  }

  const originalBytes = readFileSync(configPath, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(originalBytes);
  } catch (err) {
    throw new Error(`install: ${configPath} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || !("mcpServers" in parsed)) {
    throw new Error(`install: ${configPath} is missing "mcpServers"`);
  }

  const mcpServers = (parsed as { mcpServers: Record<string, unknown> }).mcpServers;
  const rewritten: Record<string, { command: string; args: string[] }> = {};
  let serverCount = 0;

  for (const [name, raw] of Object.entries(mcpServers)) {
    const entry = raw as { command: string; args?: string[] };
    rewritten[name] = {
      command: mcpsealInvocation.command,
      args: [...mcpsealInvocation.args, "proxy", name, entry.command, ...(entry.args ?? [])],
    };
    serverCount++;
  }

  // Snapshot the exact original bytes BEFORE writing the rewritten config,
  // so a crash between these two steps still leaves a restorable backup.
  writeFileSync(backupPath, originalBytes, "utf-8");

  const newConfig = { ...(parsed as Record<string, unknown>), mcpServers: rewritten };
  writeFileSync(configPath, JSON.stringify(newConfig, null, 2) + "\n", "utf-8");

  return { configPath, backupPath, serverCount };
}

export interface UninstallResult {
  configPath: string;
}

export function uninstall(projectDir: string): UninstallResult {
  const configPath = path.join(projectDir, ".mcp.json");
  const backupPath = configPath + BACKUP_SUFFIX;

  if (!existsSync(backupPath)) {
    throw new Error(`uninstall: no backup found at ${backupPath} — mcpseal does not appear to be installed here`);
  }

  const originalBytes = readFileSync(backupPath, "utf-8");
  writeFileSync(configPath, originalBytes, "utf-8");
  unlinkSync(backupPath);

  return { configPath };
}
