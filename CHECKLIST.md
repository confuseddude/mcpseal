# Track A → Production Checklist

Where things actually stand today, what's left before calling Track A "done," and the full steps for GitHub-based Trusted Publishing. Track B (Control Plane/dashboard/backend) is intentionally out of scope here — revisit after funding, per CLAUDE.md.

Status snapshot as of `0.1.1`: live on npm and PyPI, real end-to-end tests pass, no GitHub repo exists yet (fully local git history, no remote).

---

## 0. Immediate/security debt (do these first, cheap)

- [ ] **Rotate the npm token that leaked into this session's transcript.** Still outstanding — flagged twice now. Low probability, high blast radius (someone could publish malicious versions under your account).
- [ ] **Rotate/regenerate the PyPI token too, out of caution** — it was handled more carefully (never printed), but it's cheap insurance to rotate anything that touched a chat session at all.
- [ ] Confirm neither token is sitting in a `.npmrc`/`.pypirc` anywhere that could get accidentally committed. Check `.gitignore` covers them (it should, but verify — a stray `git add -A` in a Downloads folder is exactly how these leak).

## 1. Ship a real GitHub repo (blocks almost everything else below)

- [ ] `git remote -v` is currently empty — there is no GitHub repo yet, just local history.
- [ ] Create the repo (public, since this is a free OSS distribution play), push `master` (or rename to `main` first — your call, but do it before pushing, not after).
- [ ] Add repo topics/description for discoverability (`mcp`, `model-context-protocol`, `security`, `cli`, `supply-chain`).
- [ ] This unlocks: Trusted Publishing (Section 4), issue tracking, a real "install from source" story, badges on the npm/PyPI package pages linking back to real code (huge trust signal for a security tool — right now your published packages point at nothing).

## 2. CI gaps

Current `.github/workflows/parity.yml` only runs `cli-core`, `shared-types`, and `cli-python` tests. It does **not** run `cli-node`'s own suite (the 147 tests covering `cli.ts`, `doctor.ts`, `login.ts`, the integration tests against the real compiled binary).

- [ ] Add a CI job for `cli-node`'s test suite (`pnpm --filter mcpseal build && pnpm --filter mcpseal test`) — right now a broken `cli.ts` could pass CI entirely.
- [ ] Add an OS matrix, at least for the keychain-touching code paths. `@napi-rs/keyring` (Node) and `keyring` (Python) behave differently per OS (Windows Credential Manager / macOS Keychain / Linux Secret Service) — you've only ever tested on Windows. `ubuntu-latest` + `macos-latest` in the matrix would catch a real class of bug you currently have zero coverage on.
- [ ] Add a minimum-supported-version check: Node 18 (per `engines` in `package.json`) and Python 3.10 (per `pyproject.toml`) aren't what CI actually runs (`node-version: 20`, `python-version: "3.11"`). If you claim `>=18`/`>=3.10`, test the floor, not just whatever's convenient.
- [ ] `npm audit` / `pip-audit` (or `pip install pip-audit && pip-audit`) as a CI step — you have exactly two runtime deps on the Node side (`@napi-rs/keyring`, `@noble/curves`) and three on Python (`canonicaljson`, `keyring`, `cryptography`), so this is cheap to run and matters a lot for a security-positioned tool with a supply-chain-attack thesis.
- [ ] Make the whole CI suite a required check before merge, once branch protection exists (Section 1).

## 3. Release hygiene (the stuff that bit you this week)

- [ ] **A version-consistency test.** You just manually `grep`'d for `"0.1.0"` across 10+ files and hand-edited each one. That's exactly the kind of thing that silently drifts on the next release. Add one test (either language) that reads `package.json`/`pyproject.toml` version and asserts every hardcoded `mcpsealVersion`/`clientInfo.version`/`generatedBy` string matches it — fail the build if they don't.
- [ ] **`mcpseal --version` / `-v`.** Doesn't exist right now — checked directly, only `help`/`--help`/`-h` are wired. This is the second most instinctive thing after `--help` for anyone debugging "which version do I actually have installed," especially once you're fielding bug reports from strangers.
- [ ] **`CHANGELOG.md`.** You shipped `0.1.0` → `0.1.1` with a real, user-facing fix (the `--help` bug) and nobody upgrading has any way to know that from the package page. Doesn't need to be fancy — Keep a Changelog format is fine.
- [ ] **A release checklist or script**, even a simple shell script, that does: bump version → run version-consistency test → run both full suites → build both packages → publish both → tag the commit (`git tag v0.1.1`) → smoke-test install from the real registries in a throwaway temp dir. You did all of this by hand this week; scripting it removes the chance of skipping the verification step under time pressure next time.
- [ ] Push git tags for `v0.1.0` and `v0.1.1` retroactively once the GitHub repo exists, so the release history isn't invisible.

## 4. Docs / trust signals for a security tool specifically

- [ ] **`SECURITY.md`** — how to report a vulnerability. For a tool whose entire pitch is "trust me to catch supply-chain attacks," not having a disclosed security-contact path is a real gap the moment you have any real users.
- [ ] **Badges on `README.md`**: npm version, PyPI version, license, CI status. Free, and it's the first thing a skeptical developer looks for before trusting a security CLI enough to run `npx`.
- [ ] **`CONTRIBUTING.md`** — even a short one, once the repo is public; lowers the bar for the first outside contributor / issue reporter.
- [ ] Link the GitHub repo from both package READMEs (`packages/cli-node/README.md`, `packages/cli-python/README.md`) once it exists — right now someone finding you on npm has no way to see the code, file an issue, or verify what they're running.

## 5. Test coverage gaps worth closing

- [ ] Real end-to-end test against an actual Claude Code install (not just the stub MCP server used in the integration tests) — you've done this manually but it's not automated or repeatable.
- [ ] A "rug pull actually gets blocked" test that mutates a live tool description mid-session (server changes its own description between two calls) rather than just testing static hash mismatch — closer to the real attack you're defending against.
- [ ] Coverage reporting (`vitest run --coverage`, `pytest --cov`) wired into CI, even without a hard threshold gate yet — mainly so you can *see* what's untested rather than guessing.

## 6. Nice-to-haves, not blockers

- [ ] `npm publish --provenance` (requires Trusted Publishing from GitHub Actions — see Section below — gives consumers a verifiable "built from this exact commit, in this exact CI run" attestation, visible on the npm package page as a badge)
- [ ] A `--repair`/`--fix` mode for `doctor` (already on your roadmap in `USERFEATURES.md`)
- [ ] Broader MCP client support beyond `.mcp.json`-style config discovery

---

# GitHub-Based Trusted Publishing — Full Setup

This replaces long-lived npm/PyPI tokens (the ones sitting in your local `.npmrc`/`.pypirc` right now, one of which already leaked into a chat transcript) with short-lived OIDC tokens minted per-CI-run. No secret ever sits on disk or in a session again. This is the single highest-leverage fix for the credential-handling problems from this week.

## Prerequisites
- A GitHub repo for this project (Section 1 above — must exist first, both flows below need it)
- Push access to that repo (you'll add a workflow file to it)

## Step 1 — Push the repo

```
git remote add origin https://github.com/<your-username>/mcpseal.git
git push -u origin master
```
(or push to `main` if you rename first — do it now, not after other steps depend on the branch name)

## Step 2 — Add the publish workflow

Create `.github/workflows/publish.yml` in the repo. This runs only on a version tag push (`v0.1.2`, etc.), so a normal `git push` never accidentally publishes.

```yaml
name: Publish

on:
  push:
    tags:
      - "v*"

jobs:
  publish-npm:
    name: Publish to npm
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # required for OIDC / Trusted Publishing
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: "https://registry.npmjs.org"
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter mcpseal build
      - run: pnpm --filter mcpseal test
      - run: cd packages/cli-node && npm publish --provenance --access public

  publish-pypi:
    name: Publish to PyPI
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # required for OIDC / Trusted Publishing
      contents: read
    defaults:
      run:
        working-directory: packages/cli-python
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install -e ".[dev]" build
      - run: pytest -q
      - run: python -m build
      - uses: pypa/gh-action-pypi-publish@release/v1
        with:
          packages-dir: packages/cli-python/dist
```

Note: no `NODE_AUTH_TOKEN` or API-key secret anywhere in this file. That's the entire point — the identity comes from GitHub's OIDC token, scoped to this exact repo + workflow, minted fresh per run, never stored anywhere.

## Step 3 — Configure npm Trusted Publishing

npm requires the package to already exist (it does — `mcpseal` is live). This links a specific repo+workflow as an authorized publisher.

1. Go to the `mcpseal` package page on npmjs.com → **Settings** tab.
2. Find **Trusted Publisher** (or **Publishing access**) section.
3. Add a GitHub Actions trusted publisher:
   - Organization/user: `<your-username>`
   - Repository: `mcpseal` (or whatever you name it)
   - Workflow filename: `publish.yml`
   - Environment name: leave blank unless you set one up
4. Save. From this point, `npm publish` from that exact workflow in that exact repo succeeds with zero token — npm verifies the OIDC claim against what you configured.
5. Once this works once, you can revoke the long-lived granular token you're using today (`npm token revoke`) — no more `.npmrc` on your machine at all for publishing.

## Step 4 — Configure PyPI Trusted Publishing

PyPI supports this even for a package that already exists (or a brand-new one via "pending publisher" — not needed here since `mcpseal` is live).

1. Go to https://pypi.org/manage/project/mcpseal/settings/ (log in first).
2. Find **Publishing** → **Add a new publisher**.
3. Fill in:
   - Owner: `<your-username>`
   - Repository name: `mcpseal`
   - Workflow name: `publish.yml`
   - Environment name: leave blank unless you set one up
4. Save. `pypa/gh-action-pypi-publish` in the workflow above needs no API token at all once this is configured — it exchanges the OIDC claim for a short-lived upload credential automatically.
5. Once confirmed working, delete the API token from your PyPI account settings and remove the local `~/.pypirc` file — nothing left on disk to leak.

## Step 5 — Cut the first Trusted-Publishing release

```
git tag v0.1.2
git push origin v0.1.2
```

Watch the Actions tab. If both jobs go green, check the npm and PyPI package pages — both should now show the "provenance"/"trusted publisher" verification badge, and there's no token anywhere in your environment for this to have worked.

## Step 6 — Clean up old credentials

- [ ] `npm token revoke <token-id>` for the granular token used this week (list them with `npm token list`)
- [ ] Delete the PyPI API token from account settings
- [ ] Delete or blank `~/.npmrc` and `~/.pypirc` — nothing should need them once CI publishes for you
- [ ] Confirm a manual `npm publish` from your machine now fails (proves the token is actually gone, not just unused)
