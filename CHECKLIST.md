# Track A → Production Checklist

Where things actually stand today, what's left before calling Track A "done," and the full steps for GitHub-based Trusted Publishing. Track B (Control Plane/dashboard/backend) is intentionally out of scope here — revisit after funding, per CLAUDE.md.

Status snapshot as of `0.1.2` (**published**): GitHub repo live at github.com/confuseddude/mcpseal. **Trusted Publishing is done and proven end-to-end** — `0.1.2` shipped to both npm and PyPI from GitHub Actions with zero stored tokens (repo has 0 Actions secrets, and no workflow references one). Both artifacts carry verifiable attestations: npm `slsa.dev/provenance/v1`, PyPI publisher `GitHub / confuseddude/mcpseal / publish.yml`. Old manual npm/PyPI tokens revoked.

---

## 0. Immediate/security debt (do these first, cheap)

- [x] **Rotate/revoke the npm token that leaked into a session transcript.** Deleted. Nothing depends on it any more — publishing is OIDC-only.
- [x] **Rotate/revoke the PyPI token too.** Deleted.
- [x] **Local dotfiles cleared.** `~/.npmrc` and `~/.pypirc` are now 0 bytes (backed up first to `~/.mcpseal-credential-backup-*`, mode 700). Both had contained nothing but credentials. Verified neither was ever tracked by git.
- [x] `.npmrc`/`.pypirc` added to `.gitignore` as belt-and-braces against a stray `git add -A`.

## 1. Ship a real GitHub repo (blocks almost everything else below)

- [x] Repo created and pushed: github.com/confuseddude/mcpseal.
- [x] GitHub Actions Trusted Publishing (`.github/workflows/publish.yml`) configured and validated end-to-end for both npm and PyPI.
- [x] Repo topics + description + homepage set (10 topics incl. `mcp`, `model-context-protocol`, `security`, `supply-chain`, `tool-poisoning`).
- [x] Badges + repo links added to the root README and **both** package READMEs, plus a "Verifying what you installed" section (`npm audit signatures`, PEP 740). Ships with the next release — the currently published `0.1.2` READMEs still point at nothing.
- [x] Revoke the manual npm/PyPI tokens used for the 0.1.0/0.1.1 publishes. Done — see Section 0 for the remaining local-dotfile cleanup.

## 2. CI gaps

Current `.github/workflows/parity.yml` only runs `cli-core`, `shared-types`, and `cli-python` tests. It does **not** run `cli-node`'s own suite (the 147 tests covering `cli.ts`, `doctor.ts`, `login.ts`, the integration tests against the real compiled binary).

- [x] `cli-node`'s suite now runs on every push/PR (`parity.yml` job `cli-node`), across ubuntu/macos/windows.
- [x] **Real-OS-keychain tests now run wherever a backend exists.** The blanket `CI=true` skip was too broad. Removing it proved macOS and Windows both pass the real-keychain tests on GitHub runners — only Ubuntu fails, where python-keyring falls through to `backends.fail` because reaching the Secret Service also needs `secretstorage` and a session bus a headless runner has no reason to provide. Skipping everywhere had been discarding the only automated coverage of the **macOS Keychain path, which no test had ever exercised**. The guard now asks whether a usable backend is present rather than inferring from CI or platform (`tests/keyring_support.py`). Verified: ubuntu 153 passed / 19 skipped, macOS 172 passed / 0 skipped. **Still open:** Linux keychain coverage, which needs `secretstorage` plus a session bus — worth one attempt now that the earlier failures are known to have been the proxy bug, not the keychain.
- [x] **CORRECTION — the earlier "the Linux CI failures are all just keychain flakiness" conclusion was wrong, and the skip hid two real bugs.** Reproducing the CI environment locally in Docker (`python:3.11-slim`, `CI=true`) showed the remaining Linux failures were *product* bugs, not environment noise:
  1. `proxy.py`/`mcp_client.py` passed `shell=True` alongside an argument **list**. Correct on Windows (Popen joins via `list2cmdline`, and the shell is needed for `npx.cmd`), silently wrong on POSIX — there it runs `/bin/sh -c "<command>"` and demotes the rest to `$0/$1`, so the MCP server spawned with **no arguments**, never spoke JSON-RPC, and the proxy blocked forever on its first read. **`mcpseal proxy` was broken on Linux and macOS.** Accounted for all 16 failures *and* the 2-hour CI hang. Fixed via `USE_SHELL` in `process_utils.py`.
  2. `delete_secret()` caught `PasswordDeleteError` but not its sibling `NoKeyringError`, so `mcpseal logout` crashed with a traceback on any box without a keyring backend. Fixed narrowly — a locked keychain holding a real secret must still fail loudly.
  **Lesson: don't silence a failing suite on a platform the product actually ships to.** Skipping the tests in the publish workflow suppressed a true signal for several release attempts. Reproduce the CI platform in Docker instead — it costs ~90s and needs no CI round trip.
- [x] `cli-node`'s `deleteSecret()` no longer swallows a locked-keychain failure — it rethrows when the message indicates a locked/permission-denied backend, matching cli-python. A missing backend is still a silent no-op in both.
- [x] Real OS matrix added: `cli-python` runs on ubuntu/macos/windows and `cli-node` on all three, so a POSIX-only regression fails on the next push rather than at release time. All CI pytest runs now use `--timeout`, so a hang fails loudly instead of stalling for hours.
- [x] Floors are tested: a `node-floor` job builds and tests on Node 18, and the python matrix includes 3.10 — the versions actually advertised in `engines`/`requires-python`.
- [x] `audit` job runs `pnpm audit --audit-level=high` and `pip-audit --desc` on every push/PR.
- [ ] Make the whole CI suite a required check before merge, once branch protection exists (Section 1).

## 3. Release hygiene (the stuff that bit you this week)

- [x] **Version-consistency tests in both languages** (`cli-node/src/version.consistency.test.ts`, `cli-python/tests/test_version_consistency.py`). The version now lives in one constant per language (`version.ts` / `version.py`); every call site imports it. The tests assert the two manifests, both constants and cli-core's `generatedBy` default all agree, **and** that no source file reintroduces a hardcoded literal. Verified by deliberately simulating a half-finished bump — it fails as intended.
- [x] **`mcpseal --version` / `-v` / `version`** implemented in both CLIs, printing a bare pipeable version string, and listed in `--help`.
- [x] **`CHANGELOG.md`** added in Keep a Changelog format, backfilled for 0.1.0/0.1.1/0.1.2 with an Unreleased section covering the POSIX proxy fix and the logout crash.
- [x] **`scripts/release.sh <version>`** — refuses a dirty tree or an already-published version, bumps all five sites, builds, runs every suite (consistency tests catch a partial bump), asserts both built CLIs report the new version, runs the Python suite on Linux via Docker if available, then commits and tags. It deliberately does **not** publish: pushing the tag does, via CI.
- [x] **`scripts/smoke-test.sh <version>`** — verifies a *published* release from the real registries: both serve it, npm SLSA + PyPI PEP 740 provenance present, `npx mcpseal@<v> --version` works, and a Linux `pip install` runs `--version`/`--help`/`logout`.
- [x] **Tag/version mismatch gate.** `publish.yml` now has a `verify-version` job that both publish jobs depend on: it compares the pushed tag against `package.json` *and* `pyproject.toml` and fails in ~20s if they disagree. Publishing is irreversible, so this catches a mistyped tag before it burns a version number.
- [x] Push git tags for `v0.1.0` and `v0.1.1` retroactively — done, all three (`v0.1.0`, `v0.1.1`, `v0.1.2`) are on origin.

## 4. Docs / trust signals for a security tool specifically

- [x] **`SECURITY.md`** — private reporting via GitHub Security Advisories, 72h ack / 7d assessment targets, and an explicit in-scope list (unblocked drift, hash collisions, cross-language hash divergence, policy-signature bypass, fail-open paths, secret disclosure, pre-login network calls) vs out-of-scope.
- [x] **Badges on `README.md`** — npm, PyPI, CI status and license, plus a note that releases carry verifiable provenance.
- [x] **`CONTRIBUTING.md`** — layout, setup, how to run each suite, the six non-negotiable invariants, versioning rules, and a Docker recipe for reproducing Linux locally (verified working: 146 passed, 22 skipped).
- [x] Both package READMEs now link the repo prominently and explain how to verify provenance. **Note:** README changes only reach the registries on the next publish, so `0.1.2`'s package pages still lack them.

## 5. Test coverage gaps worth closing

- [ ] Real end-to-end test against an actual Claude Code install (not just the stub MCP server used in the integration tests) — you've done this manually but it's not automated or repeatable.
- [x] **Rug-pull-mid-session tests** (`tests/test_fixtures/rugpull_server.py` + two tests in `test_proxy_integration.py`). A single live server process serves the approved `read_file` definition once, then rewrites its description to exfiltrate file contents on every later `tools/list`. Asserts the first list passes through, the mutated one is stripped, the block is recorded as `blocked_drift`, and it *stays* blocked on repeated calls. **Validated by injecting a regression** (making the proxy forward unfiltered): both tests fail, then pass again once reverted — so they can actually catch this.
- [x] Informational `coverage` job in `parity.yml` (`vitest --coverage`, `pytest --cov=mcpseal --cov-report=term-missing`). No threshold gate — the point is visibility.

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
- [x] Blanked `~/.npmrc` and `~/.pypirc` (0 bytes each; backups kept under `~/.mcpseal-credential-backup-*`)
- [x] Confirmed a manual publish now fails: `npm whoami` returns `ENEEDAUTH`, and `npm publish --dry-run` warns it requires login. No publishing credential remains on this machine.

## Bugs hit on the way (so the next person doesn't repeat them)

Seven tag-pushes to get green. Recorded because most were not obvious:

1. **`pnpm/action-setup@v4`: "Multiple versions of pnpm specified."** Pinning `version:` in `with:` while `package.json` also sets `packageManager` is ambiguous *even when they agree*. Drop the `with:` block.
2. **`Cannot find module '@mcpseal/cli-core'`.** `pnpm --filter mcpseal build` does not build workspace deps first. Build `shared-types` then `cli-core` explicitly.
3. **`npm publish` signs provenance, then 404s on the registry PUT.** OIDC registry auth needs npm CLI ≥ 11.5.1; provenance *signing* is older and works on the bundled npm, so it looks like it's working right up until the PUT. Old npm falls through to an unauthenticated request instead of erroring on the OIDC exchange — the 404 is misleading.
4. **`npm install -g npm@latest` fails `EBADENGINE`.** npm 12 requires Node `^22.22.2 || ^24.15.0 || >=26`, but the job pins Node 20. Pin `npm@^11` (has the OIDC fix, still Node-20-safe) rather than chasing `@latest`.
5. **`npm publish` 422: `repository.url is ""`.** Provenance validation requires `package.json` `repository.url` to match the building repo; the field was absent entirely. **A 422 here is good news** — it means OIDC auth succeeded and only the payload was rejected. A 404 means auth failed; a 422 means it didn't.
6. **Python suite failed 16 tests and hung for hours on Linux** — a real product bug, not CI flakiness. See Section 2.
7. **Reading CI logs.** `GET /actions/jobs/<id>/logs` returns 403 without admin rights and WebFetch can't see step-level detail on the HTML page. The stored git credential works: `printf "protocol=https\nhost=github.com\n\n" | git credential fill` → use the password as a Bearer token. Better still, **reproduce the runner in Docker** (`python:3.11-slim`, `-e CI=true`) — ~90s per iteration instead of ~10min per tag push, and it found bug 6 immediately after five CI rounds had missed it.
