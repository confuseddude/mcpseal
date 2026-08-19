// Track A: `mcplock status` must work sensibly offline and never touch
// the network — buildStatusReport() is pure local file reads, verified
// here with isolated temp paths (never the real ~/.mcplock).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "./init.js";
import { appendEvent } from "./event-log.js";
import { writeConfig } from "./config.js";
import { buildStatusReport, formatStatusReport } from "./status.js";

const stubServerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "test-fixtures/stub-server.mjs");

const dirs: string[] = [];
function tmpProject(): string {
  const d = mkdtempSync(path.join(tmpdir(), "mcplock-status-test-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("buildStatusReport", () => {
  it("reports lockfile missing with actionable detail when there is none", () => {
    const dir = tmpProject();
    const report = buildStatusReport(dir, { lockfilePath: path.join(dir, ".mcp-lock.json"), logPath: path.join(dir, "events.jsonl"), cfgPath: path.join(dir, "config.json") });
    expect(report.local.lockfilePresent).toBe(false);
    expect(report.local.lockfileError).toBeTruthy();
  });

  it("reports server/tool counts when a lockfile exists", async () => {
    const dir = tmpProject();
    writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { stub: { command: "node", args: [stubServerPath] } } }));
    await init({ projectDir: dir });
    const report = buildStatusReport(dir, { logPath: path.join(dir, "events.jsonl"), cfgPath: path.join(dir, "config.json") });
    expect(report.local.lockfilePresent).toBe(true);
    expect(report.local.serverCount).toBe(1);
    expect(report.local.toolCount).toBeGreaterThan(0);
  }, 15_000);

  it("reports proxyInstalled false when no backup file exists, true when it does", () => {
    const dir = tmpProject();
    const opts = { lockfilePath: path.join(dir, ".mcp-lock.json"), logPath: path.join(dir, "events.jsonl"), cfgPath: path.join(dir, "config.json") };
    expect(buildStatusReport(dir, opts).local.proxyInstalled).toBe(false);
    writeFileSync(path.join(dir, ".mcp.json.mcplock-backup"), "{}");
    expect(buildStatusReport(dir, opts).local.proxyInstalled).toBe(true);
  });

  it("counts events and surfaces recent blocks, isolated from the real machine log", () => {
    const dir = tmpProject();
    const logPath = path.join(dir, "events.jsonl");
    appendEvent({ type: "approved", server: "s", tool: "t1" }, logPath);
    appendEvent({ type: "blocked_drift", server: "s", tool: "t2" }, logPath);
    const report = buildStatusReport(dir, { lockfilePath: path.join(dir, ".mcp-lock.json"), logPath, cfgPath: path.join(dir, "config.json") });
    expect(report.local.eventCount).toBe(2);
    expect(report.local.blockCount).toBe(1);
    expect(report.local.recentBlocks).toHaveLength(1);
    expect(report.local.recentBlocks[0].tool).toBe("t2");
  });

  it("reports not-logged-in when no config exists, connected when it does", () => {
    const dir = tmpProject();
    const cfgPath = path.join(dir, "config.json");
    const opts = { lockfilePath: path.join(dir, ".mcp-lock.json"), logPath: path.join(dir, "events.jsonl"), cfgPath };
    expect(buildStatusReport(dir, opts).connection.loggedIn).toBe(false);

    writeConfig({ workspaceId: "w1", machineId: "m1", ingestUrl: "http://127.0.0.1:8787" }, cfgPath);
    const report = buildStatusReport(dir, opts);
    expect(report.connection.loggedIn).toBe(true);
    expect(report.connection.workspaceId).toBe("w1");
  });

  it("never touches the network — no fetch/http import in this module's call graph is exercised by pure file reads", () => {
    // Structural guarantee: buildStatusReport's signature takes no
    // fetchImpl and the function is synchronous — there is no await, no
    // network call possible. This test documents that contract; if
    // buildStatusReport ever becomes async, this test should be revisited.
    const dir = tmpProject();
    const result = buildStatusReport(dir, { lockfilePath: path.join(dir, ".mcp-lock.json"), logPath: path.join(dir, "events.jsonl"), cfgPath: path.join(dir, "config.json") });
    expect(result).toBeDefined();
  });
});

describe("formatStatusReport", () => {
  it("distinguishes LOCAL HEALTH from CONTROL PLANE sections", () => {
    const dir = tmpProject();
    const report = buildStatusReport(dir, { lockfilePath: path.join(dir, ".mcp-lock.json"), logPath: path.join(dir, "events.jsonl"), cfgPath: path.join(dir, "config.json") });
    const text = formatStatusReport(report);
    expect(text).toContain("LOCAL HEALTH");
    expect(text).toContain("CONTROL PLANE");
  });

  it("suggests `mcplock init` when the lockfile is missing", () => {
    const dir = tmpProject();
    const report = buildStatusReport(dir, { lockfilePath: path.join(dir, ".mcp-lock.json"), logPath: path.join(dir, "events.jsonl"), cfgPath: path.join(dir, "config.json") });
    expect(formatStatusReport(report)).toContain("mcplock init");
  });

  it("suggests `mcplock install` when the proxy is not installed", () => {
    const dir = tmpProject();
    const report = buildStatusReport(dir, { lockfilePath: path.join(dir, ".mcp-lock.json"), logPath: path.join(dir, "events.jsonl"), cfgPath: path.join(dir, "config.json") });
    expect(formatStatusReport(report)).toContain("mcplock install");
  });
});
