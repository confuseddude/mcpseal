// build-bible.md Part 2.3: read/write for .mcp-lock.json.
// Fail-closed path (CLAUDE.md invariant 1): a missing or malformed lockfile
// must throw, never silently return null/empty — a caller that forgets to
// handle the exception should crash loudly rather than proceed as if
// everything were unapproved (or worse, approved).
import { readFileSync, writeFileSync } from "node:fs";
import type { Lockfile } from "@mcpseal/shared-types";

const REQUIRED_TOP_LEVEL_KEYS: (keyof Lockfile)[] = [
  "version",
  "generatedAt",
  "generatedBy",
  "servers",
  "policy",
  "signature",
];

function assertValidLockfileShape(value: unknown, path: string): asserts value is Lockfile {
  if (typeof value !== "object" || value === null) {
    throw new Error(`readLockfile: ${path} does not contain a JSON object`);
  }
  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in value)) {
      throw new Error(`readLockfile: ${path} is missing required field "${key}"`);
    }
  }
}

export function readLockfile(path: string): Lockfile {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(`readLockfile: could not read ${path}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`readLockfile: ${path} is not valid JSON: ${(err as Error).message}`);
  }

  assertValidLockfileShape(parsed, path);
  return parsed;
}

export function writeLockfile(path: string, lockfile: Lockfile): void {
  writeFileSync(path, JSON.stringify(lockfile, null, 2), "utf-8");
}

export function createEmptyLockfile(generatedBy = "mcpseal@0.1.2"): Lockfile {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    generatedBy,
    servers: {},
    policy: {
      onDrift: "block",
      onUnknownTool: "block",
      allowNewToolsFromApprovedServer: false,
    },
    signature: null,
  };
}
