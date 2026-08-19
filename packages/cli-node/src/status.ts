// Track A: `mcpseal status` — a structured, offline-first snapshot of
// local health, kept separate from the Control Plane connectivity probe
// (doctor.ts does that; status never makes a network call, so it can
// never be slow or fail because of network conditions — it answers "what
// does this machine currently believe," not "is the network up").
import path from "node:path";
import { existsSync } from "node:fs";
import { readLockfile } from "@mcpseal/cli-core";
import { readConfig } from "./config.js";
import { eventsLogPath, readEvents, recentBlocks, type McpsealEvent } from "./event-log.js";

export interface LocalStatus {
  lockfilePresent: boolean;
  lockfileError?: string;
  serverCount?: number;
  toolCount?: number;
  proxyInstalled: boolean;
  eventCount: number;
  blockCount: number;
  recentBlocks: McpsealEvent[];
}

export interface ConnectionStatus {
  loggedIn: boolean;
  workspaceId?: string;
  machineId?: string;
  ingestUrl?: string;
  lastAppliedPolicyVersion?: number;
}

export interface StatusReport {
  local: LocalStatus;
  connection: ConnectionStatus;
}

export interface StatusOptions {
  lockfilePath?: string;
  logPath?: string;
  cfgPath?: string;
}

export function buildStatusReport(projectDir: string = process.cwd(), opts: StatusOptions = {}): StatusReport {
  const lockfilePath = opts.lockfilePath ?? path.join(projectDir, ".mcp-lock.json");
  const local: LocalStatus = {
    lockfilePresent: false,
    proxyInstalled: existsSync(path.join(projectDir, ".mcp.json.mcpseal-backup")),
    eventCount: 0,
    blockCount: 0,
    recentBlocks: [],
  };

  try {
    const lockfile = readLockfile(lockfilePath);
    local.lockfilePresent = true;
    local.serverCount = Object.keys(lockfile.servers).length;
    local.toolCount = Object.values(lockfile.servers).reduce((n, s) => n + Object.keys(s.tools).length, 0);
  } catch (err) {
    local.lockfilePresent = false;
    local.lockfileError = (err as Error).message;
  }

  const events = readEvents(opts.logPath);
  local.eventCount = events.length;
  const blocks = recentBlocks(events, 10);
  local.blockCount = events.filter((e) => e.type.startsWith("blocked")).length;
  local.recentBlocks = blocks;

  const config = readConfig(opts.cfgPath);
  const connection: ConnectionStatus = {
    loggedIn: Boolean(config?.workspaceId && config?.machineId),
    workspaceId: config?.workspaceId,
    machineId: config?.machineId,
    ingestUrl: config?.ingestUrl,
    lastAppliedPolicyVersion: config?.lastAppliedPolicyVersion,
  };

  return { local, connection };
}

export function formatStatusReport(report: StatusReport): string {
  const lines: string[] = [];
  lines.push("LOCAL HEALTH");
  if (report.local.lockfilePresent) {
    lines.push(`  lockfile:  present (${report.local.serverCount} server(s), ${report.local.toolCount} tool(s) pinned)`);
  } else {
    lines.push(`  lockfile:  MISSING or invalid${report.local.lockfileError ? ` — ${report.local.lockfileError}` : ""}`);
    lines.push(`             next: mcpseal init`);
  }
  lines.push(`  proxy:     ${report.local.proxyInstalled ? "installed" : "not installed — MCP servers launch unprotected"}`);
  if (!report.local.proxyInstalled) lines.push(`             next: mcpseal install`);
  lines.push(`  events:    ${report.local.eventCount} recorded, ${report.local.blockCount} block(s) total`);
  for (const b of report.local.recentBlocks) {
    lines.push(`    [${b.ts}] ${b.type} — ${b.server}/${b.tool}`);
  }

  lines.push("");
  lines.push("CONTROL PLANE");
  if (report.connection.loggedIn) {
    lines.push(`  workspace: ${report.connection.workspaceId} (machine ${report.connection.machineId})`);
    if (report.connection.lastAppliedPolicyVersion !== undefined) {
      lines.push(`  policy:    version ${report.connection.lastAppliedPolicyVersion} last applied`);
    }
    lines.push(`  next:      mcpseal doctor   # checks live connectivity`);
  } else {
    lines.push("  not logged in — running fully local, no workspace connection.");
    lines.push("  next:      mcpseal login   # optional; local enforcement already works without it");
  }

  return lines.join("\n");
}
