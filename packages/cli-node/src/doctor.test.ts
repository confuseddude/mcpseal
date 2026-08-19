// Track A: `mcplock doctor` — read-only diagnostics. Critically: Control
// Plane unreachability must never fail `allLocalOk`, and local checks
// must never depend on network availability (offline-first, Part 13).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "./init.js";
import { writeConfig } from "./config.js";
import { runDoctor, formatDoctorReport } from "./doctor.js";

const stubServerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "test-fixtures/stub-server.mjs");

const dirs: string[] = [];
function tmpProject(): string {
  const d = mkdtempSync(path.join(tmpdir(), "mcplock-doctor-test-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function isolatedOpts(dir: string) {
  return { lockfilePath: path.join(dir, ".mcp-lock.json"), logPath: path.join(dir, "events.jsonl"), cfgPath: path.join(dir, "config.json") };
}

describe("runDoctor — local checks", () => {
  it("reports a healthy install when everything is in place", async () => {
    const dir = tmpProject();
    writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { stub: { command: "node", args: [stubServerPath] } } }));
    await init({ projectDir: dir });
    writeFileSync(path.join(dir, ".mcp.json.mcplock-backup"), "{}");

    const report = await runDoctor(dir, isolatedOpts(dir));
    const lockfileCheck = report.checks.find((c) => c.name === "Lockfile");
    expect(lockfileCheck?.ok).toBe(true);
    expect(report.allLocalOk).toBe(true);
  }, 15_000);

  it("flags a missing lockfile with a `mcplock init` remediation", async () => {
    const dir = tmpProject();
    const report = await runDoctor(dir, isolatedOpts(dir));
    const lockfileCheck = report.checks.find((c) => c.name === "Lockfile");
    expect(lockfileCheck?.ok).toBe(false);
    expect(lockfileCheck?.remediation).toContain("mcplock init");
    expect(report.allLocalOk).toBe(false);
  });

  it("flags the proxy as not installed with a `mcplock install` remediation", async () => {
    const dir = tmpProject();
    writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
    const report = await runDoctor(dir, isolatedOpts(dir));
    const proxyCheck = report.checks.find((c) => c.name === "Proxy installed");
    expect(proxyCheck?.ok).toBe(false);
    expect(proxyCheck?.remediation).toContain("mcplock install");
  });

  it("Control Plane category never counts toward allLocalOk — an unreachable server does not degrade local health", async () => {
    const dir = tmpProject();
    writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { stub: { command: "node", args: [stubServerPath] } } }));
    await init({ projectDir: dir });
    writeFileSync(path.join(dir, ".mcp.json.mcplock-backup"), "{}");
    writeConfig({ workspaceId: "w1", machineId: "m1", ingestUrl: "http://127.0.0.1:1" }, path.join(dir, "config.json"));

    const failingFetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const report = await runDoctor(dir, { ...isolatedOpts(dir), fetchImpl: failingFetch, timeoutMs: 500 });
    const cpCheck = report.checks.find((c) => c.category === "control-plane");
    expect(cpCheck?.ok).toBe(false);
    // The one thing that must be true regardless of Control Plane state:
    expect(report.allLocalOk).toBe(true);
  }, 15_000);

  it("reports Control Plane as trivially fine (not logged in) rather than an error when no workspace is configured", async () => {
    const dir = tmpProject();
    const report = await runDoctor(dir, isolatedOpts(dir));
    const cpCheck = report.checks.find((c) => c.category === "control-plane");
    expect(cpCheck?.ok).toBe(true);
    expect(cpCheck?.detail).toContain("not logged in");
  });

  it("reports Control Plane reachable when it responds ok", async () => {
    const dir = tmpProject();
    writeConfig({ workspaceId: "w1", machineId: "m1", ingestUrl: "http://127.0.0.1:8787" }, path.join(dir, "config.json"));
    const okFetch = (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    const report = await runDoctor(dir, { ...isolatedOpts(dir), fetchImpl: okFetch });
    const cpCheck = report.checks.find((c) => c.category === "control-plane");
    expect(cpCheck?.ok).toBe(true);
  });
});

describe("formatDoctorReport", () => {
  it("marks failing checks with a warning symbol and passing checks with a check mark", async () => {
    const dir = tmpProject();
    const report = await runDoctor(dir, isolatedOpts(dir));
    const text = formatDoctorReport(report);
    expect(text).toContain("MCPLOCK DOCTOR");
    expect(text).toMatch(/⚠|✔/);
  });

  it("summarizes DEGRADED when local health has failures, healthy otherwise", async () => {
    const dir = tmpProject();
    const badReport = await runDoctor(dir, isolatedOpts(dir));
    expect(formatDoctorReport(badReport)).toContain("DEGRADED");

    writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { stub: { command: "node", args: [stubServerPath] } } }));
    await init({ projectDir: dir });
    writeFileSync(path.join(dir, ".mcp.json.mcplock-backup"), "{}");
    const goodReport = await runDoctor(dir, isolatedOpts(dir));
    expect(formatDoctorReport(goodReport)).toContain("healthy");
  }, 15_000);
});
