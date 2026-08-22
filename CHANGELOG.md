# Changelog

All notable changes to `mcpseal` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Both the npm package (`mcpseal`) and the PyPI package (`mcpseal`) are released together and always share a version number.

## [Unreleased]

Nothing yet.

## [0.1.4] — 2026-08-23

### Fixed

- **`mcpseal logout` crashed on any machine with no OS keychain** (headless Linux, containers), exiting 1 with an opaque `[UNKNOWN_ERROR]`. `new Entry()` — the call that actually reaches the platform credential store — sat *outside* the `try` block in every function in `keychain.ts`, so the catch never ran. The identical defect had already been fixed in `cli-python` in 0.1.2; this was a cross-language parity miss, and it shipped in 0.1.3.
- Removed a message-text heuristic added in 0.1.3 that tried to distinguish a *locked* keychain from an *absent* one by pattern-matching English error strings. `@napi-rs/keyring` reports both as generic errors, and the pattern matched the no-backend message (`Couldn't access platform storage: PermissionDenied`) — so it would have rethrown on exactly the machines the fix was meant to help. `logout` no longer crashes; callers needing the stronger guarantee use the new `secretIsCleared()` to confirm the credential is actually gone.

### Unchanged, deliberately

- `setSecret()` still fails loudly when the keychain is unreachable. Verified directly on a headless Linux container: it throws, and the secret appears in no file on disk — secrets never degrade to a plaintext fallback (invariant 6).

## [0.1.3] — 2026-08-23

### Fixed

- **`recent_blocks` / `recentBlocks` returned the wrong event on a timestamp tie.** Both languages sorted the block audit trail by timestamp alone, and both languages' sorts are stable, so the *oldest* event of a tied group was reported as the most recent block. Ties are routine given millisecond precision and coarse clock granularity. Ties now break by append order.

### Changed

- **`engines.node` corrected from `>=18` to `>=20.19.0`.** `@noble/curves@2` requires Node ≥20.19, so on Node 18 `npx mcpseal` emitted `EBADENGINE` and ran only incidentally. Node 18 reached end-of-life in April 2025.

### Added

- **`mcpseal --version` / `-v` / `version`**, printing a bare pipeable version string.
- Version-consistency tests in both languages; a rug-pull-mid-session test; `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, README badges and repo links.

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

[Unreleased]: https://github.com/confuseddude/mcpseal/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/confuseddude/mcpseal/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/confuseddude/mcpseal/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/confuseddude/mcpseal/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/confuseddude/mcpseal/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/confuseddude/mcpseal/releases/tag/v0.1.0
