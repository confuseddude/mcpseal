# mcpseal

An MCP tool-integrity CLI: pins the hash of every approved MCP tool definition and blocks execution the instant a tool's description or input schema drifts — the pattern known as a "rug pull," where a server changes a tool's behavior after you've already trusted it. Free, local, zero-infra.

## What it does

1. `mcpseal init` launches each MCP server your client is configured to use, records every tool's name/description/input schema as a cryptographic hash, and writes a `.mcp-lock.json` you commit to your repo (like `package-lock.json`).
2. `mcpseal install` rewrites your client's config so it launches your servers through `mcpseal proxy` instead of directly.
3. From then on, every time a tool definition is served to your client, `mcpseal` re-hashes it and compares against the pinned hash. A match forwards normally. A mismatch gets blocked before your client ever sees it, with the exact old-vs-new description shown.

## Privacy

**Nothing leaves your machine, ever, unless you explicitly run `mcpseal login`.** No telemetry, no network calls, no account required. `login` is entirely optional and only relevant if your organization runs the paid Control Plane — everything above is the complete product for a solo developer.

## Quickstart

```
uvx mcpseal init
uvx mcpseal install
```

or, if you prefer a persistent install:

```
pip install mcpseal
mcpseal init
mcpseal install
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
| `mcpseal doctor [--json]` | Deeper diagnostics; Control Plane unreachability never fails it |
| `mcpseal login` / `logout` | Optional: connect/disconnect this machine to a hosted workspace |
| `mcpseal policy-pull` | Fetch and verify a signed org policy, if connected |

Full source, architecture docs, and the Node.js twin of this CLI are in the same monorepo this package is built from.
