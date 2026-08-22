// Real publishing blocker found via testing (docs/Tasks.md 2.7 verification
// notes): `pnpm pack` rewrites the workspace:^ deps on @mcpseal/cli-core and
// @mcpseal/shared-types to plain semver ranges (e.g. ^0.1.0) — but those
// packages are internal-only and were never published to npm, so a real
// `npm install mcpseal` from outside this monorepo would 404 resolving
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
  // @napi-rs/keyring is a native addon distributed as prebuilt per-platform
  // binaries via its own optionalDependencies — esbuild can't bundle a
  // native .node file, and doesn't need to: npm installs the right binary
  // for the consumer's platform automatically as long as the package stays
  // a real (unbundled) dependency.
  external: ["@napi-rs/keyring"],
});

console.log("Bundled dist/cli.js (self-contained, no workspace-internal runtime deps)");
