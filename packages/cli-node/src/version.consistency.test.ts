// CHECKLIST.md section 3: the version used to live in ~10 hand-edited
// places across both languages. A release meant grepping for the old
// number and hoping you caught them all — exactly the kind of thing that
// drifts silently and then ships a package reporting the wrong version
// in its own telemetry and lockfiles.
//
// This test is the enforcement. It fails the build if:
//   - src/version.ts disagrees with cli-node/package.json
//   - cli-python/pyproject.toml disagrees with either (releases are
//     cut together, so a partial bump is a bug, not a valid state)
//   - any source file reintroduces a hardcoded version literal
//
// That last check is the important one: without it, adding a new
// `mcpsealVersion: "0.1.2"` somewhere would pass silently until the next
// bump forgot it.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION, GENERATED_BY } from "./version.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliNodeRoot = path.resolve(here, "..");
const repoRoot = path.resolve(cliNodeRoot, "..", "..");

const SEMVER_LITERAL = /["'`](\d+\.\d+\.\d+)["'`]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__pycache__") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("version consistency (CHECKLIST.md section 3)", () => {
  it("src/version.ts matches cli-node/package.json", () => {
    const pkg = JSON.parse(readFileSync(path.join(cliNodeRoot, "package.json"), "utf-8"));
    expect(VERSION).toBe(pkg.version);
  });

  it("cli-python/pyproject.toml matches cli-node's version", () => {
    const pyproject = readFileSync(
      path.join(repoRoot, "packages", "cli-python", "pyproject.toml"),
      "utf-8"
    );
    const m = pyproject.match(/^version\s*=\s*"([^"]+)"/m);
    expect(m, "no version field found in pyproject.toml").not.toBeNull();
    expect(m![1]).toBe(VERSION);
  });

  it("cli-python/mcpseal/version.py matches cli-node's version", () => {
    const py = readFileSync(
      path.join(repoRoot, "packages", "cli-python", "mcpseal", "version.py"),
      "utf-8"
    );
    const m = py.match(/^VERSION\s*=\s*"([^"]+)"/m);
    expect(m, "no VERSION constant found in version.py").not.toBeNull();
    expect(m![1]).toBe(VERSION);
  });

  it("GENERATED_BY is derived from VERSION, not hand-written", () => {
    expect(GENERATED_BY).toBe(`mcpseal@${VERSION}`);
  });

  // cli-core's createEmptyLockfile() has a `generatedBy` default that
  // names the mcpseal CLI version (not cli-core's own package version),
  // so it cannot import cli-node. It is pinned here instead.
  it("cli-core's lockfile generatedBy default matches the release version", () => {
    const src = readFileSync(
      path.join(repoRoot, "packages", "cli-core", "src", "lockfile.ts"),
      "utf-8"
    );
    const m = src.match(/generatedBy\s*=\s*"mcpseal@([\d.]+)"/);
    expect(m, "no generatedBy default found in cli-core/src/lockfile.ts").not.toBeNull();
    expect(m![1]).toBe(VERSION);
  });

  it("no source file reintroduces a hardcoded version literal", () => {
    const roots = [
      path.join(cliNodeRoot, "src"),
      path.join(repoRoot, "packages", "cli-python", "mcpseal"),
    ];
    const offenders: string[] = [];

    for (const root of roots) {
      for (const file of walk(root)) {
        if (!/\.(ts|py)$/.test(file)) continue;
        // The version modules are where the literal is allowed to live.
        if (/[\\/]version\.(ts|py)$/.test(file)) continue;
        if (file.endsWith("version.consistency.test.ts")) continue;

        const text = readFileSync(file, "utf-8");
        text.replace(SEMVER_LITERAL, (match, found: string, offset: number) => {
          // Ignore MCP protocol dates/versions and other unrelated semvers
          // by only flagging literals equal to the current release version
          // — those are the ones that silently rot on the next bump.
          if (found !== VERSION) return match;
          const line = text.slice(0, offset).split("\n").length;
          offenders.push(`${path.relative(repoRoot, file)}:${line}`);
          return match;
        });
      }
    }

    expect(
      offenders,
      `Hardcoded "${VERSION}" found. Import VERSION from the version module instead:\n  ${offenders.join(
        "\n  "
      )}`
    ).toEqual([]);
  });
});
