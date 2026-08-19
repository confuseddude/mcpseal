# Track A: exercises cli.main() directly (argv-in, exit-code-out) rather
# than a subprocess, mirroring the Node side's real-binary rigor closely
# enough for a pure-stdlib CLI: main() IS what the installed console
# script calls (mcpseal.cli:entrypoint just wraps main() with sys.exit).
import json
import os
import sys

import pytest

from mcpseal.cli import main

STUB_SERVER = os.path.join(os.path.dirname(__file__), "test_fixtures", "stub_server.py")
PY = sys.executable


@pytest.fixture
def project(tmp_path, monkeypatch):
    (tmp_path / ".mcp.json").write_text(json.dumps({"mcpServers": {"stub": {"command": PY, "args": [STUB_SERVER]}}}), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    yield str(tmp_path)


def test_status_exits_0_even_with_no_lockfile(project, capsys):
    code = main(["status", project])
    out = capsys.readouterr().out
    assert code == 0
    assert "LOCAL HEALTH" in out
    assert "CONTROL PLANE" in out
    assert "mcpseal init" in out


def test_status_json_is_valid_and_shaped(project, capsys):
    code = main(["status", project, "--json"])
    out = capsys.readouterr().out
    assert code == 0
    parsed = json.loads(out)
    assert "local" in parsed
    assert "connection" in parsed
    assert "lockfilePresent" in parsed["local"]


def test_doctor_exits_nonzero_when_local_health_has_failures(project, capsys):
    code = main(["doctor", project])
    out = capsys.readouterr().out
    assert code != 0
    assert "MCPSEAL DOCTOR" in out
    assert "mcpseal init" in out


def test_doctor_exits_0_once_init_and_install_done(project, capsys):
    assert main(["init", project]) == 0
    capsys.readouterr()
    with open(os.path.join(project, ".mcp.json.mcpseal-backup"), "w", encoding="utf-8") as f:
        f.write("{}")
    code = main(["doctor", project])
    out = capsys.readouterr().out
    assert code == 0
    assert "healthy" in out


def test_doctor_json_has_checks_array(project, capsys):
    code = main(["doctor", project, "--json"])
    out = capsys.readouterr().out
    parsed = json.loads(out)
    assert isinstance(parsed["checks"], list)
    assert len(parsed["checks"]) > 0
    assert isinstance(parsed["allLocalOk"], bool)


def test_scan_json_matches_plain_exit_code(project, capsys):
    main(["init", project])
    capsys.readouterr()
    plain_code = main(["scan", project])
    capsys.readouterr()
    json_code = main(["scan", project, "--json"])
    out = capsys.readouterr().out
    assert plain_code == 0
    assert json_code == 0
    parsed = json.loads(out)
    assert parsed["blocked"] is False
    assert isinstance(parsed["decisions"], list)


def test_logout_is_idempotent_and_never_logged_in(project, capsys):
    code = main(["logout"])
    out = capsys.readouterr().out
    assert code == 0
    assert "cleared" in out


def test_proxy_with_no_lockfile_shows_remediation_not_a_raw_stack_trace(project, capsys):
    code = main(["proxy", "stub", PY, STUB_SERVER])
    err = capsys.readouterr().err
    assert code == 1
    assert "LOCKFILE_NOT_FOUND" in err
    assert "mcpseal init" in err
    assert "Traceback" not in err


def test_approve_on_unconfigured_server_shows_remediation(project, capsys):
    main(["init", project])
    capsys.readouterr()
    code = main(["approve", "does-not-exist", "some-tool"])
    err = capsys.readouterr().err
    assert code == 1
    assert "SERVER_NOT_CONFIGURED" in err
    assert "Traceback" not in err
