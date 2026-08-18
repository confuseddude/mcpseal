// Real integration test: spawns an actual child process (the stub server)
// through an actual runProxy(), feeding it real newline-delimited JSON-RPC
// over in-memory streams playing the client's role. This is the same
// protocol surface Claude Code would exercise by launching
// `mcplock proxy <original command>` (build-bible.md Part 3.3) — no piece
// of the pipe is mocked, only the "client" driving it is a test harness
// instead of a literal Claude Code process (not practical to script
// end-to-end in this environment; see Tasks.md 2.2 verification notes).
import { describe, expect, it, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashTool } from "@mcplock/cli-core";
import type { Lockfile } from "@mcplock/shared-types";
import { runProxy, type ProxyHandle } from "./proxy.js";
import type { McpToolDefinition } from "./mcp-client.js";

const stubServerPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "test-fixtures/stub-server.mjs"
);

const safeTool: McpToolDefinition = {
  name: "safe_tool",
  description: "Does a safe thing",
  inputSchema: { type: "object" },
};
const deniedTool: McpToolDefinition = {
  name: "denied_tool",
  description: "A tool the operator denied",
  inputSchema: { type: "object" },
};

function lockfile(): Lockfile {
  return {
    version: 1,
    generatedAt: "2026-08-17T00:00:00Z",
    generatedBy: "mcplock@test",
    servers: {
      stub: {
        transport: "stdio",
        command: "node",
        args: [stubServerPath],
        commandHash: "sha256:cmd",
        tools: {
          safe_tool: {
            hash: hashTool(safeTool),
            description: safeTool.description,
            approvedAt: "2026-08-17T00:00:00Z",
            approvedBy: "local",
            status: "approved",
          },
          denied_tool: {
            hash: hashTool(deniedTool),
            description: deniedTool.description,
            approvedAt: "2026-08-17T00:00:00Z",
            approvedBy: "local",
            status: "denied",
          },
        },
      },
    },
    policy: { onDrift: "block", onUnknownTool: "block", allowNewToolsFromApprovedServer: false },
    signature: null,
  };
}

let handle: ProxyHandle | undefined;
afterEach(() => {
  handle?.stop();
  handle = undefined;
});

function readLines(stream: PassThrough): { next: () => Promise<unknown> } {
  let buffer = "";
  const queue: string[] = [];
  const waiters: Array<(v: unknown) => void> = [];
  stream.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      const waiter = waiters.shift();
      if (waiter) waiter(parsed);
      else queue.push(line);
    }
  });
  return {
    next: () =>
      new Promise((resolve) => {
        if (queue.length > 0) {
          resolve(JSON.parse(queue.shift()!));
        } else {
          waiters.push(resolve);
        }
      }),
  };
}

describe("runProxy — real child process, real stdio piping (Part 3.3)", () => {
  it("forwards initialize untouched, and strips a denied tool from tools/list while keeping the approved one", async () => {
    const clientToProxy = new PassThrough();
    const proxyToClient = new PassThrough();
    const lines = readLines(proxyToClient);

    handle = runProxy({
      server: { command: "node", args: [stubServerPath] },
      serverName: "stub",
      lockfile: lockfile(),
      input: clientToProxy,
      output: proxyToClient,
    });

    clientToProxy.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } },
      }) + "\n"
    );
    const initResponse: any = await lines.next();
    expect(initResponse.id).toBe(1);
    expect(initResponse.result.protocolVersion).toBe("2024-11-05");

    clientToProxy.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    clientToProxy.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
    const toolsResponse: any = await lines.next();
    expect(toolsResponse.id).toBe(2);
    const names = toolsResponse.result.tools.map((t: McpToolDefinition) => t.name);
    expect(names).toEqual(["safe_tool"]);
    expect(names).not.toContain("denied_tool");
  }, 10_000);

  it("passes ordinary tool-call traffic through unmodified (verifier, not rewriter)", async () => {
    const clientToProxy = new PassThrough();
    const proxyToClient = new PassThrough();
    const lines = readLines(proxyToClient);

    handle = runProxy({
      server: { command: "node", args: [stubServerPath] },
      serverName: "stub",
      lockfile: lockfile(),
      input: clientToProxy,
      output: proxyToClient,
    });

    clientToProxy.write(
      JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "safe_tool", arguments: { x: 1 } } }) +
        "\n"
    );
    const callResponse: any = await lines.next();
    expect(callResponse).toEqual({
      jsonrpc: "2.0",
      id: 5,
      result: { echoed: { name: "safe_tool", arguments: { x: 1 } } },
    });
  }, 10_000);
});
