# mcpseal — Developer Quickstart

This walks a new developer from zero to a working, protected MCP setup, then through the exact experience of a rug pull being caught, without needing to understand mcpseal's internals. Every command below is real and was run to produce this document — none of it is inferred.

Two equivalent CLIs exist: `mcpseal` via Node (`npx mcpseal` once published; today, run the built `dist/cli.js`) and via Python (`uvx mcpseal` once published; today, `pip install -e .` from `packages/cli-python`). Pick one — they enforce the same security decisions.

## 1. Install (from source, pre-publish)

**Node:**
```
git clone <this repo>
cd mcp-shield
pnpm install
pnpm --filter mcpseal build
alias mcpseal='node packages/cli-node/dist/cli.js'
```

**Python:**
```
git clone <this repo>
cd mcp-shield/packages/cli-python
pip install -e .
# `mcpseal` is now a real command on your PATH
```

## 2. Point mcpseal at an MCP server

mcpseal discovers servers from your project's `.mcp.json` (Claude Code's project-scope config format):

```json
{
  "mcpServers": {
    "my-server": { "command": "node", "args": ["server.js"] }
  }
}
```

## 3. `mcpseal init` — generate the lockfile

```
mcpseal init
```

This launches every configured server once, hashes every tool it offers, and writes `.mcp-lock.json` with everything approved (trust-on-first-use). Commit this file, like `package-lock.json`.

## 4. `mcpseal install` — put the proxy in the path

```
mcpseal install
```

Rewrites `.mcp.json` so your client launches servers through `mcpseal proxy` instead of directly. A backup of the original config is kept at `.mcp.json.mcpseal-backup`. Your MCP client now runs exactly as before — mcpseal is transparent for anything that hasn't changed.

## 5. Check your install: `mcpseal status` and `mcpseal doctor`

```
mcpseal status   # what does this machine currently believe? (never touches the network)
mcpseal doctor   # is everything actually working? (local checks + a best-effort Control Plane probe)
```

`status` and `doctor` both work fully offline — an unreachable Control Plane is never treated as a local failure. Both accept `--json` for scripting.

## 6. Simulate a change (a "rug pull")

Edit the tool's description or schema on the server side (or, for a controlled test, use the fixture server at `packages/cli-node/src/test-fixtures/mutable-stub-server.mjs`, which reads its description from `MCPSEAL_TEST_DESCRIPTION`). Then re-run your client, or:

```
mcpseal scan
```

You'll see:
```
BLOCK rotator/rotatable_tool (blocked_drift)
      next: mcpseal diff
```
and a non-zero exit code — this is what CI checks for.

## 7. Inspect the change: `mcpseal diff`

```
mcpseal diff
```
Shows the exact old-vs-new description text and points you at `approve`/`deny`.

## 8. Decide: `mcpseal approve` / `mcpseal deny`

```
mcpseal approve rotator rotatable_tool   # trust the new definition
mcpseal deny rotator rotatable_tool      # block it even if the hash matches later
```

Both re-fetch the tool's *current* live definition — you're always approving what's actually being served right now, never a stale name. Both only ever change your **local** lockfile, never organization policy.

## 9. Run it live: `mcpseal proxy`

This is what `install` wires your client to run automatically; you don't normally invoke it by hand. When a blocked tool is encountered, you'll see the full diagnosis on stderr:
```
[TOOL_CHANGED] (critical)
The tool's definition (description and/or input schema) differs from the trusted baseline — a rug pull.
  server: rotator
  tool: rotatable_tool
  ...
  consequence: Blocked — the tool call never reaches the client.
  next:
    mcpseal diff
    mcpseal approve <server> <tool>   # only after reviewing the change
    mcpseal deny <server> <tool>
```

## 10. Opt into a workspace: `mcpseal login`

Entirely optional — everything above works with zero account, zero network call, forever. If your org runs the Control Plane (`services/ingest` + `services/app-api` + the dashboard):

```
mcpseal login
```
Prints a user code; an admin approves it in the dashboard's Settings page ("Connect a machine"). Once connected:
- Local blocks are shipped to your workspace's Live Feed (best-effort, never blocks or slows down local enforcement).
- `mcpseal policy-pull` fetches your org's signed lockfile and applies it — but only if the signature verifies against the org key pinned at your first login, and only if it's a newer version than you already have. Every other outcome leaves your local lockfile untouched.
- `mcpseal logout` clears the connection and both stored credentials (the workspace API key and your machine's ed25519 identity).

## 11. CI usage

```
mcpseal scan --json
```
exits non-zero specifically when drift is detected, and prints a JSON array of `{server, tool, decision, reason, code, severity}` for machine consumption. No login, no network call, no interactive step required for local lockfile verification.

## Troubleshooting: what happens when something goes wrong

| Symptom | What mcpseal tells you | Fix |
|---|---|---|
| No `.mcp-lock.json` | `LOCKFILE_NOT_FOUND` | `mcpseal init` |
| `.mcp-lock.json` is corrupted | `LOCKFILE_INVALID` | restore from git or `mcpseal init` again |
| `.mcp.json` has bad JSON/shape | `MCP_CONFIG_INVALID` | fix the JSON |
| `install` run twice | `ALREADY_INSTALLED` | `mcpseal uninstall` first if you want to reset |
| `approve`/`deny` on a server not in `.mcp.json` | `SERVER_NOT_CONFIGURED` | `mcpseal scan` to see real server names |
| `approve`/`deny` on a tool not currently live | `TOOL_NOT_FOUND` | `mcpseal scan` to see real tool names |
| MCP server won't start | `MCP_SERVER_UNAVAILABLE` | check the command/args run standalone; `mcpseal doctor` |
| MCP server slow to respond | `MCP_TIMEOUT` | usually transient (cold `npx`/`uvx` cache); retry |
| Login denied/expired | `AUTH_DENIED` / `AUTH_EXPIRED` | `mcpseal login` again |
| Login would re-pin a different org key | `AUTH_KEY_REPIN_REFUSED` (critical, refused) | verify with your org admin; `mcpseal logout` first if intentional |
| `policy-pull` signature doesn't verify | `POLICY_INVALID_SIGNATURE` (critical, rejected) | do not retry blindly — verify out-of-band with your admin |
| Control Plane unreachable | reported by `doctor`, never fails local checks | local enforcement is completely unaffected; retry later |

Run `mcpseal doctor` any time something feels wrong — every failed check names the exact command that fixes it.
