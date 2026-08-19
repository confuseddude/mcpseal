// build-bible.md Part 3.2 / Tasks.md 2.1: `mcpseal init` discovers MCP
// servers from client configs, launches each once, hashes every tool, and
// writes .mcp-lock.json with everything at status:approved
// (trust-on-first-use, matching Part 2.3's example).
import path from "node:path";
import { createEmptyLockfile, hashTool, writeLockfile, type McpTool } from "@mcpseal/cli-core";
import type { Lockfile, ServerEntry, ToolEntry } from "@mcpseal/shared-types";
import { discoverServersFromClaudeCodeProjectConfig, type DiscoveredServer } from "./config-discovery.js";
import { McpStdioClient } from "./mcp-client.js";
import { hashCommand } from "./command-hash.js";

export interface InitOptions {
  projectDir: string;
  lockfilePath?: string;
  generatedBy?: string;
}

export interface InitResult {
  lockfile: Lockfile;
  lockfilePath: string;
  serverCount: number;
  toolCount: number;
}

async function hashOneServer(server: DiscoveredServer, projectDir: string): Promise<ServerEntry> {
  const client = new McpStdioClient(
    { command: server.command, args: server.args },
    { cwd: projectDir }
  );
  try {
    await client.initialize();
    const tools = await client.listTools();

    const toolEntries: Record<string, ToolEntry> = {};
    const now = new Date().toISOString();
    for (const tool of tools) {
      const hashed = hashTool(tool as McpTool);
      toolEntries[tool.name] = {
        hash: hashed,
        description: tool.description,
        approvedAt: now,
        approvedBy: "local",
        status: "approved",
      };
    }

    return {
      transport: "stdio",
      command: server.command,
      args: server.args,
      commandHash: hashCommand(server),
      tools: toolEntries,
    };
  } finally {
    client.close();
  }
}

export async function init(options: InitOptions): Promise<InitResult> {
  const servers = discoverServersFromClaudeCodeProjectConfig(options.projectDir);

  const lockfile = createEmptyLockfile(options.generatedBy);
  let toolCount = 0;

  for (const server of servers) {
    const entry = await hashOneServer(server, options.projectDir);
    lockfile.servers[server.name] = entry;
    toolCount += Object.keys(entry.tools).length;
  }

  const lockfilePath = options.lockfilePath ?? path.join(options.projectDir, ".mcp-lock.json");
  writeLockfile(lockfilePath, lockfile);

  return { lockfile, lockfilePath, serverCount: servers.length, toolCount };
}
