#!/usr/bin/env bash
#
# Verify a PUBLISHED release actually works, by installing it from the
# real registries into a throwaway directory -- not from the local
# workspace, which is the whole point. A green CI run only proves the
# artifact uploaded; this proves someone can install and run it.
#
#   ./scripts/smoke-test.sh 0.1.3

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: $0 <version>   (e.g. $0 0.1.3)" >&2
  exit 1
fi

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31mFAIL: %s\033[0m\n' "$1" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

# --- registries have it ----------------------------------------------------

step "Both registries serve $VERSION"
npm_code=$(curl -s -o /dev/null -w "%{http_code}" "https://registry.npmjs.org/mcpseal/$VERSION")
pypi_code=$(curl -s -o /dev/null -w "%{http_code}" "https://pypi.org/pypi/mcpseal/$VERSION/json")
[ "$npm_code" = "200" ] || fail "npm does not serve $VERSION (HTTP $npm_code)"
[ "$pypi_code" = "200" ] || fail "PyPI does not serve $VERSION (HTTP $pypi_code)"
echo "  npm 200, PyPI 200"

# --- provenance ------------------------------------------------------------

step "Build provenance is present"
attest=$(curl -s "https://registry.npmjs.org/-/npm/v1/attestations/mcpseal@$VERSION" || true)
case "$attest" in
  *slsa.dev/provenance*) echo "  npm: SLSA provenance attestation present" ;;
  *) fail "npm is missing a SLSA provenance attestation for $VERSION" ;;
esac

whl=$(curl -s "https://pypi.org/pypi/mcpseal/$VERSION/json" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const f=j.urls.find(u=>u.filename.endsWith('.whl'));console.log(f?f.filename:'')})")
[ -n "$whl" ] || fail "no wheel found on PyPI for $VERSION"
prov_code=$(curl -s -o /dev/null -w "%{http_code}" "https://pypi.org/integrity/mcpseal/$VERSION/$whl/provenance")
if [ "$prov_code" = "200" ]; then
  echo "  PyPI: PEP 740 attestation present for $whl"
else
  # PyPI's provenance can lag a little behind the upload.
  echo "  WARNING: PyPI provenance not yet available (HTTP $prov_code) -- recheck shortly."
fi

# --- npm artifact actually runs --------------------------------------------

step "npx mcpseal@$VERSION runs"
# Capture stdout only, first line, CR stripped. npm writes upgrade
# notices to stderr and Windows shells add a trailing \r -- folding
# either into the comparison makes a correct version look like a
# failure, which is exactly what happened the first time this ran.
out=$(npx -y "mcpseal@$VERSION" --version 2>/dev/null | head -n1 | tr -d '\r')
[ -n "$out" ] || fail "npx produced no version output"
[ "$out" = "$VERSION" ] || fail "npx reported '$out', expected '$VERSION'"
echo "  --version -> $out"
npx -y "mcpseal@$VERSION" --help >/dev/null 2>&1 || fail "npx --help failed"
echo "  --help ok"

# --- PyPI artifact actually runs, on Linux ---------------------------------

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  step "pip install mcpseal==$VERSION runs on Linux"
  docker run --rm python:3.11-slim bash -lc "
    set -e
    pip install -q 'mcpseal==$VERSION'
    got=\$(mcpseal --version)
    [ \"\$got\" = '$VERSION' ] || { echo \"FAIL: python CLI reported '\$got'\"; exit 1; }
    echo \"  --version -> \$got\"
    mcpseal --help >/dev/null
    echo '  --help ok'
    # logout must not crash where there is no keyring backend at all
    mkdir -p /tmp/p && mcpseal logout /tmp/p >/dev/null
    echo '  logout ok with no keyring backend'
  " || fail "Linux install/run of $VERSION failed"
else
  echo
  echo "WARNING: docker unavailable -- skipped the Linux check of the PyPI artifact."
fi

printf '\n\033[32mSmoke test passed for v%s.\033[0m\n' "$VERSION"
