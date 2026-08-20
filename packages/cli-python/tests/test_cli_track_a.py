# Track A: exercises cli.main() directly (argv-in, exit-code-out) rather
# than a subprocess, mirroring the Node side's real-binary rigor closely
# enough for a pure-stdlib CLI: main() IS what the installed console
# script calls (mcpseal.cli:entrypoint just wraps main() with sys.exit).
import json
import os
import subprocess
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


def test_status_and_doctor_honor_an_explicit_project_dir_not_just_cwd(tmp_path_factory, capsys):
    # Regression: status/doctor previously always used os.getcwd(),
    # silently ignoring the positional [projectDir] argument every other
    # command respects. Deliberately does NOT chdir here (unlike the
    # `project` fixture) so this can't pass by accident.
    other_cwd = tmp_path_factory.mktemp("elsewhere")
    real_project = tmp_path_factory.mktemp("real-project")
    (real_project / ".mcp.json").write_text(json.dumps({"mcpServers": {"stub": {"command": PY, "args": [STUB_SERVER]}}}), encoding="utf-8")
    main(["init", str(real_project)])
    capsys.readouterr()
    (real_project / ".mcp.json.mcpseal-backup").write_text("{}", encoding="utf-8")

    os.chdir(other_cwd)
    try:
        status_code = main(["status", str(real_project), "--json"])
        status_out = json.loads(capsys.readouterr().out)
        assert status_code == 0
        assert status_out["local"]["lockfilePresent"] is True

        doctor_code = main(["doctor", str(real_project)])
        doctor_out = capsys.readouterr().out
        assert doctor_code == 0
        assert "healthy" in doctor_out
    finally:
        os.chdir(str(real_project.parent))


def test_doctor_check_updates_flag_makes_a_real_pypi_call_and_plain_doctor_does_not(project, capsys):
    # Real, non-mocked network behavior: plain `doctor` must show no
    # "update" line at all; `--check-updates` must actually reach PyPI
    # (mcpseal isn't published yet, so this legitimately gets a 404 --
    # the point is it tries, and degrades gracefully either way).
    main(["doctor", project])
    plain_out = capsys.readouterr().out
    assert "CLI version" not in plain_out

    code = main(["doctor", project, "--check-updates"])
    out = capsys.readouterr().out
    assert code in (0, 1)
    assert "CLI version" in out


def test_entrypoint_survives_a_legacy_non_utf8_console(project):
    # Real bug found via an actual installed-binary run on Windows:
    # doctor's formatter uses ✔/⚠ (shipped since Track A), and Python's
    # stdout defaults to the console's legacy codepage (cp1252 on many
    # Windows setups), which can't encode them -- printing crashed with
    # UnicodeEncodeError instead of ever showing the report, and got
    # silently misreported as a generic UNKNOWN_ERROR by the top-level
    # error boundary. `main()` called directly (as every other test in
    # this file does) can't catch this -- pytest's capsys replaces
    # sys.stdout with its own object, bypassing real console encoding
    # entirely. Only a real subprocess through the actual entrypoint(),
    # with the legacy encoding forced, reproduces it.
    package_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # packages/cli-python
    result = subprocess.run(
        [sys.executable, "-m", "mcpseal.cli", "doctor", project],
        cwd=package_root,  # so `mcpseal` resolves via `python -m`'s cwd-on-sys.path, without needing it pip-installed
        capture_output=True,
        text=True,
        encoding="cp1252",
        env={**os.environ, "PYTHONIOENCODING": "", "PYTHONUTF8": "0"},
    )
    assert "UnicodeEncodeError" not in result.stderr
    assert "UNKNOWN_ERROR" not in result.stdout
    assert "MCPSEAL DOCTOR" in result.stdout


def test_login_against_unreachable_control_plane_shows_friendly_message_not_unknown_error(project, capsys):
    # Real bug found via an actual isolated-install test of the published
    # package: `mcpseal login` against an unreachable Control Plane -- the
    # realistic first thing a brand new user tries -- showed a bare
    # UNKNOWN_ERROR because (a) urllib's connection-failure message didn't
    # match any classifier rule, and (b) cli.py's login handler only
    # caught LoginError, not the real exception type a network failure
    # actually raises (urllib.error.URLError), so main() didn't even
    # return cleanly. Uses a real, guaranteed-unreachable port, not a
    # mocked request function.
    os.environ["MCPSEAL_INGEST_URL"] = "http://127.0.0.1:1"
    try:
        code = main(["login"])
    finally:
        del os.environ["MCPSEAL_INGEST_URL"]
    err = capsys.readouterr().err
    assert code == 1
    assert "AUTH_SERVER_UNREACHABLE" in err
    assert "UNKNOWN_ERROR" not in err
    assert "Local enforcement is completely unaffected" in err


@pytest.mark.parametrize("flag", ["help", "--help", "-h"])
def test_help_shows_real_command_list_and_exits_0(flag, capsys):
    # Real gap found via manual testing right after the first public
    # publish: `--help` (the single most instinctive thing any developer
    # types first) used to fall through to the "unknown command" path,
    # exiting 1 and telling the user they'd done something wrong.
    code = main([flag])
    out = capsys.readouterr().out
    assert code == 0
    assert "Unknown command" not in out
    assert "mcpseal <command>" in out
    assert "doctor" in out
    assert "login" in out


def test_unknown_command_points_at_mcpseal_help(capsys):
    code = main(["definitely-not-a-real-command"])
    err = capsys.readouterr().err
    assert code == 1
    assert "Unknown command" in err
    assert "mcpseal help" in err
