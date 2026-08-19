import os

from mcplock.event_log import append_event, events_log_path, read_events, recent_blocks


def log_path(tmp_path):
    return str(tmp_path / "sub" / "events.jsonl")


def test_read_events_missing_file_returns_empty(tmp_path):
    assert read_events(log_path(tmp_path)) == []


def test_append_then_read_round_trips(tmp_path):
    path = log_path(tmp_path)
    append_event(type_="blocked_drift", server="s", tool="t", observed_hash="h1", expected_hash="h2", log_path=path)
    events = read_events(path)
    assert len(events) == 1
    assert events[0]["type"] == "blocked_drift"
    assert events[0]["server"] == "s"
    assert events[0]["observedHash"] == "h1"
    assert events[0]["eventId"]
    assert events[0]["ts"]


def test_description_diff_only_when_both_present(tmp_path):
    path = log_path(tmp_path)
    append_event(type_="blocked_drift", server="s", tool="t", old_description="old", new_description="new", log_path=path)
    events = read_events(path)
    assert events[0]["descriptionDiff"] == "- old\n+ new"

    append_event(type_="blocked_drift", server="s", tool="t2", log_path=path)
    events = read_events(path)
    assert "descriptionDiff" not in events[1]


def test_multiple_appends_multi_line(tmp_path):
    path = log_path(tmp_path)
    for i in range(3):
        append_event(type_="blocked_drift", server="s", tool=f"t{i}", log_path=path)
    assert len(read_events(path)) == 3


def test_skips_corrupted_line(tmp_path):
    path = log_path(tmp_path)
    append_event(type_="blocked_drift", server="s", tool="t", log_path=path)
    with open(path, "a", encoding="utf-8") as f:
        f.write("not json\n")
    append_event(type_="blocked_drift", server="s", tool="t2", log_path=path)
    events = read_events(path)
    assert len(events) == 2


def test_recent_blocks_filters_sorts_limits(tmp_path):
    path = log_path(tmp_path)
    append_event(type_="approved", server="s", tool="allowed", log_path=path)
    append_event(type_="blocked_drift", server="s", tool="b1", log_path=path)
    append_event(type_="blocked_denied", server="s", tool="b2", log_path=path)
    events = read_events(path)
    blocks = recent_blocks(events, limit=1)
    assert len(blocks) == 1
    assert blocks[0]["tool"] == "b2"  # most recent


def test_default_events_log_path_is_under_home_mcplock():
    path = events_log_path()
    assert path.endswith(os.path.join(".mcplock", "events.jsonl"))
