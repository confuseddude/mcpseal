# Mirrors packages/cli-node/src/status.test.ts. build_status_report must
# never touch the network and must work with isolated temp paths, never
# the real ~/.mcpseal.
import os
import sys

from mcpseal.config import write_config
from mcpseal.event_log import append_event
from mcpseal.init import init as init_cmd
from mcpseal.status import build_status_report, format_status_report

STUB_SERVER = os.path.join(os.path.dirname(__file__), "test_fixtures", "stub_server.py")
PY = sys.executable


def paths(tmp_path):
    return {
        "lockfile_path": str(tmp_path / ".mcp-lock.json"),
        "log_path": str(tmp_path / "events.jsonl"),
        "cfg_path": str(tmp_path / "config.json"),
    }


def test_lockfile_missing_reports_actionable_detail(tmp_path):
    p = paths(tmp_path)
    report = build_status_report(str(tmp_path), **p)
    assert report.local.lockfilePresent is False
    assert report.local.lockfileError


def test_server_and_tool_counts_when_lockfile_exists(tmp_path):
    import json

    (tmp_path / ".mcp.json").write_text(json.dumps({"mcpServers": {"stub": {"command": PY, "args": [STUB_SERVER]}}}), encoding="utf-8")
    init_cmd(str(tmp_path))
    p = paths(tmp_path)
    report = build_status_report(str(tmp_path), log_path=p["log_path"], cfg_path=p["cfg_path"])
    assert report.local.lockfilePresent is True
    assert report.local.serverCount == 1
    assert report.local.toolCount > 0


def test_proxy_installed_flag(tmp_path):
    p = paths(tmp_path)
    report = build_status_report(str(tmp_path), **p)
    assert report.local.proxyInstalled is False
    (tmp_path / ".mcp.json.mcpseal-backup").write_text("{}", encoding="utf-8")
    report2 = build_status_report(str(tmp_path), **p)
    assert report2.local.proxyInstalled is True


def test_event_and_block_counts_isolated_from_real_machine_log(tmp_path):
    p = paths(tmp_path)
    append_event(type_="approved", server="s", tool="t1", log_path=p["log_path"])
    append_event(type_="blocked_drift", server="s", tool="t2", log_path=p["log_path"])
    report = build_status_report(str(tmp_path), **p)
    assert report.local.eventCount == 2
    assert report.local.blockCount == 1
    assert report.local.recentBlocks[0]["tool"] == "t2"


def test_connection_status_reflects_config(tmp_path):
    p = paths(tmp_path)
    report = build_status_report(str(tmp_path), **p)
    assert report.connection.loggedIn is False

    write_config({"workspaceId": "w1", "machineId": "m1", "ingestUrl": "http://127.0.0.1:8787"}, p["cfg_path"])
    report2 = build_status_report(str(tmp_path), **p)
    assert report2.connection.loggedIn is True
    assert report2.connection.workspaceId == "w1"


def test_format_status_report_has_both_sections(tmp_path):
    p = paths(tmp_path)
    report = build_status_report(str(tmp_path), **p)
    text = format_status_report(report)
    assert "LOCAL HEALTH" in text
    assert "CONTROL PLANE" in text
    assert "mcpseal init" in text
