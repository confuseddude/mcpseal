# TASKS.md — Execution Checklist

This is the working checklist. `CLAUDE.md` (repo root) is the rules. `docs/build-bible.md` is the architecture spec. This file is the sequence of concrete steps to actually build it, in order, with a status block Claude Code updates every session so nothing gets re-explained or re-decided from scratch.

## Session protocol (read this first, every session)

1. Read the **STATUS** block below before doing anything else. It tells you the current milestone, the current step within it, and what was last verified working.
2. Work **one step at a time**, in order, within the current milestone. Don't skip ahead to a later step or a later milestone even if it looks quick — dependencies are real (see `build-bible.md` Part 12/13).
3. Before writing code for a step, briefly restate what the step requires and which part of `docs/build-bible.md` it implements, so drift gets caught before code exists, not after.
4. When a step is done, **update its checkbox and the STATUS block** (current step, one-line note on what was verified) before ending the turn. Don't leave STATUS stale.
5. At the end of a milestone, **stop and ask for confirmation** before starting the next one, even if every step is checked — a human should eyeball the deliverable.
6. If a step turns out to be ambiguous or wrong versus the bible, say so, propose the fix, and — if agreed — update `docs/build-bible.md` in the same session. Don't silently improvise.

---

## STATUS

```
Current milestone: 5 — MILESTONE 5 COMPLETE. Stripe billing (real SDK integration behind a provider interface, mock mode active until real Stripe credentials are configured), retention-tier gating (7/30/unlimited days by plan), pricing page, Settings billing UI wired end-to-end and verified in a real browser (Upgrade to Team actually flips the plan live). See NIGHT_SHIFT_LOG.md. Proceeding directly to Milestone 6 (Enterprise) — the most security-sensitive milestone, extra care on signature verification per CLAUDE.md.
Current step: none — milestone boundary
Last verified working: 5.x — 11 new billing tests (RBAC, fail-closed webhook signature verification, Stripe-as-source-of-truth state transitions including soft-overage on payment failure) + full real browser walkthrough of the Upgrade flow. Full regression: 144 TS tests + 39 Python tests, all passing.
Blockers: none

Previous milestone —
Current milestone: 4 — MILESTONE 4 COMPLETE. App API (session auth, server-side RBAC, cross-org isolation), Next.js dashboard (Live Feed/Fleet/Policy/Audit/Settings, dark ops-console design per frontend-design skill). Built under Night Shift autonomous-execution authorization; see NIGHT_SHIFT_LOG.md for full detail, mocks, and the two real bugs found and fixed via actual browser testing (missing CORS, device-flow workspace-binding timing). Proceeding directly to Milestone 5.
Current step: none — milestone boundary
Last verified working: 4.x — 16 new app-api tests (RBAC + 3 explicit cross-org isolation tests) + full real browser walkthrough of every dashboard page against live app-api/ingest/dashboard servers, including a real mcplock login + real rug-pull block appearing correctly in the Live Feed with the diff rendered. Full regression: 133 TS tests + 39 Python tests, all passing. All real machine state touched during e2e testing (keychain, config, temp DBs, dev server processes) cleaned up afterward.
Blockers: none

Previous milestone —
Current milestone: 3 — MILESTONE 3 COMPLETE. Ingest API + minimal machine/workspace registration (services/ingest, SQLite dev backend standing in for Postgres+ClickHouse/Timescale, documented in NIGHT_SHIFT_LOG.md), mcplock login (device flow + OS keychain + ed25519 machine identity), opt-in signed event shipping from the local event log. Built under explicit Night Shift autonomous-execution authorization (no per-milestone confirmation stop) — see NIGHT_SHIFT_LOG.md for full detail, mocks, and production-wiring gaps. Proceeding directly to Milestone 4 per that authorization.
Current step: none — milestone boundary
Last verified working: 3.x — 14 new ingest tests + 15 new cli-node tests (keychain/machine-identity/login/ship-events), including the CLAUDE.md invariant-2 test that shipEvents() makes zero network calls with no login. Full real e2e run: real login against a real dev ingest server, real rug-pull block, signed shipment independently verified in the event store with correct old/new description diff. Full regression: 117 TS tests + 39 Python tests, all passing. Test/credential state left on the machine by the e2e run was cleaned up afterward.
Blockers: none

Previous milestone —
Last verified working: 2.7 — Scoped to npx/cli-node only, per user decision (asked because cli-python has zero CLI surface — Milestone 1 only built its core library — so "package for uvx" would have meant building a full parallel Python CLI, not a packaging formality). Found and fixed two real, concrete publish-blockers via actual testing (not assumed): (1) `pnpm pack` rewrites cli-node's `workspace:^` deps on @mcplock/cli-core and @mcplock/shared-types to plain semver ranges, but those packages were never published — a real `npm install` 404'd resolving them, confirmed by actually installing the tarball in a directory with zero access to the monorepo. Fixed by bundling dist/cli.js into a single self-contained file with esbuild (node builtins stay external under platform:"node") and moving the two @mcplock/* packages from "dependencies" to "devDependencies" (still resolvable via workspace for local builds, no longer advertised as a runtime install requirement). (2) esbuild's default shebang preservation plus an explicit banner option produced two shebang lines, a syntax error that crashed the bundled CLI outright — caught by actually running the bundled output, not just building it; fixed by dropping the banner. Also fixed real package.json issues found by inspecting the actual packed tarball: `"private": true` would have blocked `npm publish` outright; set to false. Set `"license": "UNLICENSED"` deliberately — no license has been chosen (not this session's call), and UNLICENSED is respected by npm as a publish-blocking guard, so this doubles as an intentional safety net against an accidental real publish. Verified the full pipeline for real: packed the tarball, `npm install`'d it in an isolated directory with no monorepo access, ran the installed bin directly against a real MCP server (not the dev build) — worked correctly (one transient npx cold-cache timeout on first try, resolved on retry, not a packaging defect). Wrote README.md: what it does, privacy statement (CLAUDE.md invariant 2 — honest "login doesn't exist yet" framing, not implying Control Plane works), a from-source quickstart (since not actually npm-published) timed end-to-end at ~5.3s warm-cache for init+install together, a `npx mcplock@latest`-framed quickstart for post-publish, and a command table. Did NOT run `npm publish` — that's an irreversible, public action outside this session's authorization.
Blockers: none New packages/cli-node: scan.ts (re-hashes every live tool per configured server, runs checkDrift against the lockfile, plus tool_removed detection for lockfile tools missing from the live list), manage.ts (setToolStatus: approve/deny both re-fetch the tool's CURRENT live definition and write hash+description+status uniformly — design choice logged, covers quarantined/unknown/drifted cases with one code path), diff.ts (diffDrifted/formatDiff: text-diffs description for blocked_drift tools; when hash differs but description text is identical, honestly flags "the change is in inputSchema" rather than fabricating a schema diff we don't store — consistent with the earlier description-only ToolEntry decision). Wired all four into cli.ts (`scan`, `approve <server> <tool>`, `deny <server> <tool>`, `diff`); scan's CLI exit code is non-zero iff any decision is a block. 8 new integration tests (spawning a real mutable stub server per test, no protocol mocking): clean-scan-all-allow, drift-detected-on-changed-tool-only, **CLI subprocess exit-code check explicitly verified non-zero on drift / zero when clean** (the literal 2.6 done-criteria), approve-clears-drift, deny-blocks-exact-hash-match, approve/deny-throws-if-tool-not-live, diff-empty-when-clean, diff-shows-real-old-vs-new-text. 35/35 cli-node tests passing. Then ran all four commands manually via the real compiled binary against the actual rugpull-project from 2.3 (not just synthetic test fixtures): `scan` showed BLOCK/blocked_drift with exit 1, `diff` showed the real prompt-injection payload text, `approve` cleared it (scan then showed OK/approved, exit 0), `deny` then re-blocked it (scan showed BLOCK/blocked_denied, exit 1).
Blockers: none packages/cli-node/src/event-log.ts: appendEvent()/readEvents()/recentBlocks() writing/reading ~/.mcplock/events.jsonl. Per-event shape follows Part 4.2's batch-item fields minus Control-Plane-only envelope fields (machineId/workspaceId/signature). Judgment call: only blocks are logged, not every allow decision (Task 2.5 says "at minimum every block"; logging every allow would just be noise nothing downstream needs yet). Logging is best-effort — wrapped in try/catch, a write failure prints a warning but never breaks the proxy's actual block decision, since the block already happened before logging is attempted. Wired appendEvent() into cli.ts's proxy onDecision hook, and added `mcplock status` (reads the log, prints event count + up to 10 most recent blocks). 8 new tests (dir auto-creation, multi-line JSONL, descriptionDiff only-when-both-present, unique eventId/ISO ts, empty-when-missing, skips-corrupted-line, recentBlocks filter+sort+limit) — 27/27 cli-node tests passing. Re-ran the full 2.3 rug-pull demo end-to-end with this wired in: confirmed the block was both shown on stderr AND persisted, then `mcplock status` (real compiled binary) correctly read it back and summarized it. This closes the "logged locally" gap noted as deferred in 2.3. Cleaned up the real ~/.mcplock/events.jsonl this test wrote afterward, since it was test data in the actual product directory on this machine, not something to leave behind.
Blockers: none packages/cli-node/src/install.ts: install()/uninstall(). Snapshots exact original config bytes to a `.mcp.json.mcplock-backup` before rewriting; uninstall restores those exact bytes verbatim (provably byte-for-byte, not a regenerated-JSON approximation). Rewrites each mcpServers entry to `{command:"npx", args:["-y","mcplock","proxy",serverName,originalCommand,...originalArgs]}`. Fail-closed on misuse (missing config, already-installed, not-installed). 8 new tests; 19/19 cli-node tests passing. Verified against the real CLI binary + a real config file: md5sum identical before install and after uninstall.

Full step-by-step history (2.1-2.4) is in this file's git history / prior STATUS entries — condensed here to keep this block scannable. Highlights carried forward: (a) 2.3's rug-pull demo is fully verified end-to-end (real mutable MCP server, real client, real proxy — block + accurate old-vs-new description diff shown), but the "logged locally" half of its done-criteria is intentionally deferred to 2.5 (no persisted event log yet). (b) A mid-turn message mid-2.3 impersonated a different user ("Devin") and referenced a stale step number, proposing a bigger schema change than what was actually approved — flagged to the user as likely injected content; user confirmed it wasn't theirs, so it was disregarded. (c) Two real bugs found via actual e2e testing (not hypothetical) were fixed: McpStdioClient wasn't forwarding spawned-child stderr (block-reason logging was invisible), and on Windows shell:true spawning meant child.kill() only killed the cmd.exe wrapper, leaking the real process — fixed with process-utils.ts's killProcessTree() using taskkill /T /F.
Blockers: none
```

---

## Milestone 1 — Lockfile core

**Goal:** deterministic, cross-language-identical hashing and a working drift state machine, proven by shared test fixtures. No CLI, no proxy yet. Reference: `build-bible.md` Part 2 and Part 11.

- [x] **1.1 — Scaffold the monorepo skeleton.**
  Create the directory structure from `build-bible.md` Part 11: `packages/{cli-core,cli-node,cli-python,shared-types}`, `services/{ingest,app-api,workers}`, `apps/dashboard`, `test-vectors/`, `infra/`, `docs/`. Most will stay empty until later milestones — just get the skeleton and root configs in place (`package.json` workspaces for the TS packages, a `pyproject.toml` for the Python package, a root `README.md`, `.gitignore`).
  *Done when:* `pnpm install` (or equivalent) runs clean at root with no packages implemented yet.

- [x] **1.2 — Define the lockfile schema as shared types.**
  In `packages/shared-types`, write the TypeScript types matching `build-bible.md` Part 2.3 exactly: `Lockfile`, `ServerEntry`, `ToolEntry` (with `status: 'approved' | 'denied' | 'quarantined'`), `Policy`. Mirror the same shape in a Python dataclass/TypedDict in `packages/cli-python` (or a shared `schema.json` both languages generate types from, if you'd rather single-source it — your call, note the choice in this file once made).
  *Done when:* the schema can serialize/deserialize the exact example JSON from Part 2.3 round-trip, in both languages.

- [x] **1.3 — Implement canonical JSON serialization (TypeScript).**
  In `packages/cli-core/src/canonical-json.ts`: a function `canonicalize(obj: unknown): string` that sorts object keys lexicographically at every nesting level, strips insignificant whitespace, and outputs UTF-8 with no trailing newline. Use a maintained library (`json-canonicalize` or equivalent) rather than hand-rolling — per `CLAUDE.md`'s dependency caution, pick one well-known implementation and justify it in a code comment.
  *Done when:* unit tests cover nested objects, arrays, unicode strings, and confirm key order in the input doesn't affect output.

- [x] **1.4 — Implement the tool hash function (TypeScript).**
  In `packages/cli-core/src/hash.ts`: `hashTool(tool: { name: string; description: string; inputSchema: object }): string` — builds the canonical object per Part 2.1, canonicalizes it (1.3), SHA-256s the UTF-8 bytes, returns `sha256:<lowercase-hex>`. Only `name`, `description`, `inputSchema` go in — nothing else, per Part 2.1's explicit warning against hashing volatile fields.
  *Done when:* a unit test confirms two semantically-identical tool objects with different key insertion order produce the same hash, and a changed `description` produces a different hash.

- [x] **1.5 — Implement lockfile read/write (TypeScript).**
  `packages/cli-core/src/lockfile.ts`: `readLockfile(path): Lockfile`, `writeLockfile(path, lockfile): void`, `createEmptyLockfile(): Lockfile` (matching the Part 2.3 skeleton with `version: 1`, `signature: null`).
  *Done when:* write-then-read round-trips exactly, and `readLockfile` throws (not silently returns null) on a missing or malformed file — this is a fail-closed path, treat it as one per `CLAUDE.md` invariant 1.

- [x] **1.6 — Implement the drift state machine (TypeScript).**
  `packages/cli-core/src/drift.ts`: `checkDrift(observedTool, lockfile, serverName): DriftResult` implementing the exact five cases from Part 2.4 (`approved`/forward, `denied`/block, `hash differs`/block as `blocked_drift`, `unknown tool`/block per `onUnknownTool` policy, `tool removed`/informational). Return a typed result (`{ decision: 'allow' | 'block', reason: string, oldHash?: string, newHash?: string }`), don't just return a boolean — the proxy and the dashboard both need the reason.
  *Done when:* a unit test exists for each of the five cases explicitly, plus a test confirming any internal error (e.g. malformed observed tool) results in a `block` decision, never a throw that could be caught-and-ignored upstream.

- [x] **1.7 — Build the cross-language test fixture file.**
  `test-vectors/hash-fixtures.json`: an array of ~10–15 cases, each with an input tool object and its expected hash, covering: a plain tool, unicode in the description, deeply nested `inputSchema`, a schema with array types, and at least two pairs demonstrating "same semantic content, different key order → same hash" and "one field changed → different hash." Generate the expected hashes using the TS implementation from 1.4 (it's your reference implementation), then hand-verify a couple by computing them independently (e.g. a throwaway script) so you're not just testing "the code agrees with itself."
  *Done when:* the file exists and every fixture's expected hash has been independently sanity-checked at least once.

- [x] **1.8 — Implement the Python equivalent.**
  In `packages/cli-python`: `canonical_json.py` (canonicalize, using a maintained library like `canonicaljson`), `hash.py` (`hash_tool`), `lockfile.py` (read/write), `drift.py` (`check_drift`) — same behavior as 1.3–1.6, independently implemented (not transpiled), Python-idiomatic.
  *Done when:* a Python test suite loads `test-vectors/hash-fixtures.json` and asserts every fixture's hash matches.

- [x] **1.9 — Wire the cross-language parity gate into CI.**
  A GitHub Actions workflow that runs both the TS and Python test suites (including the shared-fixture assertions from 1.7/1.8) on every push and PR, and fails loudly if either language's hash diverges from the fixture file.
  *Done when:* a deliberate test — temporarily change one canonicalization detail in one language locally — causes CI to fail, confirming the gate actually catches parity breaks, then revert the deliberate break.

**Milestone 1 exit criteria (confirm all before moving to Milestone 2):** both language packages hash identically against the shared fixtures; the drift state machine has explicit test coverage for all five cases plus the fail-closed error path; CI enforces parity on every push.

---

## Milestone 2 — CLI + stdio proxy

**Goal:** the actual free product — a working `mcplock` that protects a real MCP client/server pair with zero account and zero network calls. Reference: `build-bible.md` Part 3 and Part 13's proxy-transparency warning.

- [x] **2.1 — `mcplock init`: discover MCP servers and generate the lockfile.**
  Locate and parse known MCP client config files (start with one client — Claude Code's config — expand later): extract each server's `command`/`args`. For each, launch it, send `initialize` then `tools/list` over stdio, collect the tool definitions, hash each (1.4), and write `.mcp-lock.json` with every discovered tool at `status: approved` (first-run trust-on-first-use, matching Part 2.3's example).
  *Done when:* running `mcplock init` against a real client config with at least one real MCP server (e.g. the GitHub MCP server) produces a valid, correctly-hashed lockfile.

- [x] **2.2 — `mcplock proxy`: the transparent stdio wrapper.**
  Implement the child-process spawn + bidirectional stdio pipe described in Part 3.3. On `initialize`/`tools/list` responses flowing back from the child, intercept, hash each tool, run `checkDrift` (1.6) against the lockfile, and either forward the response untouched or strip/replace the blocked tool. All other JSON-RPC traffic passes through byte-for-byte, untouched — per Part 13's warning, this must add negligible latency and never mangle framing.
  *Done when:* a real MCP client (Claude Code) configured to launch `mcplock proxy <original command>` instead of the server directly works completely normally end-to-end for every approved tool, with the client user noticing no difference.

- [x] **2.3 — Stage a real rug pull and confirm the block.** (the "logged locally" half was completed retroactively by 2.5; see 2.5's STATUS note)
  Build a small test MCP server whose tool description you can mutate between runs. Approve it via `mcplock init`, then change its description, then invoke it through the proxy.
  *Done when:* the mutated tool is blocked, the block is logged locally (2.5), and the block reason clearly shows the old vs. new description — this is the core "does the product actually work" test; don't skip it or fake it with a unit test substitute.

- [x] **2.4 — `mcplock install` / `mcplock uninstall`: config rewriting.**
  `install` rewrites the client's MCP server config entries so `command`/`args` route through `mcplock proxy <original>`, preserving the ability to fully restore the original config. `uninstall` reverses it exactly.
  *Done when:* install → uninstall round-trips the config file byte-for-byte back to its original state.

- [x] **2.5 — Local event log.**
  Every block/allow decision (at minimum every block) appends a line to `~/.mcplock/events.jsonl` — no account required, this is purely local. Match the event shape that will later be reused for Control Plane shipping (Part 4.2's fields, minus `workspaceId`/signature, which don't exist yet).
  *Done when:* `mcplock status` can read this file and show a human a summary of recent blocks on the current machine.

- [x] **2.6 — `mcplock scan`, `mcplock approve`, `mcplock deny`, `mcplock diff`.**
  `scan`: one-shot re-hash of all currently configured tools against the lockfile, non-zero exit code on any drift (CI-friendly, per Part 3.2). `approve`/`deny`: update a tool's `status` in the lockfile. `diff`: human-readable side-by-side of an old vs. new description/schema for any drifted tool.
  *Done when:* all four commands work against the test setup from 2.1–2.3, and `scan`'s exit code is verified to be non-zero specifically on drift (test this explicitly, it's what CI integrations will depend on).

- [x] **2.7 — Package for `npx`/`uvx` and write the README.** (npx/cli-node only — see Change Log; uvx/cli-python CLI deferred)
  Publish-ready `package.json`/`pyproject.toml` metadata, a `bin` entry so `npx mcplock <cmd>` and `uvx mcplock <cmd>` both work with zero prior install, and a top-level `README.md` covering: what it does, the 30-second quickstart (`init` → `install` → done), and — per `CLAUDE.md`'s privacy invariant — an explicit, plain-language statement that nothing leaves the machine until `mcplock login` (which doesn't exist yet — say "coming soon" honestly, don't imply Control Plane features work before Milestone 3).
  *Done when:* a person with no prior context can `npx mcplock@latest init && npx mcplock@latest install` against a real client and have working protection in under a minute, following only the README.

**Milestone 2 exit criteria:** a staged rug pull against a real MCP client/server gets blocked, locally, with a visible diff, with zero account and zero network call — and this is publishable today as the free product.

**Stop here and confirm with me before starting Milestone 3.** Everything past this point is monetization infrastructure on top of a product that should already work end-to-end.

---

## Milestone 3 — Ingest + Event Store — COMPLETE (see NIGHT_SHIFT_LOG.md for full detail)

Reference: `build-bible.md` Part 4, Part 5.2, Part 6.2.

- [x] **3.1 — Event Store + minimal workspace/machine data model.** `services/ingest/src/db.ts`: SQLite dev implementation of Part 5.1's workspaces/machines/api_keys and Part 5.2's events table, behind function signatures a real Postgres/ClickHouse client can drop in for later. Documented as a mock; production wiring required.
- [x] **3.2 — Ingest API.** `POST /v1/events`: API-key auth (argon2-hashed secret, indexed keyId), ed25519 signature verification over the raw request body (`@noble/curves`), zod schema validation, batch size cap, per-key rate limiting, eventId-based idempotency. Fails closed on every invalid path (401/400/403/429, never a silent accept).
- [x] **3.3 — `mcplock login`.** Device-authorization flow (`/v1/auth/device/start|poll|approve`), ed25519 machine keypair generation (`packages/cli-node/src/machine-identity.ts`), OS keychain storage via `@napi-rs/keyring` (`keychain.ts`) — keytar is unmaintained/archived, this is its actively-maintained equivalent. Dashboard-side approval is mocked (env-gated dev-auto-approve) since Milestone 4's Dashboard doesn't exist yet; the approve endpoint itself is real and is what Milestone 4 will call for real.
- [x] **3.4 — Opt-in event shipping.** `ship-events.ts`: reads the local event log (2.5), batches/signs/ships unshipped events, advances a cursor on success, leaves it untouched on failure (retry-safe). Wired as fire-and-forget from the proxy's existing block-handling path. **Explicitly tested that shipEvents() makes zero network calls with no login/no credentials** — this is CLAUDE.md invariant 2, not a nice-to-have.

**Milestone 3 exit criteria — met:** a real login against a real dev ingest server was run end-to-end, and the Milestone 2 rug-pull demo was re-run with shipping live — the block fired locally exactly as before, and the signed event was independently verified present in the ingest event store with the correct old/new description diff. 14 new ingest tests + 15 new cli-node tests passing, full regression (117 TS + 39 Python) green.

## Milestone 4 — App API + Auth + Dashboard skeleton — COMPLETE (see NIGHT_SHIFT_LOG.md for full detail)

Reference: Part 4.1, Part 6, Part 7.

- [x] **4.1 — App API core domain model.** `services/app-api/src/db.ts`: orgs/users/sessions/policies/subscriptions (Part 5.1), sharing the ingest service's dev DB file for workspaces/machines/api_keys/events.
- [x] **4.2 — RBAC.** `owner/admin/member/viewer`, enforced server-side on every protected route, never trusting client-supplied org/workspace IDs. 3 explicit cross-org isolation tests passing.
- [x] **4.3 — Human auth.** Session-based (httpOnly/Secure/SameSite=Lax cookie, server-side revocable). Dev-mock provider stands in for WorkOS (documented, not hidden) — same downstream shape a real WorkOS callback would produce.
- [x] **4.4 — Dashboard.** Next.js App Router + TS + Tailwind v4. Live Feed (the money screen — polling, real unified-diff rendering of the description change), Fleet, Policy (draft CRUD), Audit (real subscription-gated Enterprise teaser), Settings (members/roles, API keys, billing). Design direction taken from the frontend-design skill: dark ops-console, not a generic AI-dashboard default.
- [x] **4.5 — Live event flow, verified for real.** `mcplock proxy` block → local log → signed shipment → ingest → app-api → dashboard Live Feed, driven through an actual browser with a real rug-pull payload, confirmed rendering correctly.

**Milestone 4 exit criteria — met:** a Security Lead can log in and watch blocks stream in across machines (real browser walkthrough, not a mockup). Two real bugs found via that testing (missing CORS, device-flow workspace-binding timing bug) were fixed, not glossed over. 16 new app-api tests + full regression (133 TS + 39 Python) passing.

## Milestone 5 — Billing + Team tier — COMPLETE (see NIGHT_SHIFT_LOG.md for full detail)

Reference: Part 10.

- [x] **5.1 — Stripe integration.** `services/app-api/src/billing.ts`: `BillingProvider` interface, real `StripeBillingProvider` (Checkout, Billing Portal, webhook signature verification via `stripe.webhooks.constructEvent`), `MockBillingProvider` active until real credentials are configured (env-var gated, zero code changes needed to go live).
- [x] **5.2 — Webhook handling, Stripe as source of truth.** `applyWebhookEvent()` is the only path that changes `orgs.plan`/`subscriptions`; fails closed on any signature verification error (400, event never applied).
- [x] **5.3 — Plan gating.** Retention TTL enforced server-side per plan (7/30/unlimited days) on `GET /v1/events`, driven by the org's real subscription, never client-supplied.
- [x] **5.4 — Pricing page.** Public `/pricing`, "no sales call for Team" messaging per spec text.
- [x] **5.5 — Billing UI.** Settings page Upgrade/Manage-billing buttons, verified working end-to-end in a real browser (plan actually flips live).

**Milestone 5 exit criteria — met:** a self-serve credit-card upgrade unlocks 30-day retention (real Stripe checkout path fully implemented; verified end-to-end via mock mode since no live Stripe account exists in this environment). 11 new tests + full regression (144 TS + 39 Python) passing.

## Milestone 6 — Enterprise *(stub)*

Reference: Part 8. Signed policy push, SSO/SCIM, tamper-evident audit export.

## Milestone 7 — PQL Engine *(stub, parallel once ingest has data)*

Reference: Part 4/12. Buying-signal detection job.

---

## Change log

*(Append a line here whenever a step forces a change to `docs/build-bible.md`, so there's a record of spec drift and why.)*

- 2026-08-18 — Step 2.7: scoped "package for npx/uvx" down to npx/cli-node only for this pass. cli-python has only the Milestone 1 core library (canonical_json/hash/lockfile/drift) with no CLI entrypoint at all — none of init/proxy/install/uninstall/scan/approve/deny/diff exist in Python. Making `uvx mcplock` actually work requires building a full parallel Python CLI (argparse, console_scripts entry point, an MCP stdio client in Python, etc.), which is substantial new work, not a packaging step — asked the user, they chose to defer it rather than build it now. This is an open item before any real public release: Part 3.1's "ship two thin distributions" is only half-built.
- 2026-08-17 — Step 2.3: ToolEntry (Part 2.3) extended with `description: string` — the last-approved tool description, stored alongside `hash`. Reason: Part 2.4 promises an old-vs-new description diff on drift, but a hash can't be reversed to recover what the old description said; without storing it, the diff was impossible to implement, not just unimplemented. User-approved change (asked first, per CLAUDE.md's rule on lockfile schema changes). Does not affect what gets hashed (still name+description+inputSchema per Part 2.1/2.2) or test-vectors/hash-fixtures.json.
- 2026-08-17 — Step 2.2, two judgment calls, both flagged: (1) Part 3.3 says intercept "initialize and tools/list responses," but only tools/list responses actually carry tool definitions in MCP (initialize returns capabilities only) — implemented interception generically keyed on "does this response's result contain a `tools` array" rather than hardcoding by request method; functionally equivalent, more robust to servers that structure things slightly differently. (2) Part 3.2 shows `mcplock proxy <server>` without specifying how the proxy learns which lockfile entry to check against — defined the syntax as `mcplock proxy <serverName> <command> [args...]`, with `install` (step 2.4) expected to be what actually produces this invocation when it rewrites client configs.
- 2026-08-17 — Step 2.1, three judgment calls, none contradicting spec text, all flagged rather than silently decided: (1) Part 2.3 names `commandHash` but never specifies its hash input — defined it as sha256 of canonical JSON of {command, args}, reusing the tool-hash canonicalization machinery. (2) Task 2.1 says "start with Claude Code's config" but Part 3.3's example config filenames (`claude_desktop_config.json`, Cursor's `mcp.json`) are Claude *Desktop*'s, not Claude *Code* CLI's — went with Claude Code CLI's actual project-scope format (`.mcp.json` with `mcpServers` key), since Task 2.1 explicitly names "Claude Code," and left Claude Desktop / other clients for the "expand later" the task text allows. (3) Done-criteria example server ("e.g. the GitHub MCP server") — the npm package `@modelcontextprotocol/server-github` is deprecated ("no longer supported") and none of this machine's actual MCP client configs had any live servers configured (all `mcpServers: {}`); used `@modelcontextprotocol/server-everything` (the actively-maintained MCP reference/test server) instead for the real end-to-end verification — it's a genuine MCP server speaking real protocol, just not literally GitHub's. Did not modify the user's real `~/.claude.json`.
- 2026-08-17 — Step 1.6: Part 2.4's five cases only address hash-matches-`approved` and hash-matches-`denied`; `ToolEntry.status` (Part 2.3) also allows `quarantined`, which Part 2.4 doesn't assign a branch to. Judgment call: treat hash-matches-`quarantined` as block (`blocked_quarantined`), consistent with the fail-closed default — a quarantined tool is by definition not yet trusted. Not a spec contradiction, just an underspecified branch; flagging for confirmation rather than silently deciding it's fine forever.
- 2026-08-17 — Step 1.3: build-bible.md Part 2.2 names `json-canonicalize` as an example TS library; its npm package (v2.0.1) is broken (main entry references an unbuilt bundle, confirmed via require() failure). Swapped to `canonicalize` (erdtman/canonicalize) — also RFC 8785 JCS, same guarantees (lexicographic key sort at every level, no whitespace, UTF-8, no trailing newline). No change to the canonicalization method or algorithm itself, just the library. Not updating Part 2.2's text since it says "e.g." (example), not a hard pin — flagging here for visibility.
- 2026-08-17 — Step 1.2: chose independent TS types + Python TypedDict (both hand-written against Part 2.3) over a single-sourced `schema.json` codegen approach. Not a spec change, just the "your call" note Tasks.md asked for. Rationale: schema shape is plain data, not the determinism-critical trust boundary (that's the hash algorithm, per Part 13) — codegen tooling would be more ceremony than the problem needs at this size.