# Contributing to mcpseal

Thanks for looking. Bug reports are as valuable as patches here — especially "it didn't block something it should have."

**Security bugs do not go in the issue tracker.** See [SECURITY.md](SECURITY.md).

## Layout

```
packages/cli-core      canonical hashing + drift logic (TypeScript, trust-critical)
packages/cli-node      the `mcpseal` npm CLI, a thin wrapper over cli-core
packages/cli-python    the `mcpseal` PyPI CLI, same behavior, independent implementation
packages/shared-types  types shared across the TS packages
test-vectors/          hash fixtures both languages must agree on
```

The Node and Python CLIs are deliberately **two implementations of one spec**, not a port and a wrapper. They must produce byte-identical hashes.

## Getting set up

```bash
pnpm install
pnpm --filter @mcpseal/shared-types build
pnpm --filter @mcpseal/cli-core build
pnpm --filter mcpseal build

cd packages/cli-python && pip install -e ".[dev]"
```

## Running tests

```bash
pnpm --filter @mcpseal/cli-core test
pnpm --filter mcpseal test
cd packages/cli-python && pytest -q
```

Both suites must pass before a PR is merged.

### Testing on Linux from a non-Linux machine

Some bugs only appear on POSIX — the proxy spawned MCP servers incorrectly on Linux and macOS for several releases while every Windows test passed. Reproduce a CI-like Linux environment in about 90 seconds rather than pushing and waiting:

```bash
docker run --rm -e CI=true \
  -v "$PWD/packages/cli-python:/src/cli-python:ro" \
  -v "$PWD/test-vectors:/src/test-vectors:ro" \
  python:3.11-slim bash -lc '
    mkdir -p /work/packages
    cp -r /src/cli-python /work/packages/cli-python
    cp -r /src/test-vectors /work/test-vectors
    cd /work/packages/cli-python
    pip install -q -e ".[dev]" pytest-timeout
    pytest -q --timeout=60 -rf'
```

The `--timeout` matters: a hung test otherwise looks identical to a slow one, and a blocking read with no timeout can stall CI for hours.

Nineteen keychain tests skip automatically when `CI=true`, since a real OS keychain isn't available on headless runners. **If a test fails on Linux but passes on Windows, assume it's a real cross-platform bug until proven otherwise.** Skipping such a test has already hidden two genuine defects.

## Rules that aren't negotiable

These come from the project's threat model. A PR that breaks one won't be merged, however clean the code:

1. **Fail closed, everywhere.** Any error in the proxy, hash verifier, or signature check must block, not pass through. Never add a fail-open fallback "to be safe" — for this tool that's the opposite of safe.
2. **No network calls on the free path before `mcpseal login`.** No telemetry, no version pings, no exceptions.
3. **Tool-call *contents* are never transmitted.** Only tool-definition metadata and block decisions, and only after login.
4. **Hashing stays canonical and identical across languages.** Any change to what's hashed, the canonicalization, or the algorithm must update `test-vectors/hash-fixtures.json` and pass in *both* packages. Never change one language's hashing without the other.
5. **A pushed policy is only trusted if it verifies against the org key pinned at login.**
6. **Secrets live in the OS keychain.** Never a plaintext dotfile, log line, or committed file.

## Versioning

Both packages share a version and are released together. The version lives in exactly two places (`packages/cli-node/src/version.ts` and `packages/cli-python/mcpseal/version.py`) plus the two manifests; everything else imports it. Version-consistency tests in both suites fail the build if these drift, so don't hardcode a version string anywhere else — the test will catch it.

## Commits and PRs

- Small, reviewable commits; one logical change each.
- Write tests alongside the code, not after.
- Say what you verified and how. "Tests pass" is less useful than the actual output.
- Changes to hashing, signature verification, auth, or the proxy's block/allow decision get extra scrutiny — walk through the fail-closed behavior explicitly in the PR description.

## Releasing (maintainers)

Releases are cut by pushing a tag; there are no publishing credentials on any developer machine.

```bash
# bump version.ts, version.py, package.json, pyproject.toml (all four)
pnpm --filter mcpseal test && (cd packages/cli-python && pytest -q)   # consistency tests catch a partial bump
git commit -am "release: v0.1.3"
git tag -a v0.1.3 -m "v0.1.3"
git push origin master && git push origin v0.1.3
```

GitHub Actions publishes both packages via OIDC Trusted Publishing. If npm succeeds but PyPI fails (or vice versa), **do not reuse the tag** — bump to the next patch version, because published versions are immutable.
