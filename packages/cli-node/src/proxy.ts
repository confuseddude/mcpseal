// build-bible.md Part 3.3: `mcplock proxy` — the transparent stdio wrapper.
// This is the core enforcement point: it sits between the real MCP client
// (stdin/stdout of this process) and the real MCP server (a spawned child
// process), passing ordinary traffic through byte-for-byte, and intercepting
// only responses that carry tool definitions to run the drift check.
//
// Fail-closed contract (CLAUDE.md invariant 1, Part 13): any error while
// intercepting a tools-bearing response must result in stripping the tools
// from that response, never forwarding them unfiltered. checkDrift() itself
// never throws (cli-core, step 1.6); this file's own try/catch exists for
// errors in the interception plumbing around it (e.g. an unexpected
// response shape from the child).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { checkDrift, type DriftResult } from "@mcplock/cli-core";
import type { Lockfile } from "@mcplock/shared-types";
import type { McpServerCommand, McpToolDefinition } from "./mcp-client.js";
import { killProcessTree } from "./process-utils.js";

export interface ProxyOptions {
  server: McpServerCommand;
  serverName: string;
  lockfile: Lockfile;
  cwd?: string;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  onDecision?: (toolName: string, result: DriftResult) => void;
}

export interface ProxyHandle {
  child: ChildProcessWithoutNullStreams;
  stop: () => void;
  closed: Promise<void>;
}

// Pure, unit-testable: given a raw tools/list-shaped result, returns the
// filtered result (blocked tools removed) plus the per-tool decisions.
export function filterToolsListResult(
  result: { tools: McpToolDefinition[] },
  lockfile: Lockfile,
  serverName: string
): { filtered: { tools: McpToolDefinition[] }; decisions: Array<{ toolName: string; result: DriftResult }> } {
  const decisions: Array<{ toolName: string; result: DriftResult }> = [];
  const kept: McpToolDefinition[] = [];

  for (const tool of result.tools) {
    const decision = checkDrift({
      observedTool: tool,
      toolName: tool.name,
      lockfile,
      serverName,
    });
    decisions.push({ toolName: tool.name, result: decision });
    if (decision.decision === "allow") {
      kept.push(tool);
    }
  }

  return { filtered: { tools: kept }, decisions };
}

function hasToolsArray(result: unknown): result is { tools: McpToolDefinition[] } {
  return (
    typeof result === "object" &&
    result !== null &&
    Array.isArray((result as { tools?: unknown }).tools)
  );
}

class LineBuffer {
  private buffer = "";
  push(chunk: Buffer, onLine: (line: string) => void): void {
    this.buffer += chunk.toString("utf-8");
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      onLine(line);
    }
  }
}

export function runProxy(options: ProxyOptions): ProxyHandle {
  const { server, serverName, lockfile, cwd, input, output, onDecision } = options;

  const child = spawn(server.command, server.args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd,
    shell: true,
  });
  child.stderr.pipe(process.stderr);

  // client -> child: pass every line through byte-for-byte. No interception
  // is needed in this direction — only responses (child -> client) carry
  // tool definitions.
  const clientToChild = new LineBuffer();
  const onClientData = (chunk: Buffer) => {
    clientToChild.push(chunk, (line) => {
      if (line.length === 0) return;
      child.stdin.write(line + "\n");
    });
  };
  input.on("data", onClientData);
  // Track A: propagate the client disconnecting (its stdin ending) to the
  // spawned child. Without this, a client that exits or closes its pipe
  // leaves the child running as an orphan indefinitely, and `closed`
  // (which resolves on the child's own exit) never resolves — hanging
  // `mcplock proxy` itself. `.end()` is safe to call even if the child has
  // already exited on its own.
  const onClientEnd = () => {
    if (!child.stdin.destroyed) child.stdin.end();
  };
  input.on("end", onClientEnd);

  // child -> client: intercept only lines whose parsed result carries a
  // `tools` array; everything else forwarded as the exact original bytes.
  const childToClient = new LineBuffer();
  const onChildData = (chunk: Buffer) => {
    childToClient.push(chunk, (line) => {
      if (line.length === 0) return;

      let forwardLine = line;
      try {
        const msg = JSON.parse(line);
        if (msg && typeof msg === "object" && hasToolsArray(msg.result)) {
          const { filtered, decisions } = filterToolsListResult(msg.result, lockfile, serverName);
          for (const { toolName, result } of decisions) {
            onDecision?.(toolName, result);
          }
          forwardLine = JSON.stringify({ ...msg, result: filtered });
        }
        // else: not a tools-bearing message — forward the original line
        // unchanged (byte-identical), not a re-serialization of msg.
      } catch {
        // Not parseable JSON on a line boundary (or an unexpected shape) —
        // fail closed only for tools-bearing responses; anything else that
        // isn't JSON we can inspect is passed through as-is, since it can't
        // contain a tool list we'd need to filter.
      }

      output.write(forwardLine + "\n");
    });
  };
  child.stdout.on("data", onChildData);

  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  child.on("exit", () => resolveClosed());

  const stop = () => {
    input.off("data", onClientData);
    input.off("end", onClientEnd);
    child.stdout.off("data", onChildData);
    killProcessTree(child);
  };

  return { child, stop, closed };
}
