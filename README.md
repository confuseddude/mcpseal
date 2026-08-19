# mcpseal

An MCP tool-integrity CLI: pins the hash of every approved MCP tool definition and blocks execution the instant a tool's description or input schema drifts — the pattern known as a "rug pull," where a server changes a tool's behavior after you've already trusted it. Free, local, zero-infra.

## What it does

1. `mcpseal init` launches each MCP server your client is configured to use, records every tool's name/description/input schema as a cryptographic hash, and writes a `.mcp-lock.json` you commit to your repo (like `package-lock.json`).
2. `mcpseal install` rewrites your client's config so it launches your servers through `mcpseal proxy` instead of directly.
3. From then on, every time a tool definition is served to your client, `mcpseal` re-hashes it and compares against the pinned hash. A match forwards normally. A mismatch — the tool's description or schema changed since you approved it — gets blocked before your client ever sees it, with the exact old-vs-new description shown.

## Privacy — what leaves your machine

**Nothing.** No telemetry, no network calls, no account, no exception — until you explicitly run `mcpseal login` to join a hosted workspace. That command doesn't exist yet (it's a later milestone); until it does, there is no code path in this tool that sends anything anywhere. Everything — the lockfile, the block decisions, the local event history — stays on disk on your machine.

## Status

This is pre-release, mid-build software. It is **not yet published to npm or PyPI** — the quickstart below describes how it will work once published, plus how to run it locally today. Both distributions now have a full free-tier command-line interface (`npx mcpseal` / `uvx mcpseal`): init/proxy/install/uninstall/scan/approve/deny/diff/status. Neither distribution has `login`/hosted-workspace support yet (see the Privacy section above — that's still a later milestone for both languages).

## Quickstart (once published)

```
npx mcpseal@latest init
npx mcpseal@latest install
```

or, in Python:

```
uvx mcpseal init
uvx mcpseal install
```

That's it — `init` discovers your MCP servers from your client's config and approves everything currently there (trust-on-first-use), and `install` puts `mcpseal` in the path between your client and your real servers. Nothing to configure, no account needed.

To undo: `npx mcpseal@latest uninstall` (or `uvx mcpseal uninstall`) restores your original client config exactly.

## Running from source (today, pre-publish)

TypeScript:
```
git clone <this repo>
cd mcp-shield
pnpm install
pnpm --filter mcpseal build
node packages/cli-node/dist/cli.js init [projectDir]
node packages/cli-node/dist/cli.js install [projectDir]
```

Python:
```
git clone <this repo>
cd mcp-shield/packages/cli-python
pip install -e .
mcpseal init [projectDir]
mcpseal install [projectDir]
```

Currently supports Claude Code's project-scope config (`.mcp.json` with an `mcpServers` key at your project root).

## Commands

| Command | What it does |
|---|---|
| `mcpseal init` | Discover MCP servers, hash every tool, write `.mcp-lock.json` |
| `mcpseal install` | Route your client's servers through the proxy |
| `mcpseal uninstall` | Restore your original client config exactly |
| `mcpseal scan` | Re-check all tools against the lockfile now; non-zero exit on drift (CI-friendly) |
| `mcpseal approve <server> <tool>` | Trust a tool's current definition |
| `mcpseal deny <server> <tool>` | Block a tool even if its hash matches |
| `mcpseal diff` | Show the old-vs-new description for any drifted tool |
| `mcpseal status` | Summarize recent blocks recorded locally |

See `docs/build-bible.md` for the full architecture and `Tasks.md` for the build checklist and progress log.
