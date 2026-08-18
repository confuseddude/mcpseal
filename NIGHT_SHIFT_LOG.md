# Night Shift Log

## Overview

- Start time: 2026-08-18 (session start), repo had no git history — initialized git and committed Milestone 1-2 baseline before Night Shift work began.
- Objective: implement Milestones 3-6 per docs/build-bible.md, autonomously, per explicit Night Shift authorization from the user (see conversation). CLAUDE.md invariants remain absolute and were not overridden.
- Final status: IN PROGRESS

---

# Milestone 3 — Ingest + Event Store

## Built
- `services/ingest` (new Fastify/TS service, Node per Part 4.1's "acceptable at the start" allowance): `POST /v1/events` (batched, signed, API-key-authenticated ingest), `POST /v1/auth/device/start|poll|approve` (device-authorization flow, Part 6.2), `POST /v1/machines/register` (ed25519 public-key registration, Part 4.3).
- `services/ingest/src/db.ts`: local SQLite-backed dev implementation of the Postgres slice (workspaces/machines/api_keys) and the Event Store (events table matching Part 5.2's schema) needed for Milestone 3, behind the same function names production Postgres/ClickHouse clients would need.
- `services/ingest/src/crypto.ts`: ed25519 signature verification (`@noble/curves`), argon2 API-key-secret hashing (`argon2`), API-key token format `<keyId>.<secret>` — keyId indexed, secret hashed, matching Part 5.1's "hashes of secrets, never the secrets."
- CLI side (`packages/cli-node`): `keychain.ts` (OS keychain wrapper, `@napi-rs/keyring` — keytar's actively-maintained successor, keytar itself is archived/unmaintained), `machine-identity.ts` (ed25519 keypair gen/load), `config.ts` (non-secret local state: workspaceId/machineId/ingestUrl/shipping cursor), `login.ts` (`mcplock login` device-flow client), `ship-events.ts` (opt-in batching/signing/shipping from the local event log). Wired `login` and updated `status` into `cli.ts`; wired best-effort fire-and-forget shipping into the proxy's existing block-handling path.

## Verified
- 14 new ingest tests (real Fastify instance via `.inject`, in-memory SQLite): full device-flow → machine-registration → signed-event happy path; rejects missing/invalid API key; rejects unregistered machine; **rejects a forged signature from a different keypair** (fail-closed); **rejects a tampered body whose signature no longer matches**; rejects malformed JSON (400, not the default 415/500); rejects a batch item missing required fields; rejects an oversized batch; rejects workspaceId/authenticated-workspace mismatch; rate-limits an API key past the configured threshold; idempotent retry of an identical batch (duplicate counted, not double-inserted); device code can only be consumed for an API key once.
- 15 new cli-node tests: keychain round-trip against the real OS keychain (Windows Credential Manager on this machine); machine-identity keypair creation/reuse/signature verification/tamper-detection; full `login()` flow against a mocked ingest server (pending→approved polling, denied, expired, HTTP-failure paths); **`shipEvents()` makes literally zero network calls when there is no config file, and zero when config exists but the keychain has no credentials** (fetchImpl that throws if called at all — this is the CLAUDE.md invariant 2 test, not just a plausibility check); ships and signs correctly; does not re-ship already-shipped events (cursor); leaves the cursor untouched on network failure so a retry re-sends the same batch.
- Full real end-to-end run (not just unit tests): started the dev ingest server for real, ran the actual compiled `mcplock login` against it (dev-auto-approve device flow) — real keychain writes, real config file, real HTTP round trip. Then re-ran the exact Milestone 2 rug-pull demo (real mutable stub MCP server, real proxy) with shipping now live: the block fired locally exactly as before, and the signed event was independently verified to have landed in the ingest SQLite event store with the correct type/severity/old-vs-new description diff. All real credentials/temp files/processes from this run were cleaned up afterward (keychain entries deleted, `~/.mcplock/config.json` and `events.jsonl` removed, dev server process killed, temp sqlite files removed) since it touched the actual machine's product state, not an isolated test fixture.
- Full regression: 117 TS tests (shared-types 1, cli-core 49, cli-node 53, ingest 14) + 39 Python tests, all passing after Milestone 3 changes.

## Executive Decisions
- No git repository existed at session start despite the Milestone 2 summary describing tested/packaged work. Verified the working tree actually matched that summary (Tasks.md + all described files present, all prior tests passing) before proceeding, then `git init` + committed the Milestone 1–2 baseline so "commit after each milestone" is meaningful going forward.
- Built the device-flow "approve" step's real production endpoint (`POST /v1/auth/device/approve`, meant to be called by an authenticated Dashboard session) now, even though the Dashboard doesn't exist until Milestone 4 — rather than stubbing the whole device flow, only the *caller* of approve is mocked (an env-gated dev-auto-approve), so Milestone 4 only needs to wire a real caller, not rebuild the endpoint.
- Milestone 3's build order names `mcplock login (device flow + keychain + ed25519 registration)` before the App API (Milestone 4) exists, but workspace/machine registration is conceptually App API domain (Part 5.1). Resolved by putting a minimal slice of that domain model (workspaces/machines/api_keys tables) inside `services/ingest` for now, clearly commented as scoped-down and expected to move under the real App API in Milestone 4 without changing the CLI-facing contract.
- API key format chosen as `<keyId>.<secret>` (not a single opaque token) so the server can look up the argon2 hash by an indexed public keyId instead of scanning/re-hashing every stored key against every incoming token.
- Batch signature is computed over the exact raw request bytes (captured via a custom Fastify content-type parser), not a re-serialized JSON reconstruction — avoids a whole class of "signature valid on the wire, invalid after re-parsing" bugs from key-order/whitespace differences.

## Spec Deviations
- None to `docs/build-bible.md` — Milestone 3 as implemented matches Part 4/5/6.2 as written. The one scoping note (workspaces/machines living in `services/ingest` rather than a not-yet-existing App API) is an implementation-order accommodation, not a spec change; the data model itself is unchanged from Part 5.1.

## Mocks / Stubs
- **Postgres**: not deployed. `services/ingest/src/db.ts` implements the `workspaces`/`machines`/`api_keys` slice of Part 5.1's schema against local SQLite, behind the same function signatures a real `pg`/Prisma/Drizzle client would need. PRODUCTION WIRING REQUIRED: replace `openDb`/the query functions in `db.ts` with real Postgres access; no caller changes needed.
- **ClickHouse/Timescale**: not deployed. The `events` table in the same SQLite file matches Part 5.2's column set exactly (including `severity`, `ingested_at`) but has no partitioning/TTL/retention-tier behavior. PRODUCTION WIRING REQUIRED: stand up ClickHouse or Timescale with the Part 5.2 DDL (partition/order/TTL as specified) and swap `insertEventIfNew`/`listEventsForWorkspace`.
- **Dashboard-driven device approval**: the human-clicks-approve half of the device flow doesn't exist (no Dashboard until Milestone 4). `POST /v1/auth/device/approve` is fully real and unauthenticated-by-necessity right now; a dev-only env var (`MCPLOCK_DEV_AUTO_APPROVE_DEVICE=1`) calls it automatically in place of a human. PRODUCTION WIRING REQUIRED: Milestone 4's Dashboard must call this same endpoint from an authenticated admin session, and the endpoint itself will need session-based auth added at that point (currently open, since nothing authenticated exists yet to gate it on — flagging this explicitly as a gap, not hiding it).
- **Rate limiting**: in-memory per-process fixed-window counter (120 req/min/key). Fine for a single dev instance; PRODUCTION WIRING REQUIRED: a shared store (Redis or the DB) once the Ingest API runs as more than one process.

## Production Wiring Required
- Real Postgres deployment + connection string.
- Real ClickHouse or Timescale deployment with Part 5.2's partitioning/TTL DDL.
- Dashboard-authenticated caller for `/v1/auth/device/approve` (Milestone 4 dependency) and session-based auth added to that endpoint.
- Shared (non-in-process) rate limiting once Ingest runs multi-instance.
- `services/ingest` is currently Node/TS per Part 4.1's explicit "acceptable at the start" clause; a Go/Rust rewrite is future work once ingest volume justifies it, and the endpoint/payload shape was kept deliberately simple to make that rewrite tractable later.

---

# Milestone 4 — App API + Auth + Dashboard skeleton

## Built
- `services/app-api` (Fastify/TS): session-based human auth (`POST /v1/auth/dev-login|logout`, `GET /v1/auth/me`), full RBAC (`owner > admin > member > viewer`) enforced server-side on every protected route, org/user/workspace/machine/event/policy/API-key/subscription reads and writes — all scoped to the session's own org, never a client-supplied org/workspace ID.
- `services/app-api/src/db.ts`: local SQLite dev implementation of Part 5.1's orgs/users/sessions/policies/subscriptions, sharing the SAME physical dev-DB file `services/ingest` uses for workspaces/machines/api_keys/events — mirrors "both services connect to the same Postgres instance" in production without needing RPC between them locally.
- `apps/dashboard` (Next.js App Router + TypeScript + Tailwind v4): Live Feed (polling, the description-diff rendered as a real unified red/green diff — the page's signature element, since that diff is literally the product's detection mechanism made visible), Fleet, Policy (draft create/list), Audit (real subscription-gated, "locked door with a window in it" per Part 7.3 — not faked data, an honest placeholder for the actual M6 export), Settings (members/roles, API keys, billing). Dev-mock login page standing in for WorkOS.
- Design direction (frontend-design skill, invoked before UI work per CLAUDE.md): dark ops-console palette (deep slate-navy, not the generic near-black+neon-accent AI default), monospace for all data/hashes/diffs since this is a security tool where the raw diff IS the value prop.

## Verified
- 16 new app-api tests: dev-login creates/reuses orgs by email domain with correct owner-vs-member assignment; session cookie auth; logout revokes the session (confirmed unusable afterward); a forged/random session cookie is rejected; RBAC denies member/viewer actions requiring admin+ (role changes, API key management, policy creation) and allows them for owner/admin; **three explicit cross-org isolation tests** — org A's `/v1/members` never includes org B's user even though nothing about the request differentiates them beyond the session, an admin in org A gets 404 (not 403 — never leaking cross-org existence) trying to modify a user in org B, and org A sees zero of org B's workspaces/machines/events; policy versioning starts at 1 and increments correctly; malformed policy JSON rejected.
- Full real end-to-end browser test (not just unit tests, not just curl): started app-api + ingest + the built-and-served dashboard for real, drove the actual browser through login → Live Feed → Fleet → Policy → Audit → Settings using claude-in-chrome. Ran a real `mcplock login` + real rug-pull block from a real proxied MCP session and confirmed it appeared in the Live Feed with the correct severity chip and the actual injected-payload text rendered in the red/green diff view. All real state this touched (keychain entries, `~/.mcplock/config.json`/`events.jsonl`, temp SQLite files, all spawned dev-server processes) was cleaned up afterward.
- Two real bugs found via that browser testing (not hypothetical, not caught by unit tests) and fixed: (1) the App API had no CORS handling at all — cross-origin dashboard→API requests failed outright (OPTIONS 404, POST 503) — fixed by registering `@fastify/cors` with an explicit origin allowlist + credentials, not a wildcard; (2) the device-authorization flow bound `workspaceId` at *start* time using a hardcoded ingest-owned dev workspace, but per Part 6.2 the workspace should come from whichever authenticated Dashboard session *approves* the code — the CLI is still anonymous at start. Fixed by making `workspace_id` nullable until approval and moving the binding into `approveDeviceCode`, with `startDeviceFlow` no longer taking a workspaceId at all. This is a real architectural correction, not a demo workaround — regression tests updated in `services/ingest/src/app.test.ts` and still passing (14/14).
- Full regression: 133 TS tests (shared-types 1, cli-core 49, cli-node 53, ingest 14, app-api 16) + 39 Python tests, all passing.

## Executive Decisions
- `services/app-api` and `services/ingest` share one physical SQLite file in local dev (each declares its own tables with `CREATE TABLE IF NOT EXISTS`, no cross-package import) rather than one service proxying the other. This mirrors "both connect to the same Postgres instance" in production and kept the two services genuinely independent, matching Part 4.1's "three logical services... can be three processes in one repo to start."
- `POST /v1/auth/dev-login` mocks WorkOS's hosted-auth callback by trusting a client-supplied email outright — the entire authentication boundary in this build. This is explicitly a dev-only stand-in, not "good enough" auth; flagged loudly below and in the login page's own copy ("Dev build: signs you in immediately...").
- Policy API is CRUD-only in this milestone (create/list draft versions, `signature: null`) — no signing, no distribution, no client-side verification. That's Milestone 6's job per the Build Bible's explicit sequencing and CLAUDE.md's "Don't build the Enterprise policy-push feature before the signature-verification path is solid" instruction.
- Audit page shows a real subscription-plan check (hits the real API) behind a blurred *mock* preview table, since the actual tamper-evident audit data doesn't exist until Milestone 6. Chose to be honest about this (page comment + this log) rather than have it look further along than it is.

## Spec Deviations
- None to `docs/build-bible.md`'s content. The device-flow workspaceId-binding fix (start vs. approve) is a bug fix that makes the implementation match Part 6.2 as written, not a deviation from it — Part 6.2 already specifies the workspace comes from the approving Dashboard session.

## Mocks / Stubs
- **WorkOS human auth**: not integrated. `POST /v1/auth/dev-login` implements the identical downstream shape (upsert user/org, create session, httpOnly/Secure/SameSite=Lax cookie) but skips the actual magic-link/OAuth/SAML identity verification. PRODUCTION WIRING REQUIRED: swap this one handler's body for a real WorkOS code exchange; sessions/cookies/RBAC are already production-shaped.
- **Postgres**: still SQLite dev-only, per Milestone 3's note — now with the fuller Part 5.1 schema (orgs/users/sessions/policies/subscriptions) in addition to workspaces/machines/api_keys/events.
- **No real DB migration tool wired up** (CLAUDE.md's tech stack calls for Prisma/Drizzle for TS). Schema changes during this session (e.g. the device_codes workspace_id nullability fix) only apply to freshly-created SQLite files, not existing ones — hit this directly during e2e testing and worked around it by using a fresh dev DB. PRODUCTION WIRING REQUIRED: real Postgres + Drizzle (or equivalent) migrations before this ships anywhere persistent.
- **Dashboard-authenticated call into `/v1/auth/device/approve`**: the dashboard doesn't yet call this for real (would require the Settings page to have a "connect a machine" flow); it's exercised via the dev-auto-approve env var. The endpoint itself is real and now correctly workspace-scoped by whoever calls it — still not gated by session auth (documented in Milestone 3's log; unchanged).

## Production Wiring Required
- Real WorkOS integration behind `/v1/auth/dev-login`'s replacement.
- Real Postgres + Drizzle migrations (replacing services/app-api's and services/ingest's SQLite dev files).
- A Dashboard-side "connect a machine" UI that calls `/v1/auth/device/approve` from an authenticated session (currently only reachable via the dev-auto-approve env var or a raw API call).
- Session-based auth on `/v1/auth/device/approve` itself once the Dashboard is the only intended caller.

---

# Milestone 5

## Built

## Verified

## Executive Decisions

## Spec Deviations

## Mocks / Stubs

## Production Wiring Required

---

# Milestone 6

## Built

## Verified

## Executive Decisions

## Spec Deviations

## Mocks / Stubs

## Production Wiring Required

---

# Final Regression

## Tests Run

## Results

---

# Security Review

## Findings

---

# Morning Action Items

1.
2.
3.
