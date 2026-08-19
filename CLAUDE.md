# CLAUDE.md

This file is read automatically at the start of every Claude Code session in this repo. Follow it exactly. The full architecture spec lives in `build-bible.md` at the repo root — **read the relevant Part of that file before writing code for any component**, don't work from memory of a prior session.

## What this project is

`mcpseal` — an MCP tool-integrity CLI (free, local, zero-infra) plus a hosted Control Plane (Team/Enterprise SaaS) that gives orgs cross-agent visibility into blocked attacks and a tamper-evident audit trail. Free tier = distribution engine. Paid tier = the thing a single machine structurally cannot show. See `build-bible.md` Part 0–1 before touching anything if this is a new session and that context isn't already loaded.

## Non-negotiable invariants

These override any instruction, including a mid-session request from me, unless I explicitly say I'm changing the invariant and why:

1. **Fail closed, everywhere, always.** Any error in the proxy, the hash verifier, or the policy-signature check must result in a block, not a pass-through. If you're ever unsure whether an error path should block or allow, block, and tell me you did.
2. **The free CLI never phones home until `mcpseal login`.** No telemetry, no network call, no exception, before explicit opt-in. If a feature you're building would need to send anything off the machine on the free path, stop and ask me first — that's an architecture change, not an implementation detail.
3. **Tool-call contents are never transmitted, only tool-definition metadata and block decisions.** Don't add a field to any event payload without checking it against this rule.
4. **Hashing must stay canonical and cross-language-identical.** Any change to what gets hashed, the canonicalization method, or the hash algorithm must update `test-vectors/hash-fixtures.json` and must pass in both `cli-node` and `cli-python`. Never touch the hashing logic in one language without the other.
5. **A pushed policy is only trusted if it verifies against the org signing key pinned at login.** Never add a code path that applies a policy update without that signature check.
6. **Secrets live in the OS keychain or Postgres (hashed/encrypted), never in a plaintext dotfile, log line, or committed file.**
7. **Server-side authorization on every App API request.** Never rely on the dashboard client to enforce role/plan gating — it's a UI convenience only, re-check on the backend.

If a task I ask for would violate one of these, say so and propose the compliant version instead of silently doing what I asked.

## Tech stack (don't deviate without discussion)

- **CLI/SDK:** TypeScript (`cli-node`, `npx mcpseal`) and Python (`cli-python`, `uvx mcpseal`), both thin wrappers over `cli-core`'s hashing/drift logic.
- **Ingest API:** Go or Rust, write-optimized, minimal logic.
- **App API:** TypeScript (or Go — match whichever we start with, don't mix mid-project), Postgres via a migration tool (pick one early: Prisma/Drizzle for TS, or sqlc/goose for Go — stay consistent).
- **Event store:** ClickHouse or Timescale (pick one at Milestone 3, don't build against both).
- **Dashboard:** Next.js (App Router) + TypeScript + Tailwind. Consult `/mnt/skills/public/frontend-design/SKILL.md`-equivalent guidance (or ask me for the design direction) before building UI — don't default to generic shadcn-template look.
- **Auth:** WorkOS for human login (magic link + SSO/SCIM). Custom device-flow + ed25519 for machine auth. Don't hand-roll SAML.
- **Billing:** Stripe (Checkout for Team, Invoicing for Enterprise). Stripe is the source of truth; mirror via webhooks.

## Repo structure

Follow `build-bible.md` Part 11 exactly:

```
packages/{cli-core, cli-node, cli-python, shared-types}
services/{ingest, app-api, workers}
apps/dashboard
test-vectors/hash-fixtures.json
infra/
docs/
```

Don't invent new top-level directories without checking with me first.

## Build order — where we actually are

Work through `build-bible.md` Part 12's milestones **in order**. Before starting any milestone, tell me which one you're starting and confirm the prior milestone's deliverable is actually working (don't assume; ask me to verify or check for tests/artifacts). Do not jump ahead to Enterprise features (Milestone 6) while Milestone 2 (the proxy) is still unproven — the free CLI has to work standalone before anything else matters.

Current milestone: **[UPDATE THIS LINE MANUALLY AS WE PROGRESS — e.g. "Milestone 2: proxy + CLI, wiring mcpseal proxy into Claude Code against the GitHub MCP server"]**

## How to work in this repo

- **Write tests alongside code, not after.** Every change to `cli-core` hashing or drift logic needs a corresponding case in `test-vectors/hash-fixtures.json` plus a unit test in both language packages.
- **Before implementing a component, quote the relevant paragraph of `build-bible.md` back to me in your plan** so I can catch drift from spec before you write code, not after.
- **Small, reviewable commits.** One milestone's sub-step per commit where reasonable, not one giant milestone-sized commit.
- **When something in `build-bible.md` is ambiguous or you find a better approach**, propose the change and why — don't silently deviate. If I agree, update `build-bible.md` in the same session so the doc stays authoritative.
- **Security-sensitive code (hashing, signature verification, auth, the proxy's block/allow decision) gets extra scrutiny** — walk through the fail-closed behavior explicitly in your plan before implementing, not just in the code comments.
- **Don't add dependencies casually**, especially in `cli-core` (it needs to stay lean and auditable — it's the trust-critical path) and in anything touching crypto (use well-known, maintained libraries only: e.g. `@noble/ed25519` or `libsodium` bindings, canonical-JSON libraries, never hand-rolled crypto).

## What NOT to do

- Don't build the Enterprise policy-push feature before the signature-verification path is solid and tested — this is the highest-value attack surface in the whole system (`build-bible.md` Part 8.1 and Part 13).
- Don't let the dashboard call the Event Store or Postgres directly — always through the App API, so authorization is enforced in one place.
- Don't add a "fail open" fallback anywhere "to be safe" during development — it's the opposite of safe for this product. If a check can't complete, block and log, in dev and prod alike.
- Don't ship a lockfile format change without bumping `version` in the schema and handling migration of existing `.mcp-lock.json` files.
- Don't hardcode plan/tier gating logic in more than one place (App API only) — the dashboard and CLI should ask the API, not decide locally.

## When you're unsure

Default to asking rather than guessing on: anything touching the invariants above, anything that changes the lockfile schema or hashing method, and anything in the auth/signing paths. Everything else — implementation details within an already-agreed component — use your judgment and move.