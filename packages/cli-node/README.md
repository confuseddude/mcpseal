# mcpseal

[![npm](https://img.shields.io/npm/v/mcpseal?logo=npm&label=npm)](https://www.npmjs.com/package/mcpseal)
[![CI](https://github.com/confuseddude/mcpseal/actions/workflows/parity.yml/badge.svg)](https://github.com/confuseddude/mcpseal/actions/workflows/parity.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/confuseddude/mcpseal/blob/master/LICENSE)

**Source, issues and docs: https://github.com/confuseddude/mcpseal**

An MCP tool-integrity CLI: pins the hash of every approved MCP tool definition and blocks execution the instant a tool's description or input schema drifts — the pattern known as a "rug pull," where a server changes a tool's behavior after you've already trusted it. Free, local, zero-infra.

## What it does

1. `mcpseal init` launches each MCP server your client is configured to use, records every tool's name/description/input schema as a cryptographic hash, and writes a `.mcp-lock.json` you commit to your repo (like `package-lock.json`).
2. `mcpseal install` rewrites your client's config so it launches your servers through `mcpseal proxy` instead of directly.
3. From then on, every time a tool definition is served to your client, `mcpseal` re-hashes it and compares against the pinned hash. A match forwards normally. A mismatch gets blocked before your client ever sees it, with the exact old-vs-new description shown.

## Privacy

**Nothing leaves your machine, ever, unless you explicitly run `mcpseal login`.** No telemetry, no network calls, no account required. `login` is entirely optional and only relevant if your organization runs the paid Control Plane — everything above is the complete product for a solo developer.

## Quickstart

```
npx mcpseal@latest init
npx mcpseal@latest install
```

## Commands

| Command | What it does |
|---|---|
| `mcpseal init` | Discover MCP servers, hash every tool, write `.mcp-lock.json` |
| `mcpseal install` | Route your client's servers through the proxy |
| `mcpseal uninstall` | Restore your original client config exactly |
| `mcpseal scan [--json]` | Re-check all tools now; non-zero exit on drift (CI-friendly) |
| `mcpseal approve <server> <tool>` | Trust a tool's current definition (local lockfile only) |
| `mcpseal deny <server> <tool>` | Block a tool even if its hash matches |
| `mcpseal diff` | Show the old-vs-new description for any drifted tool |
| `mcpseal status [--json]` | LOCAL HEALTH + CONTROL PLANE summary, always works offline |
| `mcpseal doctor [--json] [--check-updates]` | Deeper diagnostics; Control Plane unreachability never fails it |
| `mcpseal login` / `logout` | Optional: connect/disconnect this machine to a hosted workspace |
| `mcpseal policy-pull` | Fetch and verify a signed org policy, if connected |

Full source, architecture docs, and the Python twin of this CLI (`uvx mcpseal`) are in the same monorepo this package is built from.

## Verifying what you installed

Every release is published from GitHub Actions with no stored credentials, and carries build provenance you can check yourself:

```bash
mcpseal --version
npm audit signatures            # npm: verifies the SLSA provenance attestation
```

PyPI attestations (PEP 740) are shown on the [project page](https://pypi.org/project/mcpseal/) and name the exact repo, workflow and commit that produced the artifact.

## Reporting a vulnerability

See [SECURITY.md](https://github.com/confuseddude/mcpseal/blob/master/SECURITY.md).
