# mcpseal — Deployment Plan

Two genuinely separate deployments, don't conflate them:

- **Track A — the free CLI, for every developer.** Publishing `mcpseal` to npm and PyPI. No servers, no database, no ongoing cost. This is "done" in the sense that everything is built and tested; the only remaining steps require *your* accounts (I can't create them or hold credentials).
- **Track B — the paid Control Plane, for teams.** The dashboard + two backend services + database + auth + billing. This needs real infrastructure, and this document's Part 2 is the actual deployment plan for it: staged, cheapest-first, with a clear upgrade path as usage grows.

---

# Track A: Publishing the free CLI

## What's already true
- Both CLIs are fully built, tested (425 automated tests), and independently verified to install cleanly from a real built package into an isolated environment (not just `pip install -e .`).
- Licensed MIT (this session).
- Name cleared on npm, PyPI, and GitHub: `mcpseal`.

## What's left — and who does what

| Step | Who | Notes |
|---|---|---|
| Create an npm account | **You** | npmjs.com/signup. I cannot create accounts or handle your password. |
| `npm login` in a terminal | **You** | Interactive credential entry — I'm not allowed to do this even with permission. Type `! npm login` in this session and I'll see the result, or just do it in your own terminal. |
| Create a PyPI account + generate an API token | **You** | pypi.org/account/register. Use a scoped API token (Account Settings → API tokens), not your password, when uploading. |
| Bump version if you want (currently `0.1.0`) | **You** decide, I can edit | Purely your call — `0.1.0` is a perfectly normal first-publish version. |
| Run the actual publish commands | **Me, once you've done the above, with your explicit go-ahead each time** | `npm publish` (from `packages/cli-node`) and `python -m build && twine upload dist/*` (from `packages/cli-python`). Both are irreversible, public actions — I'll ask before running either, every time, even after you've logged in. |
| Set up "publish on tag/release" CI (optional but recommended) | **Me**, if you want it | A GitHub Actions workflow that runs `npm publish`/`twine upload` automatically when you push a version tag, using repo secrets for the npm/PyPI tokens (which you'd add yourself in GitHub's Settings → Secrets — I can't see or set those either). Saves you from ever running the manual commands again. |

## After it's published

- `npx mcpseal@latest init` and `uvx mcpseal init` work for literally anyone, with zero setup on your end beyond the publish itself.
- Updates: bump the version in `package.json`/`pyproject.toml`, publish again. No servers to restart, nothing to deploy — npm/PyPI *are* the deployment.
- Get it discovered (optional, ongoing, not blocking): a GitHub README that sells the 30-second quickstart, a submission to any MCP tool directories/awesome-lists you find, a short demo GIF of the rug-pull catch. None of this requires infrastructure.

**This track costs $0/month forever.** That's the whole point of "free tier = distribution engine."

---

# Track B: The paid Control Plane

This is the dashboard, the two backend services (`ingest`, `app-api`), and everything they depend on. Unlike Track A, this is genuinely not deployed anywhere yet — it only exists as code that's been run and tested *locally*, against a SQLite file, with mocked login and mocked (or not-yet-configured) billing.

## 0. The one prerequisite this plan assumes: the Postgres cutover

Every piece below assumes `services/app-api` and `services/ingest` are actually talking to a real Postgres database. **They currently aren't** — they run against local SQLite files, by design, for fast local development. The Postgres *schema and migrations* were built and verified against a real (throwaway) Postgres container earlier, but the code itself still calls `better-sqlite3` directly.

This was deliberately left undone in an earlier session, for a good reason worth repeating here: it touches the org/user/session/RBAC data layer — the single most security-sensitive read/write surface in the whole system — across roughly 40 functions, currently covered by tests that only exercise the SQLite path. That's exactly the kind of change that deserves a focused, reviewed session of its own rather than being folded into a "let's also deploy this" pass.

**So: before Track B's Stage 1 (real users, real data) can happen, this cutover needs to happen first.** It's a well-scoped, contained piece of work — probably a single good session — and I'm flagging it here as step 1 of the actual plan, not glossing over it. Stage 0 below (getting the pieces talking to each other) can proceed without it, using a real hosted Postgres from day one instead of SQLite, which is actually a smaller change than the "cutover" implies: swap `better-sqlite3` calls for `drizzle-orm`'s Postgres client, function-by-function, verified against the existing test suite at each step (which already has extensive RBAC/cross-org isolation coverage to catch regressions).

## 1. The architecture, and why each piece was chosen

```
                         ┌─────────────────────┐
   developer's laptop ──▶│   mcpseal CLI        │  (Track A — already done)
                         └──────────┬───────────┘
                                    │ ships blocked-tool events (opt-in)
                                    ▼
                         ┌─────────────────────┐
                         │  services/ingest      │  Fastify, write-optimized,
                         │  (Railway)            │  minimal logic
                         └──────────┬───────────┘
                                    │
                         ┌──────────▼───────────┐
                         │   Postgres (Neon)     │◀──────────┐
                         └──────────┬───────────┘            │
                                    │                          │
                         ┌──────────▼───────────┐    ┌─────────┴────────┐
                         │  services/app-api      │    │  WorkOS          │
                         │  (Railway)             │◀──▶│  (auth/SSO)      │
                         └──────────┬───────────┘    └──────────────────┘
                                    │                          
                         ┌──────────▼───────────┐    ┌──────────────────┐
                         │  apps/dashboard        │    │  Stripe          │
                         │  (Vercel)              │◀──▶│  (billing)       │
                         └───────────────────────┘    └──────────────────┘
```

| Piece | Recommendation | Why this one, not the alternatives |
|---|---|---|
| **Dashboard hosting** | **Vercel** | Built by the Next.js team; this app already uses App Router the way Vercel expects. Zero-config deploys straight from GitHub, automatic preview URLs on every PR (genuinely useful for reviewing dashboard changes before merge), global edge network included. The Hobby (free) tier's terms restrict it to non-commercial use, so budget for **Vercel Pro ($20/mo)** the moment you're processing real payments — cheap insurance against a ToS problem. Alternative if you want to stay free longer: Cloudflare Pages, which is genuinely free with no commercial-use restriction, at the cost of a rougher edge for Next.js's server-side features. |
| **Backend services** (`ingest`, `app-api`) | **Railway** | Usage-based billing (~$5/mo minimum, scales with actual usage), a Postgres add-on if you want it in the same place, git-push deploys, no unwanted cold-start sleep (unlike Render's free tier, which would make the dashboard feel broken every time it wakes a sleeping API). Two small Fastify services cost very little here at low traffic. Alternative: Fly.io, better if/when you want the ingest service running close to users in multiple regions — worth revisiting at Stage 2, not needed on day one. |
| **Database** | **Neon** (managed Postgres) | Real Postgres (matches the schema/migrations already built), a genuinely usable free tier (0.5GB, scales to zero when idle — perfect for pre-revenue), and branching (spin up a full copy of prod's schema for a staging environment or to test a migration, then throw it away) which maps naturally onto how `services/*/migrations` already works. Alternative: Supabase — comparable, but its free tier pauses a project after a week of inactivity, which is a nasty surprise the first time a demo goes stale. |
| **Event store** | **Same Postgres, for now** | The original spec calls for ClickHouse/Timescale eventually (Part 5.2) — genuinely the right call at scale, because event volume grows very differently from the rest of the data. But standing up a second database system before you have the event volume to justify it is pure cost and operational burden with no present benefit. The `events` table already has the right index (`workspace_id, ts`). Revisit this specifically when a single org's monthly event count gets into the tens of millions, or query latency on the Live Feed/Audit export actually becomes a problem — not before. |
| **Human auth** | **WorkOS (AuthKit)** | Already the project's planned choice, and its pricing genuinely lines up with the product's own Free/Team/Enterprise tiers: standard auth (magic link, social login) is free up to a large user count; SSO/SCIM connections (the Enterprise-tier feature) are what WorkOS actually charges for — so the cost only shows up exactly when you're charging an Enterprise customer for the feature that causes it. Replaces `services/app-api`'s current `dev-login` stand-in. |
| **Billing** | **Stripe** | Already fully wired in code (`services/app-api/src/billing.ts`) behind a mock/real switch — flip it on by setting real `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_TEAM_PRICE_ID`, no code changes needed. Zero fixed monthly cost, just per-transaction fees. |
| **Secrets** | **Platform env vars at first; Doppler or a real KMS later** | Railway/Vercel both support encrypted environment variables out of the box — genuinely fine for `MCPSEAL_MASTER_KEY`, Stripe keys, and WorkOS keys at Stage 0/1. Move to a dedicated secrets manager (Doppler has a usable free tier for small teams and syncs to both Vercel and Railway) once you have more than one or two people touching production config, or a real KMS (AWS Secrets Manager / GCP Secret Manager) once compliance (SOC2, etc.) is on the table. |
| **Domain + DNS** | **Cloudflare** | Registrar at cost (no markup, ~$10-12/yr for a `.com`), free DNS, and a free CDN/DDoS layer in front of Vercel/Railway if you want it. |
| **CI/CD** | **GitHub Actions** (already have `.github/workflows/parity.yml`) | Free tier minutes are generous for a small team; Vercel and Railway both have native GitHub integrations for auto-deploy on merge, so most of "CI/CD" here is really just "connect the GitHub repo" rather than writing pipeline YAML by hand. |
| **Monitoring** | **Platform logs at first; Axiom or Sentry once it hurts** | Both Fastify services currently run with `logger: false` — flip that to a real structured logger (`pino`, which Fastify already uses under the hood) before going to production, so platform logs are actually useful. Add a free tier of Sentry (error tracking, 5k events/mo free) once you have real users hitting real bugs, and/or Axiom (structured log search, generous free tier) once "grep the Railway logs" stops being fast enough. |

## 2. Cost by stage

| Stage | Who's using it | Monthly cost (rough) | What you're paying for |
|---|---|---|---|
| **Stage 0 — building/beta** | You + a handful of trusted testers, pre-revenue | **$0–10** | Vercel Hobby or Cloudflare Pages (free), Railway ~$5 minimum, Neon free tier, WorkOS free tier, Stripe $0 fixed, domain ~$1/mo amortized |
| **Stage 1 — first paying customers** | Tens of orgs, no SSO customers yet | **$45–90** | Vercel Pro $20, Railway $20–40 (both services under real load), Neon Launch ~$19, WorkOS still free, Stripe fees only (no fixed cost) |
| **Stage 2 — real scale / Enterprise** | Hundreds of orgs, some on SSO | **$300–1000+** | WorkOS SSO connections (~$125+/connection/mo — but you're charging Enterprise customers for exactly this), bigger Postgres tier or read replicas, dedicated ingest scaling (possibly multi-region on Fly.io), a real secrets manager, paid monitoring, and — only once genuinely justified by event volume — a managed ClickHouse/Timescale instance for the event store |

The jump from Stage 0 to Stage 1 is designed to be triggered by revenue (Stripe fees and Vercel Pro both scale with — or are justified by — actually having paying customers), not by a calendar date. You can sit at Stage 0 indefinitely while validating the product.

## 3. The actual step-by-step order

1. **Do the Postgres cutover** (see §0) — `services/app-api` and `services/ingest` query real Postgres instead of SQLite. This is real engineering work, not configuration; budget a focused session for it, with the existing RBAC/cross-org test suite as your regression safety net.
2. **Stand up Neon**, get a connection string, run the existing migrations (`pnpm --filter <service> db:migrate` — already built, already verified against a throwaway Postgres container).
3. **Get a WorkOS account**, create an AuthKit project, replace `services/app-api`'s `/v1/auth/dev-login` handler with a real WorkOS code exchange (everything downstream of it — sessions, cookies, RBAC — is already production-shaped and doesn't need to change).
4. **Deploy `services/ingest` and `services/app-api` to Railway.** Set real environment variables: the Neon connection string, a real random `MCPSEAL_MASTER_KEY` (never the insecure dev default), WorkOS keys, `MCPSEAL_DASHBOARD_ORIGINS` pointed at your real dashboard domain.
5. **Deploy `apps/dashboard` to Vercel**, pointed at the real `app-api` URL via `NEXT_PUBLIC_APP_API_URL`.
6. **Buy the domain on Cloudflare**, point DNS at Vercel (dashboard) and Railway (API subdomains, e.g. `api.yourdomain.com`, `ingest.yourdomain.com`).
7. **Get a real Stripe account.** Create the Team-plan Price object, set the three env vars — `billing.ts` switches from mock to real automatically, no code change. Register the webhook endpoint in Stripe's dashboard pointed at `https://api.yourdomain.com/v1/billing/webhook`.
8. **Smoke test the entire flow for real**: sign up via WorkOS, connect a machine via the CLI, trigger a real block, watch it appear on the real Live Feed, upgrade via real Stripe Checkout, publish a real signed policy, pull it on a real machine.
9. **Launch.** Turn on the platform logging/monitoring you set up in step 0's table before announcing it anywhere.

## 4. What I can and can't do for you in this track

I can write and edit all the code changes (the Postgres cutover, the WorkOS integration, environment-variable wiring, deploy configs). I **cannot**:
- Create accounts on Vercel/Railway/Neon/WorkOS/Stripe/Cloudflare — those need your email and identity.
- Enter payment details or log into any of those dashboards.
- See or generate real secrets on your behalf (API keys, the master key) — I can tell you exactly what to generate and where it goes, but you paste it into the platform's secret store yourself.
- Actually trigger a deploy to a production environment or push to a public/shared branch without your explicit go-ahead at that moment, per session policy on hard-to-reverse or externally-visible actions.

What I'll do at each step: tell you exactly what account/setting to create, what value to paste where, and then wire the code to use it — you stay in control of every credential and every "go live" moment.
