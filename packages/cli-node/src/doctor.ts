// Track A: `mcpseal doctor` — a read-only diagnostic of the local
// installation, ending with a best-effort (short-timeout, non-fatal)
// Control Plane reachability probe. Never repairs anything automatically
// — every failed check names the command that would fix it.
import path from "node:path";
import { existsSync } from "node:fs";
import { readLockfile } from "@mcpseal/cli-core";
import { discoverServersFromClaudeCodeProjectConfig } from "./config-discovery.js";
import { readConfig } from "./config.js";
import { readEvents, eventsLogPath } from "./event-log.js";
import { getSecret } from "./keychain.js";

export interface DoctorCheck {
  name: string;
  category: "local" | "control-plane";
  ok: boolean;
  detail: string;
  remediation?: string[];
}

export interface DoctorReport {
  checks: DoctorCheck[];
  allLocalOk: boolean;
}

export interface DoctorOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  lockfilePath?: string;
  logPath?: string;
  cfgPath?: string;
}

export async function runDoctor(projectDir: string = process.cwd(), opts: DoctorOptions = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  try {
    const servers = discoverServersFromClaudeCodeProjectConfig(projectDir);
    checks.push({
      category: "local",
      name: "MCP configuration",
      ok: true,
      detail: servers.length === 0 ? "no .mcp.json found (or it defines zero servers)" : `${servers.length} server(s) configured in .mcp.json`,
    });
  } catch (err) {
    checks.push({
      category: "local",
      name: "MCP configuration",
      ok: false,
      detail: (err as Error).message,
      remediation: ["Fix .mcp.json's JSON syntax/shape (each server entry needs a \"command\")."],
    });
  }

  const lockfilePath = opts.lockfilePath ?? path.join(projectDir, ".mcp-lock.json");
  try {
    const lockfile = readLockfile(lockfilePath);
    const serverCount = Object.keys(lockfile.servers).length;
    const toolCount = Object.values(lockfile.servers).reduce((n, s) => n + Object.keys(s.tools).length, 0);
    checks.push({ category: "local", name: "Lockfile", ok: true, detail: `${serverCount} server(s), ${toolCount} tool(s) pinned` });
  } catch (err) {
    checks.push({
      category: "local",
      name: "Lockfile",
      ok: false,
      detail: (err as Error).message,
      remediation: ["mcpseal init"],
    });
  }

  const backupPath = path.join(projectDir, ".mcp.json.mcpseal-backup");
  const installed = existsSync(backupPath);
  checks.push({
    category: "local",
    name: "Proxy installed",
    ok: installed,
    detail: installed ? "MCP servers route through mcpseal proxy" : "MCP servers launch directly — unprotected",
    remediation: installed ? undefined : ["mcpseal install"],
  });

  try {
    const events = readEvents(opts.logPath);
    checks.push({
      category: "local",
      name: "Local event log",
      ok: true,
      detail: `readable (${events.length} event(s)) at ${opts.logPath ?? eventsLogPath()}`,
    });
  } catch (err) {
    checks.push({ category: "local", name: "Local event log", ok: false, detail: (err as Error).message });
  }

  try {
    const secret = getSecret("machine-private-key");
    checks.push({
      category: "local",
      name: "OS keychain",
      ok: true,
      detail: secret ? "reachable — machine identity present" : "reachable — no machine identity yet (not logged in)",
    });
  } catch (err) {
    checks.push({
      category: "local",
      name: "OS keychain",
      ok: false,
      detail: (err as Error).message,
      remediation: ["Check that your OS keychain/credential manager is available (Windows Credential Manager / macOS Keychain / a Secret Service on Linux)."],
    });
  }

  const config = readConfig(opts.cfgPath);
  if (!config?.workspaceId) {
    checks.push({
      category: "control-plane",
      name: "Control Plane",
      ok: true,
      detail: "not logged in — local enforcement remains fully active without it",
    });
  } else {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const timeoutMs = opts.timeoutMs ?? 3000;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(`${config.ingestUrl}/healthz`, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      checks.push({
        category: "control-plane",
        name: "Control Plane",
        ok: res.ok,
        detail: res.ok ? `reachable at ${config.ingestUrl}` : `responded with HTTP ${res.status}`,
        remediation: res.ok ? undefined : ["Local enforcement remains active regardless of Control Plane status."],
      });
    } catch (err) {
      checks.push({
        category: "control-plane",
        name: "Control Plane",
        ok: false,
        detail: `unreachable: ${(err as Error).message}`,
        remediation: [
          "Local enforcement remains active regardless — this only affects org visibility and policy sync.",
          "Events recorded while offline are retained locally and shipped once connectivity returns.",
        ],
      });
    }
  }

  const allLocalOk = checks.filter((c) => c.category === "local").every((c) => c.ok);
  return { checks, allLocalOk };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = ["MCPSEAL DOCTOR", ""];
  for (const c of report.checks) {
    const mark = c.ok ? "✔" : "⚠";
    lines.push(`${mark} ${c.name}`);
    lines.push(`    ${c.detail}`);
    if (!c.ok && c.remediation) {
      for (const r of c.remediation) lines.push(`    next: ${r}`);
    }
  }
  lines.push("");
  lines.push(report.allLocalOk ? "Local enforcement: healthy." : "Local enforcement: DEGRADED — see the checks above marked with a warning.");
  return lines.join("\n");
}
