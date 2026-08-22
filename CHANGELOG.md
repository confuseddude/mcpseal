# Changelog

All notable changes to `mcpseal` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Both the npm package (`mcpseal`) and the PyPI package (`mcpseal`) are released together and always share a version number.

## [Unreleased]

### Fixed

- **`mcpseal proxy` did not work on Linux or macOS.** `subprocess.Popen([command, *args], shell=True)` behaves differently across platforms: on Windows the argument list is joined via `list2cmdline`, but on POSIX it runs `/bin/sh -c "<command>"` and demotes the remaining arguments to `$0`/`$1`/…, so MCP servers were spawned **with no arguments**. Such a server never completes the JSON-RPC handshake, and the proxy blocked indefinitely on its first response read. Only the Python package was affected — the Node implementation's `spawn(cmd, args, {shell:true})` joins correctly.
- **`mcpseal logout` crashed on machines with no OS keyring backend** (e.g. headless Linux). `delete_secret()` handled `PasswordDeleteError` but not its sibling `NoKeyringError`, so logout raised a traceback instead of succeeding as a no-op. Narrowly scoped: a *locked* keychain that does hold a secret still fails loudly, rather than letting you believe you logged out while the credential survives.

- **`recent_blocks` / `recentBlocks` returned the wrong event when timestamps tied.** Both languages sorted the audit trail by timestamp alone, and both languages' sorts are stable — so when two events shared a `ts` (routine, given millisecond precision and coarse clock granularity on Windows) the *oldest* of the tied group was reported as the most recent block. Ties are now broken by append order. Found by the Windows CI runner; it had never failed on a developer machine.

### Changed

- **`engines.node` corrected from `>=18` to `>=20.19.0`.** The old claim was false: `@noble/curves@2` requires Node ≥20.19, so on Node 18 `npx mcpseal` emitted `EBADENGINE` and ran only incidentally — with the crypto library's supported-version guarantee void on the signature-verification path. Node 18 reached end-of-life in April 2025.

### Added

- **`mcpseal --version` / `-v` / `version`** — prints the bare version string, so it's pipeable into a bug report or CI check.
- **Version-consistency tests in both languages.** The version previously lived in ~10 hand-edited places; a partial bump now fails the build instead of shipping a package that misreports itself.
- `SECURITY.md` with a private vulnerability-reporting path and an explicit in-scope/out-of-scope list.
- `CONTRIBUTING.md`, and README badges linking npm, PyPI, CI and the source repo.

## [0.1.2] — 2026-08-22

First release published via **GitHub Actions OIDC Trusted Publishing** — no long-lived npm or PyPI tokens exist for this project any more. Both artifacts now carry verifiable build provenance (npm SLSA attestation, PyPI PEP 740), so you can confirm any release was built from this repo at a specific commit.

No functional changes to the CLI itself.

## [0.1.1] — 2026-08-20

### Fixed

- `mcpseal --help` and `mcpseal -h` were not recognised — only the bare `help` subcommand worked. Reported immediately after the first publish, which is exactly the first thing anyone types.

## [0.1.0] — 2026-08-20

Initial public release of the free, local CLI (Track A).

- `init` — discover MCP servers, hash every tool definition, write `.mcp-lock.json`
- `install` / `uninstall` — route your MCP client's servers through the proxy, and restore the original config exactly
- `scan` / `diff` / `status` / `doctor` — check for drift, inspect what changed, diagnose setup
- `manage` — approve or deny individual tools
- `proxy` — the enforcement engine: re-hashes every tool definition served to your client and blocks on mismatch, fail-closed
- Cross-language canonical hashing shared by the Node and Python implementations, pinned by `test-vectors/hash-fixtures.json`

[Unreleased]: https://github.com/confuseddude/mcpseal/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/confuseddude/mcpseal/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/confuseddude/mcpseal/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/confuseddude/mcpseal/releases/tag/v0.1.0
