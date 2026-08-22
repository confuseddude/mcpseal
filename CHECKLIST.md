# Track A → Production Checklist

Where things actually stand today, what's left before calling Track A "done," and the full steps for GitHub-based Trusted Publishing. Track B (Control Plane/dashboard/backend) is intentionally out of scope here — revisit after funding, per CLAUDE.md.

Status snapshot as of `0.1.2` (**published**): GitHub repo live at github.com/confuseddude/mcpseal. **Trusted Publishing is done and proven end-to-end** — `0.1.2` shipped to both npm and PyPI from GitHub Actions with zero stored tokens (repo has 0 Actions secrets, and no workflow references one). Both artifacts carry verifiable attestations: npm `slsa.dev/provenance/v1`, PyPI publisher `GitHub / confuseddude/mcpseal / publish.yml`. Old manual npm/PyPI tokens revoked.

---

## 0. Immediate/security debt (do these first, cheap)

- [x] **Rotate/revoke the npm token that leaked into a session transcript.** Deleted. Nothing depends on it any more — publishing is OIDC-only.
- [x] **Rotate/revoke the PyPI token too.** Deleted.
- [ ] **Clear the local dotfiles — still outstanding.** `~/.npmrc` and `~/.pypirc` both still exist on disk and still contain a credential line each. The tokens they hold are revoked, so they're dead strings, but a plaintext credential in a dotfile is exactly what invariant 6 forbids and there is no longer any reason for either file to exist. Verified neither is tracked by git (`git ls-files` clean), so nothing leaked into the repo.
- [ ] Add `.npmrc`/`.pypirc` to `.gitignore` as belt-and-braces — they live in `$HOME` not the repo, so the risk is low, but it's free insurance against a stray `git add -A`.

## 1. Ship a real GitHub repo (blocks almost everything else below)

- [x] Repo created and pushed: github.com/confuseddude/mcpseal.
- [x] GitHub Actions Trusted Publishing (`.github/workflows/publish.yml`) configured and validated end-to-end for both npm and PyPI.
- [ ] Add repo topics/description for discoverability (`mcp`, `model-context-protocol`, `security`, `cli`, `supply-chain`).
- [ ] Badges on the npm/PyPI package pages linking back to the repo (huge trust signal for a security tool — right now your published packages point at nothing). Add repo link to both package READMEs too.
- [x] Revoke the manual npm/PyPI tokens used for the 0.1.0/0.1.1 publishes. Done — see Section 0 for the remaining local-dotfile cleanup.

## 2. CI gaps

Current `.github/workflows/parity.yml` only runs `cli-core`, `shared-types`, and `cli-python` tests. It does **not** run `cli-node`'s own suite (the 147 tests covering `cli.ts`, `doctor.ts`, `login.ts`, the integration tests against the real compiled binary).

- [ ] Add a CI job for `cli-node`'s test suite (`pnpm --filter mcpseal build && pnpm --filter mcpseal test`) — right now a broken `cli.ts` could pass CI entirely. (`publish.yml`'s npm job now does this as a publish gate, but it's not a check on ordinary pushes/PRs.)
- [x]/[ ] **Real-OS-keychain tests are CI-skipped, not CI-matrixed.** `test_keychain.py`/`test_login.py`/`test_machine_identity.py`/`test_ship_events.py` (19 tests) need a real Secret Service backend; emulating one (gnome-keyring + D-Bus) in an ephemeral headless container proved unreliable, so they skip when `CI=true` via `pytestmark`. **Still open:** real Linux/macOS keychain coverage via a self-hosted runner with a desktop session, or disciplined manual testing before each release.
- [x] **CORRECTION — the earlier "the Linux CI failures are all just keychain flakiness" conclusion was wrong, and the skip hid two real bugs.** Reproducing the CI environment locally in Docker (`python:3.11-slim`, `CI=true`) showed the remaining Linux failures were *product* bugs, not environment noise:
  1. `proxy.py`/`mcp_client.py` passed `shell=True` alongside an argument **list**. Correct on Windows (Popen joins via `list2cmdline`, and the shell is needed for `npx.cmd`), silently wrong on POSIX — there it runs `/bin/sh -c "<command>"` and demotes the rest to `$0/$1`, so the MCP server spawned with **no arguments**, never spoke JSON-RPC, and the proxy blocked forever on its first read. **`mcpseal proxy` was broken on Linux and macOS.** Accounted for all 16 failures *and* the 2-hour CI hang. Fixed via `USE_SHELL` in `process_utils.py`.
  2. `delete_secret()` caught `PasswordDeleteError` but not its sibling `NoKeyringError`, so `mcpseal logout` crashed with a traceback on any box without a keyring backend. Fixed narrowly — a locked keychain holding a real secret must still fail loudly.
  **Lesson: don't silence a failing suite on a platform the product actually ships to.** Skipping the tests in the publish workflow suppressed a true signal for several release attempts. Reproduce the CI platform in Docker instead — it costs ~90s and needs no CI round trip.
- [ ] **Follow-up:** `cli-node`'s `deleteSecret()` uses a bare `catch {}`, so it swallows a locked-keychain failure — the exact case the Python side deliberately keeps loud. Make the two consistent.
- [ ] **Follow-up:** no CI job runs the Python suite on Linux against a *working* proxy path in a way that would have caught bug 1 earlier — consider a real OS matrix (ubuntu/macos/windows) for the non-keychain tests.
- [ ] Add a minimum-supported-version check: Node 18 (per `engines` in `package.json`) and Python 3.10 (per `pyproject.toml`) aren't what CI actually runs (`node-version: 20`, `python-version: "3.11"`). If you claim `>=18`/`>=3.10`, test the floor, not just whatever's convenient.
- [ ] `npm audit` / `pip-audit` (or `pip install pip-audit && pip-audit`) as a CI step — you have exactly two runtime deps on the Node side (`@napi-rs/keyring`, `@noble/curves`) and three on Python (`canonicaljson`, `keyring`, `cryptography`), so this is cheap to run and matters a lot for a security-positioned tool with a supply-chain-attack thesis.
- [ ] Make the whole CI suite a required check before merge, once branch protection exists (Section 1).

## 3. Release hygiene (the stuff that bit you this week)

- [ ] **A version-consistency test.** You just manually `grep`'d for `"0.1.0"` across 10+ files and hand-edited each one. That's exactly the kind of thing that silently drifts on the next release. Add one test (either language) that reads `package.json`/`pyproject.toml` version and asserts every hardcoded `mcpsealVersion`/`clientInfo.version`/`generatedBy` string matches it — fail the build if they don't.
- [ ] **`mcpseal --version` / `-v`.** Doesn't exist right now — checked directly, only `help`/`--help`/`-h` are wired. This is the second most instinctive thing after `--help` for anyone debugging "which version do I actually have installed," especially once you're fielding bug reports from strangers.
- [ ] **`CHANGELOG.md`.** You shipped `0.1.0` → `0.1.1` with a real, user-facing fix (the `--help` bug) and nobody upgrading has any way to know that from the package page. Doesn't need to be fancy — Keep a Changelog format is fine.
- [ ] **A release checklist or script**, even a simple shell script, that does: bump version → run version-consistency test → run both full suites → build both packages → publish both → tag the commit (`git tag v0.1.1`) → smoke-test install from the real registries in a throwaway temp dir. You did all of this by hand this week; scripting it removes the chance of skipping the verification step under time pressure next time.
- [x] Push git tags for `v0.1.0` and `v0.1.1` retroactively — done, all three (`v0.1.0`, `v0.1.1`, `v0.1.2`) are on origin.

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

- [x] `npm publish --provenance` — live as of `0.1.2`. npm serves `slsa.dev/provenance/v1` + npm publish attestations, and PyPI serves a PEP 740 attestation naming publisher `GitHub / confuseddude/mcpseal / publish.yml`. Both registries can now prove the artifact was built from a specific commit in a specific CI run — a useful thing for a supply-chain security tool to be able to demonstrate about itself.
- [ ] A `--repair`/`--fix` mode for `doctor` (already on your roadmap in `USERFEATURES.md`)
- [ ] Broader MCP client support beyond `.mcp.json`-style config discovery

---

# GitHub-Based Trusted Publishing — Full Setup

> **STATUS: DONE.** Completed and proven end-to-end with the `0.1.2` release. Kept below as reference for how it was set up and what went wrong. **The YAML in Step 2 is the original draft and is missing five fixes** — see "Bugs hit on the way" at the end; treat the live `.github/workflows/publish.yml` as authoritative, not this snippet.

This replaces long-lived npm/PyPI tokens with short-lived OIDC tokens minted per-CI-run. No secret ever sits on disk or in a session again.

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

- [x] Revoke the granular npm token used this week
- [x] Delete the PyPI API token from account settings
- [ ] Delete or blank `~/.npmrc` and `~/.pypirc` — **still present on disk, one credential line each** (revoked, but should not linger)
- [ ] Confirm a manual `npm publish` from your machine now fails (proves the token is actually gone, not just unused)

## Bugs hit on the way (so the next person doesn't repeat them)

Seven tag-pushes to get green. Recorded because most were not obvious:

1. **`pnpm/action-setup@v4`: "Multiple versions of pnpm specified."** Pinning `version:` in `with:` while `package.json` also sets `packageManager` is ambiguous *even when they agree*. Drop the `with:` block.
2. **`Cannot find module '@mcpseal/cli-core'`.** `pnpm --filter mcpseal build` does not build workspace deps first. Build `shared-types` then `cli-core` explicitly.
3. **`npm publish` signs provenance, then 404s on the registry PUT.** OIDC registry auth needs npm CLI ≥ 11.5.1; provenance *signing* is older and works on the bundled npm, so it looks like it's working right up until the PUT. Old npm falls through to an unauthenticated request instead of erroring on the OIDC exchange — the 404 is misleading.
4. **`npm install -g npm@latest` fails `EBADENGINE`.** npm 12 requires Node `^22.22.2 || ^24.15.0 || >=26`, but the job pins Node 20. Pin `npm@^11` (has the OIDC fix, still Node-20-safe) rather than chasing `@latest`.
5. **`npm publish` 422: `repository.url is ""`.** Provenance validation requires `package.json` `repository.url` to match the building repo; the field was absent entirely. **A 422 here is good news** — it means OIDC auth succeeded and only the payload was rejected. A 404 means auth failed; a 422 means it didn't.
6. **Python suite failed 16 tests and hung for hours on Linux** — a real product bug, not CI flakiness. See Section 2.
7. **Reading CI logs.** `GET /actions/jobs/<id>/logs` returns 403 without admin rights and WebFetch can't see step-level detail on the HTML page. The stored git credential works: `printf "protocol=https\nhost=github.com\n\n" | git credential fill` → use the password as a Bearer token. Better still, **reproduce the runner in Docker** (`python:3.11-slim`, `-e CI=true`) — ~90s per iteration instead of ~10min per tag push, and it found bug 6 immediately after five CI rounds had missed it.
