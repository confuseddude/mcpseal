import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { install, uninstall } from "./install.js";

const dirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "mcpseal-install-test-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Deliberately irregular formatting (extra whitespace, unsorted keys) so a
// byte-for-byte check actually proves something — a naive "regenerate JSON"
// uninstall would normalize this away even if the logical content matched.
const ORIGINAL_CONFIG = `{
  "mcpServers":   {
    "github": {
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "command": "npx"
    },
    "local":{"command":"node","args":["server.js"]}
  }
}
`;

describe("install / uninstall (Part 3.3, docs/Tasks.md 2.4)", () => {
  it("install rewrites each server to route through mcpseal proxy <serverName> <original...>", () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, ".mcp.json"), ORIGINAL_CONFIG, "utf-8");

    const result = install(dir);
    expect(result.serverCount).toBe(2);

    const rewritten = JSON.parse(readFileSync(path.join(dir, ".mcp.json"), "utf-8"));
    expect(rewritten.mcpServers.github).toEqual({
      command: "npx",
      args: ["-y", "mcpseal", "proxy", "github", "npx", "-y", "@modelcontextprotocol/server-github"],
    });
    expect(rewritten.mcpServers.local).toEqual({
      command: "npx",
      args: ["-y", "mcpseal", "proxy", "local", "node", "server.js"],
    });
  });

  it("creates a backup file containing the exact original bytes", () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, ".mcp.json"), ORIGINAL_CONFIG, "utf-8");
    install(dir);
    const backup = readFileSync(path.join(dir, ".mcp.json.mcpseal-backup"), "utf-8");
    expect(backup).toBe(ORIGINAL_CONFIG);
  });

  it("install -> uninstall round-trips the config byte-for-byte", () => {
    const dir = tmpDir();
    const configPath = path.join(dir, ".mcp.json");
    writeFileSync(configPath, ORIGINAL_CONFIG, "utf-8");

    install(dir);
    expect(readFileSync(configPath, "utf-8")).not.toBe(ORIGINAL_CONFIG); // sanity: it did change

    uninstall(dir);
    expect(readFileSync(configPath, "utf-8")).toBe(ORIGINAL_CONFIG);
  });

  it("uninstall removes the backup file", () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, ".mcp.json"), ORIGINAL_CONFIG, "utf-8");
    install(dir);
    uninstall(dir);
    expect(existsSync(path.join(dir, ".mcp.json.mcpseal-backup"))).toBe(false);
  });

  it("install throws if config is missing", () => {
    const dir = tmpDir();
    expect(() => install(dir)).toThrow();
  });

  it("install throws if already installed (backup already exists)", () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, ".mcp.json"), ORIGINAL_CONFIG, "utf-8");
    install(dir);
    expect(() => install(dir)).toThrow();
  });

  it("uninstall throws if not installed (no backup)", () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, ".mcp.json"), ORIGINAL_CONFIG, "utf-8");
    expect(() => uninstall(dir)).toThrow();
  });

  it("accepts a custom mcpseal invocation (for local dev/testing before publish)", () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, ".mcp.json"), ORIGINAL_CONFIG, "utf-8");
    install(dir, { command: "node", args: ["/path/to/dist/cli.js"] });
    const rewritten = JSON.parse(readFileSync(path.join(dir, ".mcp.json"), "utf-8"));
    expect(rewritten.mcpServers.github.command).toBe("node");
    expect(rewritten.mcpServers.github.args[0]).toBe("/path/to/dist/cli.js");
  });
});
