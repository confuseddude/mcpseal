// Real publishing blocker found via testing (Tasks.md 2.7 verification
// notes): `pnpm pack` rewrites the workspace:^ deps on @mcplock/cli-core and
// @mcplock/shared-types to plain semver ranges (e.g. ^0.1.0) — but those
// packages are internal-only and were never published to npm, so a real
// `npm install mcplock` from outside this monorepo would 404 resolving
// them. Bundling the CLI entrypoint into a single self-contained file with
// esbuild removes that runtime dependency entirely; node builtins stay
// external automatically under platform:"node".
//
// No `banner` option here: esbuild already preserves a shebang line that's
// literally the first line of the entry file (src/cli.ts has one) — adding
// a banner on top of that duplicates it, which is a syntax error (a bare
// `#!...` on any line but the very first isn't valid JS). Found via actual
// execution testing, not assumed.
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/cli.js",
  allowOverwrite: true,
});

console.log("Bundled dist/cli.js (self-contained, no workspace-internal runtime deps)");
