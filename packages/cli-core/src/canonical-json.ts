// Canonicalization per build-bible.md Part 2.2: keys sorted lexicographically
// at every nesting level, no insignificant whitespace, UTF-8, no trailing
// newline. Never use JSON.stringify directly here — it doesn't guarantee key
// order. `canonicalize` (github.com/erdtman/canonicalize) implements RFC 8785
// (JSON Canonicalization Scheme) and is the maintained, widely-used library
// for this; json-canonicalize@2.0.1 was tried first but its published npm
// package is broken (main entry points at a bundle that was never shipped).
import canonicalizeJcs from "canonicalize";

export function canonicalize(obj: unknown): string {
  const result = canonicalizeJcs(obj);
  if (result === undefined) {
    throw new Error("canonicalize: input serialized to undefined (not valid JSON)");
  }
  return result;
}
