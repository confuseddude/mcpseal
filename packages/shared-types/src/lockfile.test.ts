import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Lockfile } from "./lockfile.js";

const exampleJson = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../test-vectors/part-2.3-example-lockfile.json"
  ),
  "utf-8"
);

describe("Lockfile schema (Part 2.3)", () => {
  it("round-trips the exact Part 2.3 example JSON", () => {
    const parsed: Lockfile = JSON.parse(exampleJson);
    const serialized = JSON.stringify(parsed);
    const reparsed: Lockfile = JSON.parse(serialized);
    expect(reparsed).toEqual(parsed);

    expect(parsed.version).toBe(1);
    expect(parsed.signature).toBeNull();
    expect(parsed.policy.onDrift).toBe("block");
    expect(parsed.policy.onUnknownTool).toBe("block");
    expect(parsed.policy.allowNewToolsFromApprovedServer).toBe(false);
    expect(parsed.servers.github.transport).toBe("stdio");
    expect(parsed.servers.github.tools.create_issue.status).toBe("approved");
  });
});
