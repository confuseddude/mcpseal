#!/usr/bin/env bash
#
# Cut a release. Publishing itself happens in GitHub Actions via OIDC
# Trusted Publishing -- there are no credentials on this machine and this
# script never touches a registry. It bumps the version everywhere,
# proves both suites pass, and pushes the tag that triggers the release.
#
#   ./scripts/release.sh 0.1.3
#
# Why a script: the version lives in four files, and every previous
# release was a manual grep-and-edit. One missed file ships a package
# that misreports its own version. The consistency tests below catch
# that, but only if they are actually run -- which is the part that gets
# skipped under time pressure.

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: $0 <version>   (e.g. $0 0.1.3)" >&2
  exit 1
fi
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: '$VERSION' is not a bare semver (expected e.g. 0.1.3)" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
REPO_ROOT="$PWD"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# --- preflight -------------------------------------------------------------

step "Preflight"

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty. Commit or stash first." >&2
  git status --short >&2
  exit 1
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "error: tag v$VERSION already exists locally." >&2
  exit 1
fi

# Published versions are immutable on both registries. Reusing one is not
# possible, so check before doing any work.
for probe in \
  "https://registry.npmjs.org/mcpseal/$VERSION|npm" \
  "https://pypi.org/pypi/mcpseal/$VERSION/json|PyPI"
do
  url="${probe%|*}"; name="${probe#*|}"
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  if [ "$code" = "200" ]; then
    echo "error: $name already has version $VERSION. Versions are immutable -- pick the next one." >&2
    exit 1
  fi
done
echo "v$VERSION is unpublished on both registries."

# --- bump ------------------------------------------------------------------

step "Bumping version to $VERSION"

# The four places the version actually lives. Everything else imports it,
# and the consistency tests below fail the build if that stops being true.
python - "$VERSION" <<'PY'
import re, sys, pathlib
version = sys.argv[1]
edits = [
    ("packages/cli-node/package.json",     r'("version":\s*)"[^"]+"',        r'\1"%s"' % version),
    ("packages/cli-node/src/version.ts",   r'(export const VERSION = )"[^"]+"', r'\1"%s"' % version),
    ("packages/cli-python/pyproject.toml", r'(?m)^(version = )"[^"]+"',      r'\1"%s"' % version),
    ("packages/cli-python/mcpseal/version.py", r'(?m)^(VERSION = )"[^"]+"',  r'\1"%s"' % version),
    ("packages/cli-core/src/lockfile.ts",  r'(generatedBy = "mcpseal@)[\d.]+"', r'\g<1>%s"' % version),
]
for path, pattern, repl in edits:
    p = pathlib.Path(path)
    text = p.read_text(encoding="utf-8")
    new, n = re.subn(pattern, repl, text, count=1)
    if n != 1:
        sys.exit(f"error: could not bump version in {path}")
    p.write_text(new, encoding="utf-8")
    print(f"  bumped {path}")
PY

# --- verify ----------------------------------------------------------------

step "Building"
pnpm install --frozen-lockfile
pnpm --filter @mcpseal/shared-types build
pnpm --filter @mcpseal/cli-core build
pnpm --filter mcpseal build

step "Running every suite (consistency tests catch a partial bump)"
pnpm --filter @mcpseal/shared-types test
pnpm --filter @mcpseal/cli-core test
pnpm --filter mcpseal test
( cd packages/cli-python && python -m pytest -q )

step "Verifying the built CLI reports $VERSION"
built=$(node packages/cli-node/dist/cli.js --version)
[ "$built" = "$VERSION" ] || { echo "error: built CLI reports '$built', expected '$VERSION'" >&2; exit 1; }
echo "  cli-node: $built"
pybuilt=$( cd packages/cli-python && python -m mcpseal.cli --version )
[ "$pybuilt" = "$VERSION" ] || { echo "error: python CLI reports '$pybuilt', expected '$VERSION'" >&2; exit 1; }
echo "  cli-python: $pybuilt"

# Linux-only bugs have shipped before (the proxy was broken on POSIX for
# several releases while every Windows test passed). Check if we can.
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  step "Running the Python suite on Linux (docker)"
  # Docker Desktop on Windows needs a Windows-style host path: Git Bash's
  # $PWD is /c/Users/... which it silently fails to resolve, mounting
  # nothing. `pwd -W` prints C:/Users/... under Git Bash and doesn't
  # exist elsewhere, so fall back to the plain path on Linux/macOS.
  # MSYS_NO_PATHCONV stops Git Bash rewriting the container-side paths.
  HOST_ROOT="$(pwd -W 2>/dev/null || printf '%s' "$REPO_ROOT")"
  MSYS_NO_PATHCONV=1 docker run --rm -e CI=true \
    -v "$HOST_ROOT/packages/cli-python:/src/cli-python:ro" \
    -v "$HOST_ROOT/packages/cli-node:/src/cli-node:ro" \
    -v "$HOST_ROOT/test-vectors:/src/test-vectors:ro" \
    python:3.11-slim bash -lc '
      mkdir -p /work/packages/cli-node/src
      cp -r /src/cli-python /work/packages/cli-python
      cp -r /src/test-vectors /work/test-vectors
      cp /src/cli-node/package.json /work/packages/cli-node/
      cp /src/cli-node/src/version.ts /work/packages/cli-node/src/
      cd /work/packages/cli-python
      pip install -q -e ".[dev]" pytest-timeout
      pytest -q --timeout=120 --timeout-method=thread -rf'
else
  echo
  echo "WARNING: docker unavailable -- skipping the Linux run."
  echo "         Linux-only regressions have shipped this way before."
fi

# --- ship ------------------------------------------------------------------

step "Committing and tagging"
git add -A
git commit -m "release: v$VERSION"
git tag -a "v$VERSION" -m "v$VERSION"

cat <<EOF

Ready. Nothing has been published yet -- pushing the tag is what triggers it:

    git push origin master && git push origin v$VERSION

Then watch: https://github.com/confuseddude/mcpseal/actions

Afterwards, smoke-test the real published artifacts:

    ./scripts/smoke-test.sh $VERSION

If npm succeeds but PyPI fails (or vice versa), do NOT reuse the tag --
that version is burned on the registry that accepted it. Bump and re-run.
EOF
