// build-bible.md Part 2.3 says commandHash "pins the command+args that
// launch the server" but doesn't specify the exact hash input — a spec gap,
// not a contradiction. Judgment call (logged in Tasks.md's Change Log):
// sha256 of the canonical JSON of {command, args}, reusing the same
// canonicalization machinery as tool hashing for consistency.
import { createHash } from "node:crypto";
import { canonicalize } from "@mcpseal/cli-core";
import type { McpServerCommand } from "./mcp-client.js";

export function hashCommand(cmd: McpServerCommand): string {
  const canonicalBytes = canonicalize({ command: cmd.command, args: cmd.args });
  const hex = createHash("sha256").update(canonicalBytes, "utf-8").digest("hex");
  return `sha256:${hex}`;
}
