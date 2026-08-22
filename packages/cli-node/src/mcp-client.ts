// Minimal MCP stdio client: spawns a server process and speaks newline-
// delimited JSON-RPC (confirmed empirically against a real reference server
// — see Tasks.md 2.1 verification notes; the MCP stdio transport is one
// JSON-RPC message per line, no Content-Length framing).
//
// This deliberately lives in cli-node, not cli-core: cli-core is the
// canonical hashing/drift spec and CLAUDE.md says to keep it lean and
// auditable (the trust-critical path). Spawning processes and speaking a
// wire protocol is CLI/product plumbing, not part of that spec.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { VERSION } from "./version.js";
import { killProcessTree } from "./process-utils.js";

export interface McpServerCommand {
  command: string;
  args: string[];
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
  [extra: string]: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private closed = false;
  private closeError: Error | undefined;

  constructor(serverCommand: McpServerCommand, options?: { cwd?: string; shell?: boolean }) {
    this.child = spawn(serverCommand.command, serverCommand.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: options?.cwd,
      shell: options?.shell ?? true,
    });
    // Forward the spawned process's stderr so diagnostics (e.g. mcpseal
    // proxy's own "blocked tool" logging) are visible to whoever is running
    // this client, not silently buffered in an unread pipe.
    this.child.stderr.pipe(process.stderr);

    this.child.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
    this.child.on("error", (err) => this.onClose(err));
    this.child.on("exit", (code, signal) => {
      if (!this.closed) {
        this.onClose(new Error(`server process exited (code=${code}, signal=${signal}) before responding`));
      }
    });
  }

  private onStdout(chunk: Buffer): void {
    this.buffer += chunk.toString("utf-8");
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // not a JSON-RPC message we can correlate; ignore (e.g. partial/garbage)
    }
    if (msg.id === undefined) return; // notification, not a response to a request
    const waiter = this.pending.get(msg.id);
    if (!waiter) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      waiter.reject(new Error(`MCP server error ${msg.error.code}: ${msg.error.message}`));
    } else {
      waiter.resolve(msg.result);
    }
  }

  private onClose(err: Error): void {
    this.closed = true;
    this.closeError = err;
    for (const [, waiter] of this.pending) {
      waiter.reject(err);
    }
    this.pending.clear();
  }

  private request(method: string, params: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(this.closeError ?? new Error("MCP client is closed"));
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.child.stdin.write(payload + "\n");
    });
  }

  private notify(method: string, params?: unknown): void {
    if (this.closed) return;
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.child.stdin.write(payload + "\n");
  }

  async initialize(): Promise<unknown> {
    const result = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcpseal", version: VERSION },
    });
    this.notify("notifications/initialized");
    return result;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = (await this.request("tools/list", {})) as { tools?: McpToolDefinition[] };
    return result.tools ?? [];
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    killProcessTree(this.child);
  }
}
