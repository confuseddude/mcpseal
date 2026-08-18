// build-bible.md Part 3.3: MCP clients launch servers from a config file
// specifying `command` and `args`. Task 2.1 (Tasks.md): "start with one
// client — Claude Code's config — expand later."
//
// Claude Code's project-scope config is `.mcp.json` at the project root:
//   { "mcpServers": { "<name>": { "command": "...", "args": [...] } } }
// (Claude Code also has a user-scope entry in ~/.claude.json under the same
// "mcpServers" key per project path, but that file holds a lot of unrelated
// session state — starting with the project-scope file is the safer, more
// self-contained first target; expand to user-scope in a later pass.)
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { McpServerCommand } from "./mcp-client.js";

export interface DiscoveredServer extends McpServerCommand {
  name: string;
}

export function discoverServersFromClaudeCodeProjectConfig(projectDir: string): DiscoveredServer[] {
  const configPath = path.join(projectDir, ".mcp.json");
  if (!existsSync(configPath)) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    throw new Error(`discoverServers: ${configPath} is not valid JSON: ${(err as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null || !("mcpServers" in parsed)) {
    throw new Error(`discoverServers: ${configPath} is missing "mcpServers"`);
  }

  const mcpServers = (parsed as { mcpServers: unknown }).mcpServers;
  if (typeof mcpServers !== "object" || mcpServers === null) {
    throw new Error(`discoverServers: ${configPath}'s "mcpServers" must be an object`);
  }

  const servers: DiscoveredServer[] = [];
  for (const [name, raw] of Object.entries(mcpServers as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null || !("command" in raw)) {
      throw new Error(`discoverServers: server "${name}" in ${configPath} is missing "command"`);
    }
    const entry = raw as { command: unknown; args?: unknown };
    if (typeof entry.command !== "string") {
      throw new Error(`discoverServers: server "${name}"'s "command" must be a string`);
    }
    const args = entry.args;
    if (args !== undefined && !Array.isArray(args)) {
      throw new Error(`discoverServers: server "${name}"'s "args" must be an array`);
    }
    servers.push({ name, command: entry.command, args: (args as string[] | undefined) ?? [] });
  }
  return servers;
}
