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


# --- opt-in update check (--check-updates) ---
# CLAUDE.md invariant 2 / the product's own privacy promise: this must
# never happen automatically.


def test_zero_network_calls_when_check_updates_not_passed(tmp_path):
    def forbidden_request(method, url, headers, body):
        raise AssertionError("must never be called without check_updates=True")

    run_doctor(str(tmp_path), request_fn=forbidden_request, **paths(tmp_path))


def test_no_update_check_reported_when_flag_omitted(tmp_path):
    report = run_doctor(str(tmp_path), **paths(tmp_path))
    assert not any(c.category == "update" for c in report.checks)


def test_reports_up_to_date_when_pypi_matches_installed(tmp_path):
    from mcpseal.doctor import _get_own_version

    # Uses the same graceful helper doctor.py itself uses (falls back to
    # "unknown" when running from source rather than an installed
    # distribution, which is how these tests run) rather than calling
    # importlib.metadata directly and failing here.
    own_version = _get_own_version()

    def ok_request(method, url, headers, body):
        return HttpResponse(status=200, text=json.dumps({"info": {"version": own_version}}))

    report = run_doctor(str(tmp_path), request_fn=ok_request, check_updates=True, **paths(tmp_path))
    check = next(c for c in report.checks if c.category == "update")
    assert check.ok is True
    assert "latest" in check.detail


def test_flags_outdated_version_without_affecting_all_local_ok(tmp_path):
    write_mcp_json(tmp_path)
    init_cmd(str(tmp_path))
    (tmp_path / ".mcp.json.mcpseal-backup").write_text("{}", encoding="utf-8")

    def ok_request(method, url, headers, body):
        return HttpResponse(status=200, text=json.dumps({"info": {"version": "999.0.0"}}))

    report = run_doctor(str(tmp_path), request_fn=ok_request, check_updates=True, **paths(tmp_path))
    check = next(c for c in report.checks if c.category == "update")
    assert check.ok is False
    assert "999.0.0" in check.detail
    assert "pip install --upgrade mcpseal" in check.remediation[0]
    assert report.allLocalOk is True


def test_update_check_failure_is_informational_not_fatal(tmp_path):
    def failing_request(method, url, headers, body):
        raise RuntimeError("network down")

    report = run_doctor(str(tmp_path), request_fn=failing_request, check_updates=True, **paths(tmp_path))
    check = next(c for c in report.checks if c.category == "update")
    assert check.ok is True
    assert "could not reach PyPI" in check.detail


def test_update_check_hits_pypi_not_any_mcpseal_server(tmp_path):
    called = {}

    def ok_request(method, url, headers, body):
        called["url"] = url
        return HttpResponse(status=200, text=json.dumps({"info": {"version": "0.1.0"}}))

    run_doctor(str(tmp_path), request_fn=ok_request, check_updates=True, **paths(tmp_path))
    assert called["url"] == "https://pypi.org/pypi/mcpseal/json"
