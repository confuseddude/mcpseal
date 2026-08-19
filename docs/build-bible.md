# MCP Integrity Platform — The Build Bible

*A single source of truth for building the product end-to-end with Claude Code. Codenames are placeholders: the CLI binary is `mcpseal`, the lockfile is `.mcp-lock.json`, the SaaS backend is the **Control Plane**. Rename later; keep the architecture.*

---

## 0. How to use this document

Read Part 1 once to hold the whole system in your head. After that, each part is a self-contained work order you can hand to Claude Code more or less verbatim ("build the thing described in Part 4"). The build sequence in Part 12 tells you the order. Nothing here should be built out of order — the free CLI must exist and be genuinely useful before any hosted component, because the CLI is the entire distribution engine and the hosted parts are worthless without installs feeding them.

**The one architectural principle everything derives from:** the free tier runs entirely on the developer's machine and phones home to nothing by default. The paid tiers exist only because a single machine cannot answer "what is happening across my whole org, and can I prove it to an auditor." Every design decision below is downstream of that split. When in doubt, ask: *does this belong on the laptop (free) or in the Control Plane (paid)?* Detection and blocking → laptop. History, cross-agent view, policy push, audit export → Control Plane.

---

## PART 1 — SYSTEM ARCHITECTURE OVERVIEW

### 1.1 The three planes

```
┌─────────────────────────────────────────────────────────────────┐
│  LAPTOP / CI RUNNER  (Tier 1 — Free, no account, no network)      │
│                                                                   │
│   MCP Client (Cursor / Claude Code / Claude Desktop / Windsurf)   │
│        │  spawns server via config (command + args)               │
│        ▼                                                           │
│   ┌──────────────┐   stdio    ┌────────────────────┐              │
│   │  mcpseal     │◄──────────►│  Real MCP Server    │              │
│   │  (stdio proxy│            │  (github, slack…)   │              │
│   │   + verifier)│            └────────────────────┘              │
│   └──────┬───────┘                                                │
│          │ reads/writes                                           │
│          ▼                                                        │
│     .mcp-lock.json  (pinned hashes of every approved tool)        │
│          │                                                        │
│          │ (ONLY if user opted into a workspace: emit event)      │
└──────────┼────────────────────────────────────────────────────────┘
           │  HTTPS, signed, batched
           ▼
┌─────────────────────────────────────────────────────────────────┐
│  CONTROL PLANE  (Tier 2/3 — Hosted SaaS)                          │
│                                                                   │
│   Ingest API ──► Event Store (ClickHouse / Timescale)             │
│       │                                                           │
│   App API (Go/TS) ──► Postgres (orgs, users, policies, keys)      │
│       │                                                           │
│   Dashboard (Next.js)   Alert Worker (Slack/email)               │
│       │                                                           │
│   Policy Distribution ──► pushes signed .mcp-lock.json to fleet   │
│       │                                                           │
│   PQL Engine ──► flags "10+ installs on one domain" → sales       │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 The components and what each is responsible for

The **`mcpseal` CLI/proxy** is the whole free product and the wedge. It does three jobs: it generates the lockfile (`mcpseal init`), it sits transparently in the stdio path between the MCP client and each real MCP server verifying that every tool's definition matches the pinned hash, and it blocks execution the instant a tool's description or schema drifts from what was approved. It requires no account, no network, and no infrastructure. This is the thing 10,000 developers install.

The **lockfile (`.mcp-lock.json`)** is the system of record for "what did this developer approve." It is a plain JSON file committed to the repo (like `package-lock.json`). It contains a cryptographic hash of every tool's name, description, and input schema at the moment it was approved. Drift from these hashes is the entire detection mechanism.

The **Ingest API** is a write-optimized endpoint that accepts batched, signed event payloads from opted-in CLIs and writes them to the event store. It is deliberately dumb and fast — it validates the signature, checks the API key, and appends. No business logic.

The **App API** is the read/write backend for everything a human touches: orgs, users, teams, policies, API keys, billing state. Backed by Postgres.

The **Event Store** holds the high-volume time-series stream of tool-call and block events. This is a separate database from Postgres because it's a fundamentally different workload (append-heavy, time-ranged queries, cheap retention tiers).

The **Dashboard** is the Next.js web app the Security Lead logs into to see blocked attacks across the org, manage policy, and export audit trails.

The **Policy Distribution service** is the core Enterprise feature: it pushes a signed, org-approved `.mcp-lock.json` to every agent in the fleet so 5,000 machines can be updated centrally instead of one by one.

The **PQL Engine** is a scheduled job that watches ingest telemetry for buying signals (many installs on one email domain, a Team account crossing a size threshold) and flags them for sales.

### 1.3 The data flow in one paragraph

A developer runs `mcpseal init` in their repo. It launches each configured MCP server once, reads the tool list, hashes each tool, and writes `.mcp-lock.json`. From then on, their MCP client is pointed at `mcpseal` instead of the raw servers; `mcpseal` transparently proxies stdio but re-hashes every tool definition on each session start and on every `tools/list` response. If a hash matches the lockfile, traffic flows normally. If it drifts (a rug pull), `mcpseal` refuses to forward the tool, logs the event locally, and — only if the developer has joined a workspace — sends a signed event to the Ingest API. The Security Lead sees that event in the Dashboard within seconds, alongside every other agent in the company. When the company standardizes, an admin edits the canonical lockfile once in the Dashboard and the Policy Distribution service pushes it to the whole fleet.

---

## PART 2 — THE `.mcp-lock.json` SPECIFICATION

This is the heart of the product. Get it exactly right; everything else references it.

### 2.1 What gets hashed and why

MCP tool poisoning and rug pulls work by changing a tool's **description** or **input schema** after it was first approved — the model reads the changed metadata and follows hidden instructions, while the human still sees the old, benign-looking name. Therefore the pinned hash must cover exactly the fields an attacker would mutate: the tool `name`, the `description`, and the full `inputSchema` (JSON Schema). Nothing else. Do not hash volatile fields like server version strings or timestamps, or you'll get false-positive blocks on benign updates.

### 2.2 The canonical hashing algorithm

Hashing must be deterministic across machines and languages (TS and Python must produce identical hashes for the same tool), so canonicalize before hashing:

1. Build an object `{ name, description, inputSchema }`.
2. Serialize with **canonical JSON**: keys sorted lexicographically at every level, no insignificant whitespace, UTF-8, no trailing newline. (Use a canonical-JSON library — e.g. `json-canonicalize` in TS, `canonicaljson` in Python — never the language's default `JSON.stringify`/`json.dumps`, which don't guarantee key order or whitespace parity.)
3. `SHA-256` the canonical bytes; store as lowercase hex.

This determinism is non-negotiable: the Control Plane will re-hash tool definitions server-side to verify what a client reports, and it must arrive at the same digest.

### 2.3 The file schema

```json
{
  "version": 1,
  "generatedAt": "2026-08-17T00:00:00Z",
  "generatedBy": "mcpseal@0.1.0",
  "servers": {
    "github": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "commandHash": "sha256:9f2b…",
      "tools": {
        "create_issue": {
          "hash": "sha256:a1c3…",
          "description": "Create a new issue in a GitHub repository",
          "approvedAt": "2026-08-17T00:00:00Z",
          "approvedBy": "local",
          "status": "approved"
        },
        "search_repositories": {
          "hash": "sha256:77de…",
          "description": "Search for GitHub repositories matching a query",
          "approvedAt": "2026-08-17T00:00:00Z",
          "approvedBy": "local",
          "status": "approved"
        }
      }
    }
  },
  "policy": {
    "onDrift": "block",
    "onUnknownTool": "block",
    "allowNewToolsFromApprovedServer": false
  },
  "signature": null
}
```

Field notes. `commandHash` pins the command+args that launch the server, so an attacker can't swap the binary out from under an approved tool set. `description` stores the tool's last-approved description text alongside its `hash` — the hash alone can't be reversed, so without storing the plaintext, drift detection could never actually show the old-vs-new description diff Part 2.4 promises; this field exists purely to make that diff possible, it plays no role in the hash itself (still just `name`+`description`+`inputSchema` per Part 2.1/2.2). `status` per tool is one of `approved | denied | quarantined`; a denied tool is blocked even if its hash matches. `policy.onDrift` and `policy.onUnknownTool` default to `block` — fail closed, always. `allowNewToolsFromApprovedServer` defaults to `false` so a server that suddenly grows a new tool triggers review rather than silent trust. `signature` is `null` for a locally-generated lockfile and populated (see Part 9) when the Control Plane distributes a canonical, org-signed lockfile — this is how a client knows a pushed policy is authentic and not itself an attack.

### 2.4 The drift-detection state machine

On every session start and every `tools/list` response, for each tool the proxy observes:

- **Hash matches a lockfile tool with `status: approved`** → forward normally.
- **Hash matches a lockfile tool with `status: denied`** → block, log `blocked_denied`.
- **Tool name exists in lockfile but hash differs** → this is the rug pull. Block, log `blocked_drift`, surface the diff (old vs new description) to the user.
- **Tool name not in lockfile** → apply `onUnknownTool` (default block, log `blocked_unknown`).
- **Lockfile tool absent from server** → log `tool_removed` (informational; don't block, the tool's just gone).

The critical property: **the proxy fails closed.** If it can't read the lockfile, can't hash, or hits any internal error, it blocks and says so loudly. A security tool that fails open is worse than useless because it manufactures false confidence.

---

## PART 3 — THE CLI / SDK (TIER 1)

### 3.1 Language and distribution

Ship **two thin distributions over one shared core**: a TypeScript package runnable via `npx mcpseal` (because Cursor, Claude Code, VS Code, Windsurf and most MCP clients live in the Node ecosystem) and a Python package runnable via `uvx mcpseal` (because a large share of MCP servers are Python and many agent developers live in `uv`). Copy Invariant's proven distribution model exactly — a zero-install, no-config `uvx mcp-scan@latest`-style invocation was their single strongest adoption lever. The two front-ends must produce byte-identical lockfiles (see canonical hashing above); the cleanest way to guarantee that is to keep the hashing + drift logic in one place and treat TS/Python as wrappers, but if that's too slow to start, duplicate the logic and pin it with a shared cross-language test vector file (a fixture of tool definitions with their expected hashes that both languages' test suites assert against).

### 3.2 The command surface

```
mcpseal init            # discover MCP servers from client configs, generate .mcp-lock.json
mcpseal scan            # one-shot: re-hash all tools, report drift, exit non-zero on drift (CI-friendly)
mcpseal proxy <server>  # internal: the stdio proxy the client actually launches (not typed by humans)
mcpseal install         # rewrite MCP client configs to route servers through mcpseal proxy
mcpseal uninstall       # restore original client configs
mcpseal approve <tool>  # move a quarantined/unknown tool to approved, update lockfile
mcpseal deny <tool>     # mark a tool denied
mcpseal diff            # human-readable old-vs-new description diff for any drifted tool
mcpseal login           # (Tier 2+) authenticate this machine to a workspace
mcpseal status          # show which servers/tools are protected and workspace connection state
mcpseal policy-pull     # (Tier 3, Milestone 6) fetch the org's current signed policy, verify it
                        # against the org public key pinned at login, and atomically replace
                        # .mcp-lock.json — only if the signature verifies AND the version is
                        # newer. Any verification failure leaves the existing lockfile untouched.
```

`mcpseal init` and `mcpseal scan` must work with zero flags, zero config, and zero account. That's the adoption contract.

### 3.3 The install mechanism — how the proxy gets in the path

MCP clients launch servers from a config file (e.g. `claude_desktop_config.json`, Cursor's `mcp.json`) that specifies a `command` and `args`. `mcpseal install` rewrites each server entry so the client launches `mcpseal proxy <original-command…>` instead of the original command directly. `mcpseal proxy` then:

1. Spawns the real server as a child process.
2. Pipes the client's stdin to the child and the child's stdout back to the client — transparent stdio passthrough.
3. Parses the JSON-RPC stream. On `initialize` and `tools/list` responses, it intercepts the tool definitions, runs the drift state machine (Part 2.4), and either forwards the response untouched (approved) or replaces a blocked tool with an error / strips it (blocked), while logging locally.
4. Never modifies the *content* of approved traffic — it is a verifier, not a rewriter, on the happy path.

This is the whole reason you have no infrastructure and install in 30 seconds: enforcement happens in a local child process, not a network gateway. Keep it that way.

### 3.4 Local storage (free tier)

Everything the free tier needs lives in two places: `.mcp-lock.json` in the repo (committed, shareable) and a local append-only event log at `~/.mcpseal/events.jsonl` (not committed, machine-local, for `mcpseal status` history). No database, no daemon. The event log is what gets *optionally* shipped to the Control Plane if the user joins a workspace — same records, different destination.

---

## PART 4 — THE CONTROL PLANE: BACKEND SERVICES (TIER 2/3)

### 4.1 Service split

Run three logical services (they can be three processes in one repo to start; split later):

**Ingest API** — one job: accept `POST /v1/events` (batched, signed, API-key-authenticated), validate, append to the Event Store. Write-optimized, horizontally scalable, no reads. Keep it in **Go or Rust** because this is the component that eats the firehose from thousands of agents and you don't want GC pauses or per-request overhead here. If you're optimizing purely for founder velocity and volume is still low, Node/TS is acceptable at the start — but design the payload and endpoint so you can rewrite this service alone without touching anything else.

**App API** — the CRUD backend for orgs, users, teams, policies, API keys, billing. This is where business logic lives. **Node/TS (matches the SDK and dashboard, one language)** or Go — pick for team familiarity. Backed by Postgres.

**Workers** — background jobs: the Alert Worker (fan out Slack/email on high-severity events), the PQL Engine (scheduled buying-signal detection), and the Policy Distribution publisher.

### 4.2 The ingest contract

```
POST /v1/events
Authorization: Bearer <workspace_api_key>
X-McpSeal-Signature: <ed25519 sig of body, using machine key>
Content-Type: application/json

{
  "machineId": "uuid",           // stable per install, not PII
  "workspaceId": "uuid",
  "batch": [
    {
      "eventId": "uuid",
      "ts": "2026-08-17T00:00:01Z",
      "type": "blocked_drift",
      "server": "github",
      "tool": "create_issue",
      "observedHash": "sha256:…",
      "expectedHash": "sha256:…",
      "descriptionDiff": "…redacted-or-hashed…",
      "clientApp": "cursor",
      "mcpsealVersion": "0.1.0"
    }
  ]
}
```

Privacy discipline (this *is* a security product — leaking here is fatal): never transmit the contents or results of tool *calls*, only metadata about tool *definitions* and block decisions. Mirror Invariant's stated posture exactly — "collects data about tool descriptions and how they change over time, not your user data." Make the description diff redactable/hashable via config, and document precisely what leaves the machine. The consent to send anything at all is `mcpseal login` joining a workspace; before that, the Ingest API is never called.

### 4.3 Signature model

Each machine generates an **ed25519 keypair** on first `mcpseal login`; the public key is registered to the workspace. Every event batch is signed with the machine's private key. The Ingest API verifies the signature against the registered public key before accepting. This prevents a leaked API key alone from letting an attacker forge events (they'd also need a registered machine key), and it's the substrate for tamper-evident audit trails (Part 8).

---

## PART 5 — DATA MODEL

### 5.1 Postgres (relational, low-volume, transactional)

```sql
-- Organizations & identity
orgs            (id, name, domain, plan, created_at)         -- plan: free|team|enterprise
users           (id, org_id, email, name, role, created_at)  -- role: owner|admin|member|viewer
teams           (id, org_id, name)
team_members    (team_id, user_id)

-- The workspace a CLI connects to
workspaces      (id, org_id, name, created_at)
machines        (id, workspace_id, machine_id, public_key, hostname_hash,
                 first_seen, last_seen, mcpseal_version)

-- Auth
sessions        (id, user_id, expires_at, ...)     -- if using own session store
api_keys        (id, workspace_id, key_hash, name, created_at, last_used, revoked_at)

-- Policy (the canonical org lockfile, versioned)
policies        (id, org_id, version, lockfile_json, signature, created_by, created_at)
policy_targets  (policy_id, team_id)               -- which teams a policy applies to

-- Billing mirror (source of truth is Stripe)
subscriptions   (id, org_id, stripe_customer_id, stripe_sub_id, plan, seats, status)

-- PQL / sales
pql_signals     (id, org_id_or_domain, signal_type, strength, detected_at, handled)
```

Store **hashes of secrets, never the secrets**: `api_keys.key_hash` (argon2/bcrypt of the raw key, shown to the user exactly once at creation), `machines.hostname_hash` (don't store raw hostnames — PII minimization).

### 5.2 Event Store (ClickHouse or Timescale — high-volume, append, time-ranged)

```
events (
  event_id       UUID,
  workspace_id   UUID,
  machine_id     UUID,
  ts             DateTime64,
  type           LowCardinality(String),   -- blocked_drift | blocked_unknown | ...
  server         LowCardinality(String),
  tool           String,
  observed_hash  String,
  expected_hash  String,
  client_app     LowCardinality(String),
  severity       LowCardinality(String),
  ingested_at    DateTime64
)
PARTITION BY toYYYYMM(ts)
ORDER BY (workspace_id, ts)
TTL ts + INTERVAL 30 DAY   -- Team tier; longer/none for Enterprise
```

Retention is a **billing lever, not just an ops setting**: 30-day TTL on Team, configurable/unlimited on Enterprise. Implement it as per-workspace TTL policy, not a global one. This is exactly the visibility cap that drives upgrades.

Choose ClickHouse if you expect real volume and want cheap retention tiers and fast aggregations; choose Timescale if you'd rather stay in the Postgres ecosystem and volume is modest early. Either works; don't agonize — the schema above ports between them.

---

## PART 6 — AUTH & DASHBOARD LOGINS (the part you asked about specifically)

There are **two distinct auth systems**. Do not conflate them.

### 6.1 Human auth (Dashboard login)

This is browser-based, for the Security Lead and their team. Do **not** hand-roll SAML/OIDC. Use a provider — **WorkOS** (purpose-built for exactly this free-tier-email + enterprise-SSO split) or **Stytch/Clerk/Auth0** — and get three things from it:

- **Team tier:** email magic-link or Google OAuth login. No passwords (fewer breaches, less support). Self-serve signup.
- **Enterprise tier:** SAML/OIDC SSO via the customer's Okta/Entra/Ping, plus SCIM for user provisioning. This is the line item enterprises *always* pay for — WorkOS turns it into a config flow instead of months of engineering, which is the whole point of not building it yourself.
- **RBAC:** roles (`owner`, `admin`, `member`, `viewer`) enforced in your App API on every request. The provider authenticates *who* they are; your App API authorizes *what* they can do — never trust the client for authorization.

**Session mechanics.** After the provider validates identity, mint your own short-lived session (httpOnly, Secure, SameSite=Lax cookie) or a JWT with a rotating refresh token. Store session→user server-side (the `sessions` table) so you can revoke instantly (critical for a security product — an admin firing someone must be able to kill their session now). Scope every session to an `org_id`; a user in two orgs gets an org switcher, never simultaneous cross-org access.

The login flow, concretely:

```
Browser ──► /login ──► WorkOS hosted auth (magic link | Google | SAML)
        ◄── redirect with code ──
/callback ──► exchange code with WorkOS ──► get verified {email, org}
          ──► upsert user+org in Postgres
          ──► create server-side session, set httpOnly cookie
          ──► redirect to /dashboard
Every API call ──► middleware validates session cookie ──► loads user+role
              ──► authorizes action against role ──► proceeds or 403
```

### 6.2 Machine auth (CLI → Control Plane)

This is headless, for the `mcpseal` process shipping events. Completely separate mechanism:

- `mcpseal login` opens a browser to a **device-authorization flow** (like `gh auth login`): the CLI shows a code, the user approves it in the already-authenticated Dashboard, and the CLI receives a **workspace API key** (scoped to one workspace, revocable, stored in the OS keychain — `keytar` on Node, `keyring` on Python, never a plaintext dotfile).
- On the same login the CLI generates its **ed25519 machine keypair** and registers the public key to the workspace (Part 4.3).
- Thereafter every event batch carries `Authorization: Bearer <api_key>` **and** an ed25519 signature. Two factors: possession of the key and possession of the registered machine key. Revoking either (in the Dashboard) cuts the machine off.

Why two systems: humans need SSO/sessions/RBAC and log in rarely from browsers; machines need long-lived, narrowly-scoped, individually-revocable credentials and authenticate constantly headlessly. Forcing one model onto both is how auth bugs happen.

---

## PART 7 — THE DASHBOARD (Next.js)

### 7.1 Stack

Next.js (App Router) + TypeScript + Tailwind. Server components for data-heavy pages, a thin client layer for realtime. Talk to the App API (don't put business logic in Next.js route handlers beyond BFF glue). For realtime "an attack was just blocked" updates, use server-sent events or a websocket from the App API into the dashboard; poll as a fallback. Consult the `frontend-design` skill before building any UI so the visual system isn't templated-default.

### 7.2 The pages that matter

**Live Feed** — the money screen. A realtime stream of blocked events across every agent in the org, each row showing tool, server, machine, the old-vs-new description diff, and severity. This is the single view the free tier structurally cannot show (it only sees one machine), so it must be immediately, obviously valuable. This screen *is* the upgrade pitch.

**Fleet** — every machine/agent with its last-seen, mcpseal version, and connection health. This is where "how many agents do we have and are they all protected" gets answered — the question that turns a Team account into an Enterprise conversation.

**Policy** — view/edit the canonical org `.mcp-lock.json`, approve/deny tools org-wide, and (Enterprise) push to teams. Every edit is versioned in the `policies` table.

**Audit** — searchable, exportable, tamper-evident event history (Part 8). Enterprise-gated. This is the compliance deliverable.

**Settings** — SSO config (Enterprise), API keys, members/roles, billing (links to Stripe portal), retention settings.

### 7.3 Tier gating in the UI

Gate on the **visibility cap**, transparently. Free/Team users should *see* the Fleet and Audit screens with a clear "Enterprise" overlay explaining exactly what they'd get — pricing-page and in-product clarity that maps free-tier limits directly to paid benefits converts 2–3× better than vague gating. Never hide the value; show the locked door with a window in it.

---

## PART 8 — ENTERPRISE FEATURES (where the money is)

### 8.1 Centralized policy push

An admin edits the canonical lockfile in the Dashboard → App API writes a new `policies` row (version N+1) → **signs the lockfile with the org's private signing key** → the Policy Distribution worker marks it current for the targeted teams. Each `mcpseal` client polls (or receives via its event-channel response) the current policy version for its workspace; on a new version it downloads the signed lockfile, **verifies the org signature against the org public key it pinned at login**, and atomically replaces its local `.mcp-lock.json`. This is how one edit protects 5,000 agents. The signature verification is what stops the push channel from becoming an attack vector — a client only accepts a lockfile signed by its own org.

### 8.2 SSO & RBAC

Covered in Part 6.1 — WorkOS SAML/OIDC + SCIM, roles enforced server-side. This is table-stakes for enterprise procurement and, handled via the provider, is a config surface rather than a build.

### 8.3 Tamper-evident audit export

Compliance buyers don't just want logs; they want logs they can *prove* weren't altered. Implement a **hash chain**: each event stored server-side includes `prev_hash` = hash of the previous event in that workspace's chain, so any deletion or edit breaks the chain and is detectable. Combined with the per-event ed25519 machine signatures (Part 4.3), you can produce an export where each record is independently signed and the sequence is provably intact. Export formats: signed JSON and CSV, plus a verification script the auditor can run. This — not the storage — is the actual Enterprise product. Treat log integrity as core architecture from day one, not a later feature; retrofitting a hash chain onto an existing event store is painful.

---

## PART 9 — SECURITY OF THE SECURITY PRODUCT

You are shipping a tool that sits in the trust path of AI agents. If *you* get compromised, you become the supply-chain attack. Non-negotiables:

- **Fail closed everywhere.** Any error in the proxy blocks and reports; any error verifying a pushed policy rejects the policy and keeps the last-known-good.
- **Sign your releases.** The `mcpseal` binary/package must be signed and reproducible; publish checksums; use npm/PyPI provenance/attestations. An unsigned auto-update channel is a rug pull waiting to happen against your own users.
- **Pin the org signing key at login, verify every push.** (Part 8.1.) A pushed lockfile is the highest-value attack surface you have.
- **Minimize what leaves the machine.** Tool-definition metadata and block decisions only; never tool-call contents. Document it publicly; let users hash/redact diffs.
- **Secrets in the keychain, never dotfiles.** API keys via OS keychain; ed25519 private keys never leave the machine.
- **Server-side authorization on every request.** Never trust the client for what-they-can-do.
- **Rate-limit and validate ingest hard.** It's an unauthenticated-until-key-checked write endpoint eating a firehose; treat it as hostile input.

---

## PART 10 — BILLING (Stripe)

- **Team:** Stripe Checkout, self-serve, credit card, monthly or annual. Being the only credible self-serve-checkout option in a category where Lunar and Obot force a sales call for anything past free is a real differentiator — put "no sales call for Team" on the pricing page.
- **Enterprise:** Stripe Invoicing + sales-assisted, **annual only** (the audit/compliance buyer budgets annually; monthly at this tier just adds churn risk). Offer AWS/Azure/GCP Marketplace listings so procurement pays from existing cloud commit — measurably shortens security-tool sales cycles.
- **Metering:** if you add usage-based overage (agents or retention beyond plan), meter it in the App API and report to Stripe Billing; prefer a soft overage over a hard wall so fast-growing teams don't churn at the cap — they graduate to Enterprise instead.
- **Source of truth:** Stripe holds subscription truth; mirror status into `subscriptions` via webhooks for fast in-app gating. Never gate on a stale local copy without webhook reconciliation.

---

## PART 11 — REPO STRUCTURE

A monorepo keeps the cross-language hash parity honest and the deploy simple early.

```
mcpseal/
├── packages/
│   ├── cli-core/          # shared hashing + drift logic (the canonical spec)
│   ├── cli-node/          # npx mcpseal  (TS wrapper over core)
│   ├── cli-python/        # uvx mcpseal  (Python wrapper over core)
│   └── shared-types/      # event/lockfile schemas shared with backend
├── services/
│   ├── ingest/            # Go/Rust write-path
│   ├── app-api/           # TS/Go CRUD + auth + policy
│   └── workers/           # alerts, PQL, policy-distribution
├── apps/
│   └── dashboard/         # Next.js
├── test-vectors/
│   └── hash-fixtures.json # cross-language hash parity assertions (both CLIs must pass)
├── infra/                 # IaC (Terraform/Pulumi), migrations
└── docs/                  # this bible + public "what leaves your machine" doc
```

The `test-vectors/hash-fixtures.json` file is load-bearing: it's how you guarantee the Node and Python CLIs produce identical lockfiles forever. Both test suites assert against it in CI.

---

## PART 12 — THE BUILD SEQUENCE (what to hand Claude Code, in order)

Build strictly in this order. Each milestone is independently useful and de-risks the next.

**Milestone 1 — The lockfile core (week 1).** `cli-core`: canonical hashing, lockfile read/write, the drift state machine, and `hash-fixtures.json` with passing tests in both languages. No proxy yet. Deliverable: given a list of tool definitions, produce and diff a lockfile deterministically.

**Milestone 2 — The proxy + CLI (weeks 1–2).** `mcpseal init`, `mcpseal install/uninstall`, `mcpseal proxy`, `mcpseal scan`. Wire it into one real client (Claude Code or Cursor) against one real MCP server (e.g. the GitHub server). Deliverable: a rug pull you stage against a local server gets blocked, locally, with a visible diff, no account. **This is the entire free product and the whole wedge. Ship it publicly. Everything after this is monetization.**

**Milestone 3 — Ingest + Event Store (week 3).** Stand up Postgres + the event store, the Ingest API, `mcpseal login` (device flow + keychain + ed25519 registration), and opt-in event shipping. Deliverable: an opted-in machine's blocks appear in the event store.

**Milestone 4 — App API + Auth + Dashboard skeleton (weeks 3–4).** WorkOS human auth, sessions, RBAC, orgs/users/workspaces CRUD, and the **Live Feed** page reading from the event store. Deliverable: a Security Lead logs in and watches blocks stream in across machines. This is the first thing worth paying for.

**Milestone 5 — Billing + Team tier (week 5).** Stripe Checkout, plan gating (retention TTL, fleet-size visibility), pricing page. Deliverable: a self-serve credit-card upgrade that unlocks the Live Feed and 30-day retention.

**Milestone 6 — Enterprise (weeks 6–8+).** Policy Distribution (signed push), SSO/SCIM via WorkOS, tamper-evident audit export with the hash chain, marketplace listings. Deliverable: one edit pushes a signed lockfile to a fleet, and an admin exports a verifiable audit trail.

**Milestone 7 — PQL Engine (parallel, once ingest has data).** Scheduled job flagging "10+ installs on one email domain" and "Team account crossed N agents" into `pql_signals` for sales. Deliverable: buying signals surface automatically instead of you guessing.

---

## PART 13 — THE THINGS THAT WILL BITE YOU (read before you start)

The **cross-language hash parity** is the subtlest bug source; a single whitespace or key-order difference between the Node and Python canonical JSON silently produces different hashes and thus false-positive blocks on the "wrong" language's machines. The `hash-fixtures.json` gate exists solely to catch this — never skip it.

The **stdio proxy must be genuinely transparent** on the happy path; if it adds latency, drops framing, or mangles the JSON-RPC stream, developers will uninstall in minutes and your distribution engine dies. Test it against real clients under real load before shipping Milestone 2.

The **pushed-policy channel is your worst-case attack surface**; if an attacker can forge a policy push, they can approve a poisoned tool across a whole fleet. The org-signature-pinned-at-login verification (Part 8.1) is not optional and not a "later" item — design it into the policy format from the first Enterprise line of code.

**Fail-open anywhere is a silent catastrophe** — it doesn't error, it just quietly stops protecting while the dashboard still looks green. Audit every error path in the proxy and the policy verifier for fail-closed behavior specifically.

Finally, remember the **strategic risk from the earlier analysis**: the local-hook approach is cloneable by Lunar or Obot. Your durable moat is not the detection — it's the hosted cross-org visibility, the workflow lock-in of being the audit system of record, and speed of distribution. Build the free CLI to win installs and the Control Plane to be the thing they can't rip out, and a feature clone from a bigger competitor doesn't kill you.