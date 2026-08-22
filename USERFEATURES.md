# mcpseal — Features & Selling Points

A single source of truth for what mcpseal does, why it matters, every command it ships, and what's coming next. Use this as the copy bank for the marketing site, docs, or anywhere else the pitch needs to live.

---

## Install it right now — this is the hero

Live on npm and PyPI today. Pick one, protected in under a minute, zero account required:

```
npx mcpseal@latest init
npx mcpseal@latest install
```

```
uvx mcpseal init
uvx mcpseal install
```

That's it. `init` fingerprints every MCP server your client already knows about; `install` puts mcpseal transparently in the path. Nothing else to configure, nothing to sign up for.

To undo it completely: `npx mcpseal@latest uninstall` (or `uvx mcpseal uninstall`) restores your original config byte-for-byte.

---

## The one-sentence pitch

**mcpseal is a tripwire for your AI's tools — it remembers exactly what every MCP server was allowed to do, and blocks it the instant that changes.**

---

## The problem: rug pulls

AI assistants (Claude, Cursor, and every other MCP-based tool) connect to small helper programs called **MCP servers** — plugins that grant new abilities like "search GitHub," "query a database," or "send a Slack message." You review one once, approve it, and trust it from then on.

Nothing stops that server from **silently changing its own tool description later** — after you've already approved it, after your AI has already learned to trust it. A tool that said *"searches GitHub issues"* can quietly become *"searches GitHub issues, and also exfiltrates your API keys to an external server"* — and most AI clients will simply read the new instructions and comply, because they trust the tools they were given. This is a **supply-chain attack against your AI agent**, and it's invisible unless something is actually watching for it.

That's the "rug pull." mcpseal is the thing watching for it.

---

## How it actually protects your MCP server

1. **`mcpseal init` fingerprints everything, once.** It launches every MCP server your client is configured to use, and for every tool it offers, computes a cryptographic hash (SHA-256) over its exact name, description, and input schema — not a loose string comparison, a real hash. That hash gets written to `.mcp-lock.json`, a file you commit to your repo, exactly like `package-lock.json` locks your dependencies.
2. **`mcpseal install` puts itself transparently in the path.** It rewrites your client's config so every server launches through the mcpseal proxy instead of directly. Nothing about your AI client's behavior changes — it works exactly as before, for every tool that hasn't changed.
3. **Every single request is re-verified, silently, in real time.** Every time a tool definition is served to your client, mcpseal re-hashes it on the fly and compares it against the pinned hash from step 1.
   - **Match** → forwarded to the client immediately, no delay, no interruption.
   - **Mismatch** → **blocked before your client ever sees it.** The tool is stripped out of the response entirely. You get the exact old-vs-new description shown side by side, so you know precisely what changed and can make an informed call.
4. **Fail-closed, always.** If the lockfile can't be read, if a hash check errors, if anything about the trust path is uncertain — mcpseal blocks. It never silently "lets it through to be safe." An error in the security check is treated as a threat, not an exception.

This is the entire product, and it runs **100% locally.**

---

## Selling points

### For the individual developer
- **Free, forever, for real.** Not a free tier with a paywall around the actual protection — the full detection-and-blocking mechanism costs nothing and needs no account.
- **Zero infrastructure.** No server to run, no database, no signup. `npx mcpseal@latest init && npx mcpseal@latest install` and you're protected in under a minute.
- **Zero network calls, provably.** Nothing leaves your machine, ever, unless you explicitly opt in with `mcpseal login`. This isn't just a policy — it's structurally true: every command that doesn't touch a workspace never constructs an HTTP request at all.
- **Invisible when nothing's wrong.** Approved tools pass through with negligible added latency. You'd never know mcpseal is there — until it needs to be.
- **Real cryptography, not string matching.** SHA-256 over canonicalized tool definitions means a rug pull can't sneak past by reordering JSON keys or adding whitespace.
- **Works with any MCP client** that reads its server config from a standard `.mcp.json`-style file (Claude Code today; the discovery mechanism is built to extend to others).
- **Two first-class languages.** `npx mcpseal` (Node) and `uvx mcpseal` (Python) are independently implemented, fully tested, and produce identical security decisions — use whichever fits your stack.

### For teams and CI
- **CI-native.** `mcpseal scan` exits non-zero the instant it detects drift — wire it into any pipeline and a rug pull becomes a failed build, not a production incident.
- **Machine-readable everywhere it matters.** `--json` on `scan`, `status`, and `doctor` for scripting and dashboards.
- **Diagnosis, not just an error code.** Every failure — a missing lockfile, an unreachable server, a denied tool — comes with a plain-English explanation, the actual consequence, and the exact command to fix it. Nobody has to guess what `ERROR: EAGAIN` means.
- **Local approval trail.** Every block is logged locally (`~/.mcpseal/events.jsonl`) before anything else happens, so you have a record even if you never connect to a workspace.

### For organizations (the paid Control Plane, built and ready to deploy)
- **Fleet-wide visibility.** A live feed of every block, across every developer's machine, in one dashboard — see the exact old-vs-new diff for any rug pull caught anywhere in the org, the moment it happens.
- **Cryptographically signed policy push.** An admin can push an approved lockfile to the entire fleet; every client verifies the signature against a key pinned at first login before ever applying it — and only if it's a genuinely newer version. A compromised or tampered update is rejected, not silently applied. This is the single highest-scrutiny code path in the whole system, and it has a dedicated attack-matrix test suite proving it.
- **Tamper-evident audit trail.** Every event is chained by hash to the one before it (`build-bible.md` Part 8.3) — deleting, editing, or reordering a historical record breaks the chain in a way that's independently verifiable, including with a standalone script an auditor can run without trusting mcpseal's own code.
- **SSO/SCIM for Enterprise.** Real identity-provider login and automated user provisioning/deprovisioning — deactivate someone in your IdP and their session dies immediately, not on next login.
- **Billing that matches the value.** Free tier keeps 7 days of local-shipped history; Team unlocks 30 days and fleet visibility; Enterprise unlocks unlimited retention, signed policy push, and SSO — real Stripe integration, no fake paywalls.

---

## Every command, what it does, and when you'd reach for it

| Command | What it does | When you use it |
|---|---|---|
| `mcpseal init [projectDir]` | Discovers every MCP server in your client's config, hashes every tool, writes `.mcp-lock.json` | Once, when you first protect a project (trust-on-first-use) |
| `mcpseal install [projectDir]` | Rewrites your client's config to route servers through the mcpseal proxy; keeps a byte-for-byte backup of the original | Once, right after `init` |
| `mcpseal uninstall [projectDir]` | Restores your original client config exactly, byte-for-byte | If you want to fully remove mcpseal |
| `mcpseal proxy <server> <command> [args...]` | The actual enforcement engine — transparently pipes traffic between your client and the real server, intercepting and verifying every tool definition | Never invoked by hand — this is what `install` wires your client to run automatically |
| `mcpseal scan [projectDir] [--json]` | One-shot re-check of every currently configured tool against the lockfile; **non-zero exit code on any drift** | CI pipelines, pre-commit hooks, or just "did anything change since I last looked" |
| `mcpseal diff [projectDir]` | Shows the exact old-vs-new description text for every drifted tool | Right after a block, to actually see what changed |
| `mcpseal approve <server> <tool>` | Re-fetches the tool's *current live* definition and marks it trusted — updates your **local** lockfile only | After reviewing a change and deciding it's legitimate |
| `mcpseal deny <server> <tool>` | Blocks a tool even if its hash still matches exactly | To explicitly distrust a tool regardless of drift |
| `mcpseal status [projectDir] [--json]` | LOCAL HEALTH (lockfile, proxy install state, recent blocks) and CONTROL PLANE (workspace connection) — **never touches the network** | A quick "is everything okay right now" |
| `mcpseal doctor [projectDir] [--json] [--check-updates]` | Deeper diagnostics with a fix command attached to every failed check; a Control Plane reachability probe that never fails just because the network is down; `--check-updates` optionally checks npm/PyPI for a newer version — **fully opt-in, never automatic** | When something feels wrong and you want the full picture |
| `mcpseal login` | Optional: connects this machine to a hosted workspace via a device-authorization flow, stores credentials in your OS keychain (never a plaintext file) | Only if your org runs the Control Plane |
| `mcpseal logout` | Clears the workspace connection and deletes both stored credentials (workspace key + machine identity) | To disconnect a machine or rotate its identity |
| `mcpseal policy-pull` | Fetches the org's latest signed policy, verifies the signature against the pinned key, and only applies it if it's genuinely newer — every rejection path leaves your lockfile untouched | Manually, or on a schedule, once connected to a workspace |

Every command that can fail tells you **what happened, why, what it means, and the exact next command to run** — nothing surfaces as a bare stack trace or a cryptic error code.

---

## Upcoming features

### Already built, not yet deployed (waiting on Track B infrastructure)
These aren't roadmap promises — the code exists, is tested, and is sitting behind the Control Plane deployment described in `DEPLOYMENT_PLAN.md`:
- The full team dashboard: Live Feed, Fleet view, Policy management, Settings, billing
- Real WorkOS-backed human login (replacing today's local dev-login stand-in)
- Real Stripe billing (Team/Enterprise checkout, already wired end-to-end against mock mode)
- Signed policy push from the dashboard to every connected machine
- Tamper-evident, independently-verifiable audit export
- SSO/SCIM provisioning for Enterprise

### On the real roadmap, not yet built
- **A `--repair` or `--fix` mode for `mcpseal doctor`** — today it deliberately stays read-only and only tells you the command to run; a future version could offer to run it for you with confirmation.
- **Minimum-supported-version enforcement** — the server already receives every client's version on every request; nothing acts on it yet. Useful once there's a real installed base to protect from breaking changes.
- **Broader MCP client support** — config discovery currently targets Claude Code's `.mcp.json` format; extending to other clients' config formats is a natural next step as demand shows up.
- **npm/PyPI Trusted Publishing** — moving off long-lived publish tokens entirely once a public GitHub repo and CI pipeline exist, so future releases ship with zero stored secrets.
- **A fleet-size visibility cap** for pricing tiers — mentioned in the original spec but deliberately never given an invented number; a real product/pricing decision, not an engineering one.

We don't ship a feature flag for something that doesn't exist yet, and we don't claim something's "coming soon" without it already being real code waiting on infrastructure — everything in the first list above is true today, not aspirational.
