import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverServersFromClaudeCodeProjectConfig } from "./config-discovery.js";

const dirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "mcpseal-config-test-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("discoverServersFromClaudeCodeProjectConfig", () => {
  it("returns an empty array when .mcp.json doesn't exist (zero-config contract, Part 3.2)", () => {
    const dir = tmpDir();
    expect(discoverServersFromClaudeCodeProjectConfig(dir)).toEqual([]);
  });

  it("parses command/args for each server in mcpServers", () => {
    const dir = tmpDir();
    writeFileSync(
      path.join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
          local: { command: "node", args: ["server.js"] },
        },
      })
    );
    const servers = discoverServersFromClaudeCodeProjectConfig(dir);
    expect(servers).toHaveLength(2);
    expect(servers).toContainEqual({ name: "github", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] });
    expect(servers).toContainEqual({ name: "local", command: "node", args: ["server.js"] });
  });

  it("defaults args to an empty array when omitted", () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { x: { command: "foo" } } }));
    expect(discoverServersFromClaudeCodeProjectConfig(dir)).toEqual([{ name: "x", command: "foo", args: [] }]);
  });

  it("throws on malformed JSON", () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, ".mcp.json"), "{ not json");
    expect(() => discoverServersFromClaudeCodeProjectConfig(dir)).toThrow();
  });

  it("throws when mcpServers is missing", () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ foo: "bar" }));
    expect(() => discoverServersFromClaudeCodeProjectConfig(dir)).toThrow();
  });

  it("throws when a server entry is missing command", () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { bad: { args: [] } } }));
    expect(() => discoverServersFromClaudeCodeProjectConfig(dir)).toThrow();
  });
});
