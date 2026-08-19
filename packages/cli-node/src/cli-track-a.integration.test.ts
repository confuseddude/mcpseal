// Track A: real subprocess tests against the actual compiled binary
// (dist/cli.js), not just the exported functions — confirms the wiring
// in cli.ts itself (--json flag parsing, exit codes, new commands) works
// end-to-end, the same rigor as scan-manage-diff.integration.test.ts.
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const stubServerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "test-fixtures/stub-server.mjs");
const cliJsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

const dirs: string[] = [];
function tmpProject(): string {
  const d = mkdtempSync(path.join(tmpdir(), "mcplock-track-a-test-"));
  dirs.push(d);
  writeFileSync(path.join(d, ".mcp.json"), JSON.stringify({ mcpServers: { stub: { command: "node", args: [stubServerPath] } } }));
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(args: string[], cwd?: string) {
  return spawnSync("node", [cliJsPath, ...args], { encoding: "utf-8", cwd });
}

describe("mcplock status", () => {
  it("exits 0 and reports LOCAL HEALTH / CONTROL PLANE even with no lockfile at all (offline-first)", () => {
    const dir = tmpProject();
    const res = run(["status", dir]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("LOCAL HEALTH");
    expect(res.stdout).toContain("CONTROL PLANE");
    expect(res.stdout).toContain("mcplock init");
  });

  it("--json produces valid, parseable JSON with the expected shape", () => {
    const dir = tmpProject();
    const res = run(["status", dir, "--json"]);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed).toHaveProperty("local");
    expect(parsed).toHaveProperty("connection");
    expect(parsed.local).toHaveProperty("lockfilePresent");
  });
});

describe("mcplock doctor", () => {
  it("exits non-zero when local health has failures (no lockfile), and explains why", () => {
    const dir = tmpProject();
    const res = run(["doctor", dir]);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("MCPLOCK DOCTOR");
    expect(res.stdout).toContain("mcplock init");
  });

  it("exits 0 once init + install have been run", () => {
    const dir = tmpProject();
    const init = run(["init", dir]);
    expect(init.status).toBe(0);
    writeFileSync(path.join(dir, ".mcp.json.mcplock-backup"), "{}");
    const res = run(["doctor", dir]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("healthy");
  }, 15_000);

  it("--json produces valid JSON with a checks array", () => {
    const dir = tmpProject();
    const res = run(["doctor", dir, "--json"]);
    const parsed = JSON.parse(res.stdout);
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.checks.length).toBeGreaterThan(0);
    expect(typeof parsed.allLocalOk).toBe("boolean");
  });
});

describe("mcplock scan --json", () => {
  it("matches the plain-mode exit code (0 clean)", () => {
    const dir = tmpProject();
    run(["init", dir]);
    const plain = run(["scan", dir]);
    const asJson = run(["scan", dir, "--json"]);
    expect(plain.status).toBe(0);
    expect(asJson.status).toBe(0);
    const parsed = JSON.parse(asJson.stdout);
    expect(parsed.blocked).toBe(false);
    expect(Array.isArray(parsed.decisions)).toBe(true);
  }, 15_000);
});

describe("mcplock logout", () => {
  it("clears local config without error even when never logged in (idempotent)", () => {
    const dir = tmpProject();
    const res = run(["logout"], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("cleared");
  });
});

describe("unrecognized error paths get real remediation text, not a bare stack trace", () => {
  it("readLockfile failure via `mcplock proxy` on a project with no lockfile shows LOCKFILE_NOT_FOUND guidance", () => {
    const dir = tmpProject();
    const res = run(["proxy", "stub", "node", stubServerPath], dir);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("LOCKFILE_NOT_FOUND");
    expect(res.stderr).toContain("mcplock init");
  });

  it("approve on an unconfigured server shows SERVER_NOT_CONFIGURED guidance, not a raw stack trace", () => {
    const dir = tmpProject();
    run(["init", dir]);
    const res = spawnSync("node", [cliJsPath, "approve", "does-not-exist", "some-tool"], { encoding: "utf-8", cwd: dir });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("SERVER_NOT_CONFIGURED");
    expect(res.stderr).not.toContain("at Object.<anonymous>"); // no raw stack trace leaking through
  }, 15_000);
});
