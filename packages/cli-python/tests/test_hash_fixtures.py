import json
from pathlib import Path

import pytest

from mcpseal.hash import hash_tool

FIXTURES_PATH = Path(__file__).resolve().parents[3] / "test-vectors" / "hash-fixtures.json"
FIXTURES = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))


def test_has_at_least_10_cases():
    assert len(FIXTURES) >= 10


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f["case"])
def test_fixture_matches_hash_tool(fixture):
    assert hash_tool(fixture["tool"]) == fixture["expectedHash"]


def test_key_order_pairs_produce_identical_hashes():
    by_case = {f["case"]: f for f in FIXTURES}
    pairs = [f for f in FIXTURES if f.get("pairWith")]
    assert len(pairs) > 0
    for a in pairs:
        b = by_case[a["pairWith"]]
        assert a["expectedHash"] == b["expectedHash"]


def test_content_change_pairs_produce_different_hashes():
    by_case = {f["case"]: f for f in FIXTURES}
    pairs = [f for f in FIXTURES if f.get("differsFrom")]
    assert len(pairs) > 0
    for a in pairs:
        b = by_case[a["differsFrom"]]
        assert a["expectedHash"] != b["expectedHash"]
