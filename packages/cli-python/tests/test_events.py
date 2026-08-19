# Mirrors packages/cli-node/src/events.test.ts. Presentation-layer only —
# confirms every drift reason / policy outcome has a description and that
# classify_thrown() routes the actual message strings the rest of the
# codebase raises.
from mcplock.events import classify_thrown, describe_drift_reason, describe_policy_outcome, format_event_block

ALL_DRIFT_REASONS = [
    "approved",
    "blocked_denied",
    "blocked_quarantined",
    "blocked_drift",
    "blocked_unknown",
    "allowed_unknown",
    "tool_removed",
    "blocked_error",
]

ALL_POLICY_OUTCOMES = [
    "applied",
    "no-newer-version",
    "skipped-not-logged-in",
    "skipped-no-pinned-key",
    "skipped-no-policy-published",
    "rejected-invalid-signature",
    "rejected-malformed-response",
    "rejected-network-error",
]


def test_every_drift_reason_has_a_description():
    for reason in ALL_DRIFT_REASONS:
        desc = describe_drift_reason(reason)
        assert desc.code
        assert desc.summary
        assert desc.consequence
        assert desc.severity in ("critical", "high", "medium", "low", "info")


def test_blocked_drift_is_critical_and_requires_approval():
    desc = describe_drift_reason("blocked_drift")
    assert desc.severity == "critical"
    assert desc.requires_approval is True
    assert len(desc.remediation) > 0


def test_approved_and_tool_removed_are_informational():
    assert describe_drift_reason("approved").severity == "info"
    assert describe_drift_reason("tool_removed").severity == "info"


def test_every_policy_outcome_has_a_description():
    for outcome in ALL_POLICY_OUTCOMES:
        desc = describe_policy_outcome(outcome)
        assert desc.code
        assert desc.summary


def test_rejected_invalid_signature_is_critical_never_retryable():
    desc = describe_policy_outcome("rejected-invalid-signature")
    assert desc.severity == "critical"
    assert desc.retryable is False


def test_transient_rejections_are_retryable():
    assert describe_policy_outcome("rejected-network-error").retryable is True
    assert describe_policy_outcome("rejected-malformed-response").retryable is True


def test_classify_thrown_routes_lockfile_not_found():
    c = classify_thrown(ValueError("read_lockfile: could not read /x/.mcp-lock.json: ENOENT"))
    assert c.code == "LOCKFILE_NOT_FOUND"
    assert "mcplock init   # discovers your MCP servers and creates a lockfile" in c.remediation


def test_classify_thrown_routes_lockfile_invalid():
    c = classify_thrown(ValueError("read_lockfile: /x/.mcp-lock.json is not valid JSON: bad token"))
    assert c.code == "LOCKFILE_INVALID"
    assert c.severity == "critical"


def test_classify_thrown_routes_mcp_config_invalid():
    c = classify_thrown(ValueError("discover_servers: /x/.mcp.json is not valid JSON: bad"))
    assert c.code == "MCP_CONFIG_INVALID"


def test_classify_thrown_routes_install_no_config():
    c = classify_thrown(ValueError("install: no config found at /x/.mcp.json"))
    assert c.code == "MCP_CONFIG_NOT_FOUND"


def test_classify_thrown_routes_install_already_exists():
    c = classify_thrown(ValueError("install: /x/.mcp.json.mcplock-backup already exists — mcplock appears to already be installed here"))
    assert c.code == "ALREADY_INSTALLED"


def test_classify_thrown_routes_uninstall_no_backup():
    c = classify_thrown(ValueError("uninstall: no backup found at /x/.mcp.json.mcplock-backup — mcplock does not appear to be installed here"))
    assert c.code == "NOT_INSTALLED"


def test_classify_thrown_routes_server_not_configured():
    c = classify_thrown(ValueError('set_tool_status: server "x" is not in this project\'s .mcp.json'))
    assert c.code == "SERVER_NOT_CONFIGURED"


def test_classify_thrown_routes_tool_not_found():
    c = classify_thrown(ValueError('set_tool_status: tool "x" was not found on server "y"\'s current tool list'))
    assert c.code == "TOOL_NOT_FOUND"


def test_classify_thrown_routes_login_denied():
    c = classify_thrown(Exception("login was denied"))
    assert c.code == "AUTH_DENIED"


def test_classify_thrown_routes_login_expired():
    c = classify_thrown(Exception("login code expired before it was approved"))
    assert c.code == "AUTH_EXPIRED"
    c2 = classify_thrown(Exception("login timed out waiting for approval"))
    assert c2.code == "AUTH_EXPIRED"


def test_classify_thrown_routes_repin_refused_as_critical():
    c = classify_thrown(
        Exception(
            "refusing to overwrite a previously pinned org signing key with a different one — run `mcplock logout` first if this is intentional"
        )
    )
    assert c.code == "AUTH_KEY_REPIN_REFUSED"
    assert c.severity == "critical"
    assert c.requires_approval is True


def test_classify_thrown_routes_auth_server_errors():
    assert classify_thrown(Exception("device authorization failed to start: HTTP 500")).code == "AUTH_SERVER_ERROR"
    assert classify_thrown(Exception("machine registration failed: HTTP 403")).code == "AUTH_SERVER_ERROR"


def test_classify_thrown_falls_back_gracefully():
    c = classify_thrown(Exception("something totally novel no rule matches"))
    assert c.code == "UNKNOWN_ERROR"
    assert "novel" in c.message


def test_classify_thrown_handles_plain_string():
    c = classify_thrown("a plain string")
    assert c.code == "UNKNOWN_ERROR"
    assert c.message == "a plain string"


def test_format_event_block_includes_expected_sections():
    desc = describe_drift_reason("blocked_drift")
    text = format_event_block(desc, {"server": "github", "tool": "create_issue"})
    assert "TOOL_CHANGED" in text
    assert "critical" in text
    assert "server: github" in text
    assert "consequence:" in text
    assert "next:" in text


def test_format_event_block_omits_none_extras():
    desc = describe_drift_reason("approved")
    text = format_event_block(desc, {"server": "s", "missing": None})
    assert "missing" not in text


def test_format_event_block_never_leaks_secret_looking_strings():
    import re

    for reason in ALL_DRIFT_REASONS:
        text = format_event_block(describe_drift_reason(reason))
        assert not re.search(r"api[_-]?key|secret|password|bearer\s", text.lower())
