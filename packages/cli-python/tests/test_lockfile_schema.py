import json
from pathlib import Path

from mcplock.lockfile_schema import Lockfile

FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "test-vectors"
    / "part-2.3-example-lockfile.json"
)


def test_round_trips_the_exact_part_2_3_example_json():
    raw = FIXTURE.read_text(encoding="utf-8")
    parsed: Lockfile = json.loads(raw)
    reparsed: Lockfile = json.loads(json.dumps(parsed))

    assert reparsed == parsed
    assert parsed["version"] == 1
    assert parsed["signature"] is None
    assert parsed["policy"]["onDrift"] == "block"
    assert parsed["policy"]["onUnknownTool"] == "block"
    assert parsed["policy"]["allowNewToolsFromApprovedServer"] is False
    assert parsed["servers"]["github"]["transport"] == "stdio"
    assert parsed["servers"]["github"]["tools"]["create_issue"]["status"] == "approved"
