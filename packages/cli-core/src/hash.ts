// build-bible.md Part 2.1 / 2.2: the pinned hash covers exactly
// { name, description, inputSchema } — nothing else. Extra fields on the
// input (version strings, timestamps, etc.) must never leak into the hash.
import { createHash } from "node:crypto";
import { canonicalize } from "./canonical-json.js";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
}

// Strictly extracts only the three hashed fields and validates their types
// before hashing, so a malformed tool object throws instead of silently
// producing a hash that looks valid (fail closed — CLAUDE.md invariant 1).
export function hashTool(tool: McpTool): string {
  if (typeof tool?.name !== "string") {
    throw new Error("hashTool: tool.name must be a string");
  }
  if (typeof tool?.description !== "string") {
    throw new Error("hashTool: tool.description must be a string");
  }
  if (typeof tool?.inputSchema !== "object" || tool.inputSchema === null) {
    throw new Error("hashTool: tool.inputSchema must be an object");
  }

  const canonicalObject = {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };

  const canonicalBytes = canonicalize(canonicalObject);
  const hex = createHash("sha256").update(canonicalBytes, "utf-8").digest("hex");
  return `sha256:${hex}`;
}
