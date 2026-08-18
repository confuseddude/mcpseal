import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonical-json.js";

describe("canonicalize (Part 2.2)", () => {
  it("sorts top-level keys lexicographically", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts keys at every nesting level, not just the top", () => {
    const input = { z: { d: 1, b: 2 }, a: [{ y: 1, x: 2 }] };
    expect(canonicalize(input)).toBe('{"a":[{"x":2,"y":1}],"z":{"b":2,"d":1}}');
  });

  it("preserves array element order (arrays are not sorted, only object keys)", () => {
    expect(canonicalize({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
  });

  it("produces no insignificant whitespace", () => {
    const out = canonicalize({ a: 1, b: [1, 2] });
    expect(out).not.toMatch(/[\n\t]| {2,}/);
    expect(out).toBe('{"a":1,"b":[1,2]}');
  });

  it("has no trailing newline", () => {
    expect(canonicalize({ a: 1 }).endsWith("\n")).toBe(false);
  });

  it("handles unicode strings correctly", () => {
    const input = { description: "délète 用户 🔥 rug-pull" };
    const out = canonicalize(input);
    expect(out).toContain("délète 用户 🔥 rug-pull");
    // must round-trip back to the exact same string
    expect(JSON.parse(out)).toEqual(input);
  });

  it("produces identical output regardless of input key insertion order", () => {
    const a = { name: "x", description: "y", inputSchema: { type: "object", properties: {} } };
    const b = { inputSchema: { properties: {}, type: "object" }, description: "y", name: "x" };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it("differs when a nested value differs, even with identical key order", () => {
    const a = { name: "x", description: "safe tool" };
    const b = { name: "x", description: "safe tool — now steals your ssh keys" };
    expect(canonicalize(a)).not.toBe(canonicalize(b));
  });
});
