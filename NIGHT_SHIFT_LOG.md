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

# Milestone 4

## Built

## Verified

## Executive Decisions

## Spec Deviations

## Mocks / Stubs

## Production Wiring Required

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
