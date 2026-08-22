// build-bible.md Part 3.2, docs/Tasks.md 2.6: `mcpseal scan` — one-shot re-hash
// of all currently configured tools against the lockfile, CI-friendly
// (non-zero exit on any drift/block).
import { readLockfile, checkDrift, type DriftResult } from "@mcpseal/cli-core";
import { discoverServersFromClaudeCodeProjectConfig } from "./config-discovery.js";
import { McpStdioClient } from "./mcp-client.js";
import path from "node:path";

export interface ScanDecision {
  serverName: string;
  toolName: string;
  result: DriftResult;
}

export async function scan(projectDir: string, lockfilePath?: string): Promise<ScanDecision[]> {
  const resolvedLockfilePath = lockfilePath ?? path.join(projectDir, ".mcp-lock.json");
  const lockfile = readLockfile(resolvedLockfilePath);
  const servers = discoverServersFromClaudeCodeProjectConfig(projectDir);

  const decisions: ScanDecision[] = [];

  for (const server of servers) {
    const client = new McpStdioClient({ command: server.command, args: server.args }, { cwd: projectDir });
    try {
      await client.initialize();
      const liveTools = await client.listTools();
      const liveNames = new Set(liveTools.map((t) => t.name));

      for (const tool of liveTools) {
        decisions.push({
          serverName: server.name,
          toolName: tool.name,
          result: checkDrift({ observedTool: tool, toolName: tool.name, lockfile, serverName: server.name }),
        });
      }

      // Case 5 (Part 2.4): lockfile tools no longer present on the live server.
      const lockfileTools = lockfile.servers[server.name]?.tools ?? {};
      for (const toolName of Object.keys(lockfileTools)) {
        if (!liveNames.has(toolName)) {
          decisions.push({
            serverName: server.name,
            toolName,
            result: checkDrift({ observedTool: undefined, toolName, lockfile, serverName: server.name }),
          });
        }
      }
    } finally {
      client.close();
    }
  }

  return decisions;
}
