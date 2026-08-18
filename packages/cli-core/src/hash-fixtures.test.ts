import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { hashTool, type McpTool } from "./hash.js";

interface Fixture {
  case: string;
  tool: McpTool;
  expectedHash: string;
  pairWith?: string;
  differsFrom?: string;
}

const fixtures: Fixture[] = JSON.parse(
  readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../test-vectors/hash-fixtures.json"
    ),
    "utf-8"
  )
);

describe("hash-fixtures.json — cross-language parity gate (Part 11, 13)", () => {
  it("has at least 10 cases", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
  });

  for (const fixture of fixtures) {
    it(`case "${fixture.case}": matches hashTool()`, () => {
      expect(hashTool(fixture.tool)).toBe(fixture.expectedHash);
    });
  }

  it("key-order pair fixtures produce identical hashes", () => {
    const pairs = fixtures.filter((f) => f.pairWith);
    expect(pairs.length).toBeGreaterThan(0);
    for (const a of pairs) {
      const b = fixtures.find((f) => f.case === a.pairWith)!;
      expect(a.expectedHash).toBe(b.expectedHash);
    }
  });

  it("content-change pair fixtures produce different hashes", () => {
    const pairs = fixtures.filter((f) => f.differsFrom);
    expect(pairs.length).toBeGreaterThan(0);
    for (const a of pairs) {
      const b = fixtures.find((f) => f.case === a.differsFrom)!;
      expect(a.expectedHash).not.toBe(b.expectedHash);
    }
  });

  it("every expectedHash is a well-formed sha256:<64-hex> string", () => {
    for (const fixture of fixtures) {
      expect(fixture.expectedHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});
