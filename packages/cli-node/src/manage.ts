// build-bible.md Part 3.2, docs/Tasks.md 2.6: `mcpseal approve <tool>` /
// `mcpseal deny <tool>`. Design (docs/Tasks.md Change Log): both re-fetch the
// tool's CURRENT live definition from the server and write that hash +
// description into the lockfile with the new status — "approve" and "deny"
// both mean "trust/distrust exactly what the server reports right now,"
// which uniformly covers the quarantined/unknown/drifted cases Part 3.2
// describes without needing separate code paths for each.
import path from "node:path";
import { readLockfile, writeLockfile, hashTool, type McpTool } from "@mcpseal/cli-core";
import type { ToolStatus } from "@mcpseal/shared-types";
import { discoverServersFromClaudeCodeProjectConfig } from "./config-discovery.js";
import { McpStdioClient } from "./mcp-client.js";
import { hashCommand } from "./command-hash.js";

export interface SetToolStatusResult {
  serverName: string;
  toolName: string;
  status: ToolStatus;
  hash: string;
}

export async function setToolStatus(
  projectDir: string,
  serverName: string,
  toolName: string,
  status: ToolStatus,
  lockfilePath?: string
): Promise<SetToolStatusResult> {
  const resolvedLockfilePath = lockfilePath ?? path.join(projectDir, ".mcp-lock.json");
  const servers = discoverServersFromClaudeCodeProjectConfig(projectDir);
  const server = servers.find((s) => s.name === serverName);
  if (!server) {
    throw new Error(`setToolStatus: server "${serverName}" is not in this project's .mcp.json`);
  }

  const client = new McpStdioClient({ command: server.command, args: server.args }, { cwd: projectDir });
  let tool: McpTool | undefined;
  try {
    await client.initialize();
    const liveTools = await client.listTools();
    tool = liveTools.find((t) => t.name === toolName);
  } finally {
    client.close();
  }
  if (!tool) {
    throw new Error(`setToolStatus: tool "${toolName}" was not found on server "${serverName}"'s current tool list`);
  }

  const lockfile = readLockfile(resolvedLockfilePath);
  if (!lockfile.servers[serverName]) {
    lockfile.servers[serverName] = {
      transport: "stdio",
      command: server.command,
      args: server.args,
      commandHash: hashCommand(server),
      tools: {},
    };
  }

  const hash = hashTool(tool);
  lockfile.servers[serverName].tools[toolName] = {
    hash,
    description: tool.description,
    approvedAt: new Date().toISOString(),
    approvedBy: "local",
    status,
  };

  writeLockfile(resolvedLockfilePath, lockfile);
  return { serverName, toolName, status, hash };
}
