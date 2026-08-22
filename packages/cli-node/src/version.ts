// Single source of truth for the CLI's own version string.
//
// Before this existed the version was hand-copied into event-log.ts,
// login.ts, mcp-client.ts and cli-core's lockfile default, and every
// release meant grepping for the old number and editing each site by
// hand. version.consistency.test.ts now fails the build if this constant
// and package.json ever disagree, or if cli-python's pyproject.toml
// drifts from either — so a half-finished version bump cannot ship.
//
// This is deliberately a plain constant rather than a build-time inject
// (esbuild `define`) so that vitest, which runs the unbundled sources,
// sees exactly what the shipped bundle sees.
export const VERSION = "0.1.3";

// What goes in a lockfile's `generatedBy` field and the MCP handshake's
// clientInfo.version — kept here so the format is defined once.
export const GENERATED_BY = `mcpseal@${VERSION}`;
