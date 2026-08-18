import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEmptyLockfile, readLockfile, writeLockfile } from "./lockfile.js";

const dirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "mcplock-lockfile-test-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("createEmptyLockfile (Part 2.3 skeleton)", () => {
  it("matches the Part 2.3 skeleton defaults", () => {
    const lf = createEmptyLockfile();
    expect(lf.version).toBe(1);
    expect(lf.signature).toBeNull();
    expect(lf.servers).toEqual({});
    expect(lf.policy).toEqual({
      onDrift: "block",
      onUnknownTool: "block",
      allowNewToolsFromApprovedServer: false,
    });
  });
});

describe("writeLockfile / readLockfile round-trip", () => {
  it("round-trips exactly", () => {
    const dir = tmpDir();
    const file = path.join(dir, ".mcp-lock.json");
    const original = createEmptyLockfile("mcplock@test");
    original.servers.github = {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      commandHash: "sha256:abc123",
      tools: {
        create_issue: {
          hash: "sha256:def456",
          description: "Create a new GitHub issue",
          approvedAt: original.generatedAt,
          approvedBy: "local",
          status: "approved",
        },
      },
    };

    writeLockfile(file, original);
    const readBack = readLockfile(file);
    expect(readBack).toEqual(original);
  });
});

describe("readLockfile fail-closed behavior (CLAUDE.md invariant 1)", () => {
  it("throws (does not return null) on a missing file", () => {
    const dir = tmpDir();
    const missing = path.join(dir, "does-not-exist.json");
    expect(() => readLockfile(missing)).toThrow();
  });

  it("throws on malformed JSON", () => {
    const dir = tmpDir();
    const file = path.join(dir, "malformed.json");
    writeFileSync(file, "{ not valid json", "utf-8");
    expect(() => readLockfile(file)).toThrow();
  });

  it("throws on valid JSON that is missing required lockfile fields", () => {
    const dir = tmpDir();
    const file = path.join(dir, "incomplete.json");
    writeFileSync(file, JSON.stringify({ version: 1 }), "utf-8");
    expect(() => readLockfile(file)).toThrow();
  });

  it("throws on valid JSON that isn't an object at all", () => {
    const dir = tmpDir();
    const file = path.join(dir, "not-an-object.json");
    writeFileSync(file, JSON.stringify([1, 2, 3]), "utf-8");
    expect(() => readLockfile(file)).toThrow();
  });
});
