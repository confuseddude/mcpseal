"""Mirrors packages/cli-node/src/version.consistency.test.ts.

docs/CHECKLIST.md section 3: the version used to live in ~10 hand-edited
places across both languages, so a release meant grepping for the old
number and hoping you caught them all. This test is the enforcement --
it fails the build if the two languages' manifests drift apart, or if
any source file reintroduces a hardcoded version literal.

Deliberately duplicated in both languages rather than living in one:
either suite can be run alone, and a Python-only contributor must still
trip the check.
"""

import re
from pathlib import Path

import pytest

from mcpseal.version import GENERATED_BY, VERSION

CLI_PYTHON_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = CLI_PYTHON_ROOT.parents[1]
CLI_NODE_ROOT = REPO_ROOT / "packages" / "cli-node"
CLI_CORE_ROOT = REPO_ROOT / "packages" / "cli-core"

SEMVER_LITERAL = re.compile(r"""["'](\d+\.\d+\.\d+)["']""")


def _requires(path: Path):
    """Skip a cross-package check when the sibling package isn't present.

    The cli-python suite is routinely run against a partial tree -- the
    Docker recipe in CONTRIBUTING.md mounts only cli-python and
    test-vectors, which is the whole point of it being fast. A missing
    sibling means "not checkable here", not "versions have drifted";
    hard-failing would train people to ignore this file. CI checks out
    the full repo, so these still run where it counts.
    """
    return pytest.mark.skipif(
        not path.exists(), reason=f"{path.relative_to(REPO_ROOT)} not present (partial checkout)"
    )


def test_version_matches_pyproject():
    pyproject = (CLI_PYTHON_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    m = re.search(r'^version\s*=\s*"([^"]+)"', pyproject, re.MULTILINE)
    assert m, "no version field found in pyproject.toml"
    assert m.group(1) == VERSION


@_requires(CLI_NODE_ROOT / "package.json")
def test_version_matches_cli_node_package_json():
    import json

    pkg = json.loads((CLI_NODE_ROOT / "package.json").read_text(encoding="utf-8"))
    assert pkg["version"] == VERSION, (
        "cli-node and cli-python versions have drifted; releases are cut together"
    )


@_requires(CLI_NODE_ROOT / "src" / "version.ts")
def test_version_matches_cli_node_version_ts():
    src = (CLI_NODE_ROOT / "src" / "version.ts").read_text(encoding="utf-8")
    m = re.search(r'^export const VERSION\s*=\s*"([^"]+)"', src, re.MULTILINE)
    assert m, "no VERSION constant found in cli-node/src/version.ts"
    assert m.group(1) == VERSION


def test_generated_by_is_derived_not_hand_written():
    assert GENERATED_BY == f"mcpseal@{VERSION}"


@_requires(CLI_CORE_ROOT / "src" / "lockfile.ts")
def test_cli_core_lockfile_generated_by_default_matches():
    # cli-core's createEmptyLockfile() default names the mcpseal CLI
    # version (not cli-core's own package version), so it cannot import
    # from either CLI package. It is pinned here instead.
    src = (REPO_ROOT / "packages" / "cli-core" / "src" / "lockfile.ts").read_text(
        encoding="utf-8"
    )
    m = re.search(r'generatedBy\s*=\s*"mcpseal@([\d.]+)"', src)
    assert m, "no generatedBy default found in cli-core/src/lockfile.ts"
    assert m.group(1) == VERSION


def test_no_source_file_hardcodes_the_version():
    roots = [r for r in (CLI_PYTHON_ROOT / "mcpseal", CLI_NODE_ROOT / "src") if r.exists()]
    offenders = []

    for root in roots:
        for path in root.rglob("*"):
            if path.suffix not in (".py", ".ts"):
                continue
            if path.name in ("version.py", "version.ts", "version.consistency.test.ts"):
                continue
            if "__pycache__" in path.parts or "node_modules" in path.parts:
                continue

            text = path.read_text(encoding="utf-8")
            for m in SEMVER_LITERAL.finditer(text):
                # Only flag literals equal to the current release version --
                # those are the ones that silently rot on the next bump.
                # Unrelated semvers (MCP protocol versions, dep pins) are fine.
                if m.group(1) != VERSION:
                    continue
                line = text[: m.start()].count("\n") + 1
                offenders.append(f"{path.relative_to(REPO_ROOT)}:{line}")

    assert not offenders, (
        f'Hardcoded "{VERSION}" found. Import VERSION from the version module instead:\n  '
        + "\n  ".join(offenders)
    )
