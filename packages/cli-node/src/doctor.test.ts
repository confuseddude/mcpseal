// Track A: `mcpseal doctor` — read-only diagnostics. Critically: Control
// Plane unreachability must never fail `allLocalOk`, and local checks
// must never depend on network availability (offline-first, Part 13).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "./init.js";
import { writeConfig } from "./config.js";
import { runDoctor, formatDoctorReport } from "./doctor.js";

const stubServerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "test-fixtures/stub-server.mjs");

const dirs: string[] = [];
function tmpProject(): string {
  const d = mkdtempSync(path.join(tmpdir(), "mcpseal-doctor-test-"));
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
    writeFileSync(path.join(dir, ".mcp.json.mcpseal-backup"), "{}");

    const report = await runDoctor(dir, isolatedOpts(dir));
    const lockfileCheck = report.checks.find((c) => c.name === "Lockfile");
    expect(lockfileCheck?.ok).toBe(true);
    expect(report.allLocalOk).toBe(true);
  }, 15_000);

  it("flags a missing lockfile with a `mcpseal init` remediation", async () => {
    const dir = tmpProject();
    const report = await runDoctor(dir, isolatedOpts(dir));
    const lockfileCheck = report.checks.find((c) => c.name === "Lockfile");
    expect(lockfileCheck?.ok).toBe(false);
    expect(lockfileCheck?.remediation).toContain("mcpseal init");
    expect(report.allLocalOk).toBe(false);
  });

  it("flags the proxy as not installed with a `mcpseal install` remediation", async () => {
    const dir = tmpProject();
    writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
    const report = await runDoctor(dir, isolatedOpts(dir));
    const proxyCheck = report.checks.find((c) => c.name === "Proxy installed");
    expect(proxyCheck?.ok).toBe(false);
    expect(proxyCheck?.remediation).toContain("mcpseal install");
  });

  it("Control Plane category never counts toward allLocalOk — an unreachable server does not degrade local health", async () => {
    const dir = tmpProject();
    writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { stub: { command: "node", args: [stubServerPath] } } }));
    await init({ projectDir: dir });
    writeFileSync(path.join(dir, ".mcp.json.mcpseal-backup"), "{}");
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

describe("runDoctor — opt-in update check (--check-updates)", () => {
  it("makes ZERO network calls when checkUpdates is not passed, even though other options are set", async () => {
    const dir = tmpProject();
    const fetchImpl = (() => {
      throw new Error("fetch must never be called without --check-updates");
    }) as unknown as typeof fetch;
    // No network-touching Control Plane config either, so the ONLY way
    // this fetchImpl could be invoked is the update check — proving the
    // product's privacy promise holds for plain `doctor`.
    await runDoctor(dir, { ...isolatedOpts(dir), fetchImpl });
  });

  it("reports no CLI-version check at all when checkUpdates is false/omitted", async () => {
    const dir = tmpProject();
    const report = await runDoctor(dir, isolatedOpts(dir));
    expect(report.checks.some((c) => c.category === "update")).toBe(false);
  });

  it("reports up to date when the registry returns the same version installed", async () => {
    const dir = tmpProject();
    const ownVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version;
    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => ({ version: ownVersion }) })) as unknown as typeof fetch;
    const report = await runDoctor(dir, { ...isolatedOpts(dir), fetchImpl, checkUpdates: true });
    const check = report.checks.find((c) => c.category === "update");
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain("latest");
  });

  it("flags an outdated version with an upgrade remediation, without affecting allLocalOk", async () => {
    const dir = tmpProject();
    writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { stub: { command: "node", args: [stubServerPath] } } }));
    await init({ projectDir: dir });
    writeFileSync(path.join(dir, ".mcp.json.mcpseal-backup"), "{}");

    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => ({ version: "999.0.0" }) })) as unknown as typeof fetch;
    const report = await runDoctor(dir, { ...isolatedOpts(dir), fetchImpl, checkUpdates: true });
    const check = report.checks.find((c) => c.category === "update");
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain("999.0.0");
    expect(check?.remediation?.[0]).toContain("npm install -g mcpseal@latest");
    // Being outdated is informational, not a local-health failure — local
    // health here is otherwise genuinely healthy (lockfile + proxy set up).
    expect(report.allLocalOk).toBe(true);
  }, 15_000);

  it("degrades gracefully (does not throw, does not fail the command) when npm is unreachable", async () => {
    const dir = tmpProject();
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const report = await runDoctor(dir, { ...isolatedOpts(dir), fetchImpl, checkUpdates: true });
    const check = report.checks.find((c) => c.category === "update");
    expect(check?.ok).toBe(true); // a failed check-for-updates is not itself a failure
    expect(check?.detail).toContain("could not reach npm");
  });

  it("hits npm's public registry, not any mcpseal-owned endpoint", async () => {
    const dir = tmpProject();
    let calledUrl: string | undefined;
    const fetchImpl = (async (url: string) => {
      calledUrl = url;
      return { ok: true, status: 200, json: async () => ({ version: "0.1.0" }) };
    }) as unknown as typeof fetch;
    await runDoctor(dir, { ...isolatedOpts(dir), fetchImpl, checkUpdates: true });
    expect(calledUrl).toBe("https://registry.npmjs.org/mcpseal/latest");
  });
});

describe("formatDoctorReport", () => {
  it("marks failing checks with a warning symbol and passing checks with a check mark", async () => {
    const dir = tmpProject();
    const report = await runDoctor(dir, isolatedOpts(dir));
    const text = formatDoctorReport(report);
    expect(text).toContain("MCPSEAL DOCTOR");
    expect(text).toMatch(/⚠|✔/);
  });

  it("summarizes DEGRADED when local health has failures, healthy otherwise", async () => {
    const dir = tmpProject();
    const badReport = await runDoctor(dir, isolatedOpts(dir));
    expect(formatDoctorReport(badReport)).toContain("DEGRADED");

    writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { stub: { command: "node", args: [stubServerPath] } } }));
    await init({ projectDir: dir });
    writeFileSync(path.join(dir, ".mcp.json.mcpseal-backup"), "{}");
    const goodReport = await runDoctor(dir, isolatedOpts(dir));
    expect(formatDoctorReport(goodReport)).toContain("healthy");
  }, 15_000);
});
