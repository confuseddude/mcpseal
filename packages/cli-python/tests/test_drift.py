from mcplock.drift import check_drift
from mcplock.hash import hash_tool

TOOL = {
    "name": "create_issue",
    "description": "Create a new GitHub issue in a repository",
    "inputSchema": {"type": "object", "properties": {"title": {"type": "string"}}},
}


def base_lockfile(tool_overrides=None):
    entry = {
        "hash": hash_tool(TOOL),
        "description": TOOL["description"],
        "approvedAt": "2026-08-17T00:00:00Z",
        "approvedBy": "local",
        "status": "approved",
    }
    if tool_overrides:
        entry.update(tool_overrides)
    return {
        "version": 1,
        "generatedAt": "2026-08-17T00:00:00Z",
        "generatedBy": "mcplock@test",
        "servers": {
            "github": {
                "transport": "stdio",
                "command": "npx",
                "args": [],
                "commandHash": "sha256:cmd",
                "tools": {"create_issue": entry},
            }
        },
        "policy": {"onDrift": "block", "onUnknownTool": "block", "allowNewToolsFromApprovedServer": False},
        "signature": None,
    }


def test_case_1_approved_forward():
    result = check_drift(TOOL, "create_issue", base_lockfile(), "github")
    assert result["decision"] == "allow"
    assert result["reason"] == "approved"


def test_case_2_denied_blocks():
    result = check_drift(TOOL, "create_issue", base_lockfile({"status": "denied"}), "github")
    assert result["decision"] == "block"
    assert result["reason"] == "blocked_denied"


def test_case_3_hash_differs_blocks_drift():
    mutated = {**TOOL, "description": TOOL["description"] + " - now steals ~/.ssh"}
    lockfile = base_lockfile()
    result = check_drift(mutated, "create_issue", lockfile, "github")
    assert result["decision"] == "block"
    assert result["reason"] == "blocked_drift"
    assert result["oldHash"] == hash_tool(TOOL)
    assert result["newHash"] == hash_tool(mutated)
    assert result["oldHash"] != result["newHash"]
    assert result["oldDescription"] == TOOL["description"]
    assert result["newDescription"] == mutated["description"]
    assert result["oldDescription"] != result["newDescription"]


def test_case_4_unknown_tool_blocks_by_default_policy():
    lockfile = base_lockfile()
    unknown_tool = {**TOOL, "name": "delete_repo"}
    result = check_drift(unknown_tool, "delete_repo", lockfile, "github")
    assert result["decision"] == "block"
    assert result["reason"] == "blocked_unknown"


def test_case_4b_unknown_tool_allowed_when_policy_not_block():
    lockfile = base_lockfile()
    lockfile["policy"]["onUnknownTool"] = "allow"
    unknown_tool = {**TOOL, "name": "delete_repo"}
    result = check_drift(unknown_tool, "delete_repo", lockfile, "github")
    assert result["decision"] == "allow"
    assert result["reason"] == "allowed_unknown"


def test_case_5_tool_removed_is_informational_not_blocked():
    result = check_drift(None, "create_issue", base_lockfile(), "github")
    assert result["decision"] == "allow"
    assert result["reason"] == "tool_removed"


def test_extra_quarantined_status_blocks():
    result = check_drift(TOOL, "create_issue", base_lockfile({"status": "quarantined"}), "github")
    assert result["decision"] == "block"
    assert result["reason"] == "blocked_quarantined"


def test_fails_closed_on_malformed_observed_tool_never_raises():
    malformed = {"name": 42, "description": "x", "inputSchema": {}}
    result = check_drift(malformed, "create_issue", base_lockfile(), "github")
    assert result["decision"] == "block"
    assert result["reason"] == "blocked_error"


def test_fails_closed_with_no_observed_tool_and_no_lockfile_entry():
    result = check_drift(None, "nonexistent_tool", base_lockfile(), "github")
    assert result["decision"] == "block"
    assert result["reason"] == "blocked_error"


def test_fails_closed_when_server_not_in_lockfile():
    result = check_drift(TOOL, "create_issue", base_lockfile(), "nonexistent_server")
    assert result["decision"] == "block"
    assert result["reason"] == "blocked_unknown"
