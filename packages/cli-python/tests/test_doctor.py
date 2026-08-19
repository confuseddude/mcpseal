# Mirrors packages/cli-node/src/doctor.test.ts. Control Plane
# unreachability must never fail allLocalOk (offline-first, Part 13).
import json
import os
import sys

from mcpseal.config import write_config
from mcpseal.doctor import format_doctor_report, run_doctor
from mcpseal.http_client import HttpResponse
from mcpseal.init import init as init_cmd

STUB_SERVER = os.path.join(os.path.dirname(__file__), "test_fixtures", "stub_server.py")
PY = sys.executable


def paths(tmp_path):
    return {
        "lockfile_path": str(tmp_path / ".mcp-lock.json"),
        "log_path": str(tmp_path / "events.jsonl"),
        "cfg_path": str(tmp_path / "config.json"),
    }


def write_mcp_json(tmp_path):
    (tmp_path / ".mcp.json").write_text(json.dumps({"mcpServers": {"stub": {"command": PY, "args": [STUB_SERVER]}}}), encoding="utf-8")


def test_healthy_install_reports_all_local_ok(tmp_path):
    write_mcp_json(tmp_path)
    init_cmd(str(tmp_path))
    (tmp_path / ".mcp.json.mcpseal-backup").write_text("{}", encoding="utf-8")

    report = run_doctor(str(tmp_path), **paths(tmp_path))
    lockfile_check = next(c for c in report.checks if c.name == "Lockfile")
    assert lockfile_check.ok is True
    assert report.allLocalOk is True


def test_missing_lockfile_flagged_with_init_remediation(tmp_path):
    report = run_doctor(str(tmp_path), **paths(tmp_path))
    lockfile_check = next(c for c in report.checks if c.name == "Lockfile")
    assert lockfile_check.ok is False
    assert "mcpseal init" in lockfile_check.remediation
    assert report.allLocalOk is False


def test_proxy_not_installed_flagged_with_install_remediation(tmp_path):
    write_mcp_json(tmp_path)
    report = run_doctor(str(tmp_path), **paths(tmp_path))
    proxy_check = next(c for c in report.checks if c.name == "Proxy installed")
    assert proxy_check.ok is False
    assert "mcpseal install" in proxy_check.remediation


def test_control_plane_unreachable_never_degrades_local_health(tmp_path):
    write_mcp_json(tmp_path)
    init_cmd(str(tmp_path))
    (tmp_path / ".mcp.json.mcpseal-backup").write_text("{}", encoding="utf-8")
    p = paths(tmp_path)
    write_config({"workspaceId": "w1", "machineId": "m1", "ingestUrl": "http://127.0.0.1:1"}, p["cfg_path"])

    def failing_request(method, url, headers, body):
        raise RuntimeError("ECONNREFUSED")

    report = run_doctor(str(tmp_path), request_fn=failing_request, **p)
    cp_check = next(c for c in report.checks if c.category == "control-plane")
    assert cp_check.ok is False
    assert report.allLocalOk is True  # the one thing that must hold regardless


def test_control_plane_trivially_ok_when_not_logged_in(tmp_path):
    report = run_doctor(str(tmp_path), **paths(tmp_path))
    cp_check = next(c for c in report.checks if c.category == "control-plane")
    assert cp_check.ok is True
    assert "not logged in" in cp_check.detail


def test_control_plane_reachable_when_healthy(tmp_path):
    p = paths(tmp_path)
    write_config({"workspaceId": "w1", "machineId": "m1", "ingestUrl": "http://127.0.0.1:8787"}, p["cfg_path"])

    def ok_request(method, url, headers, body):
        return HttpResponse(status=200, text="{}")

    report = run_doctor(str(tmp_path), request_fn=ok_request, **p)
    cp_check = next(c for c in report.checks if c.category == "control-plane")
    assert cp_check.ok is True


def test_format_doctor_report_shows_marks_and_summary(tmp_path):
    report = run_doctor(str(tmp_path), **paths(tmp_path))
    text = format_doctor_report(report)
    assert "MCPSEAL DOCTOR" in text
    assert "DEGRADED" in text
