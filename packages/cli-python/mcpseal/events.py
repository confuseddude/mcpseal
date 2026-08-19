# Mirrors packages/cli-node/src/events.ts. Track A ("wedge completion"): a
# single, coherent event taxonomy for everything mcpseal can report to a
# developer, so the CLI never surfaces a raw, unexplained error when it
# can instead give a diagnosis + consequence + remediation.
#
# Deliberately NOT a rewrite of any existing security logic — same
# discipline as the TS version:
# - drift.py's DriftReason values (the `reason` field of check_drift's
#   return dict) stay exactly as-is; this module only adds an explanation
#   layer on top.
# - policy_sync.py's Outcome union stays as-is.
# - Every existing raised message text is unchanged; classify_thrown()
#   pattern-matches on those same strings.
#
# Codes/severities are kept identical to events.ts's where the same
# condition exists in both languages — this is the basis for the Node/
# Python security-outcome parity Track A requires (not byte-identical
# human-readable text, but matching codes/severities/decisions).
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

Severity = str  # "critical" | "high" | "medium" | "low" | "info"


@dataclass
class EventDescription:
    code: str
    severity: Severity
    summary: str
    consequence: str
    remediation: list[str] = field(default_factory=list)
    retryable: bool = False
    requires_network: bool = False
    requires_approval: bool = False


# --- Drift/trust decisions (drift.py's DriftReason strings) ---
DRIFT_EVENTS: dict[str, EventDescription] = {
    "approved": EventDescription(
        code="TOOL_APPROVED",
        severity="info",
        summary="Tool definition matches the trusted baseline.",
        consequence="Forwarded to the client normally.",
    ),
    "blocked_denied": EventDescription(
        code="TOOL_DENIED",
        severity="high",
        summary="This tool's hash matches the lockfile, but it is explicitly denied.",
        consequence="Blocked — the tool call never reaches the client.",
        remediation=["mcpseal diff", "mcpseal approve <server> <tool>   # only if you intend to trust it now"],
        requires_approval=True,
    ),
    "blocked_quarantined": EventDescription(
        code="TOOL_QUARANTINED",
        severity="high",
        summary="This tool is quarantined pending explicit review.",
        consequence="Blocked — the tool call never reaches the client.",
        remediation=["mcpseal diff", "mcpseal approve <server> <tool>   # after you've reviewed it", "mcpseal deny <server> <tool>"],
        requires_approval=True,
    ),
    "blocked_drift": EventDescription(
        code="TOOL_CHANGED",
        severity="critical",
        summary="The tool's definition (description and/or input schema) differs from the trusted baseline — a rug pull.",
        consequence="Blocked — the tool call never reaches the client.",
        remediation=["mcpseal diff", "mcpseal approve <server> <tool>   # only after reviewing the change", "mcpseal deny <server> <tool>"],
        requires_approval=True,
    ),
    "blocked_unknown": EventDescription(
        code="TOOL_UNKNOWN",
        severity="medium",
        summary="This tool isn't in the lockfile at all, and the policy blocks unknown tools.",
        consequence="Blocked — the tool call never reaches the client.",
        remediation=["mcpseal scan", "mcpseal approve <server> <tool>   # to trust it going forward"],
        requires_approval=True,
    ),
    "allowed_unknown": EventDescription(
        code="TOOL_UNKNOWN_ALLOWED",
        severity="medium",
        summary="This tool isn't in the lockfile, but the policy allows unknown tools through.",
        consequence="Forwarded to the client — consider tightening onUnknownTool if this is unexpected.",
        remediation=["mcpseal scan", "mcpseal approve <server> <tool>   # to pin it explicitly"],
    ),
    "tool_removed": EventDescription(
        code="TOOL_REMOVED",
        severity="info",
        summary="A tool that was previously in the lockfile is no longer offered by the server.",
        consequence="Informational only — nothing to block, there's no live call to intercept.",
        remediation=["mcpseal scan   # confirms the current live tool set"],
    ),
    "blocked_error": EventDescription(
        code="INTERNAL_CHECK_ERROR",
        severity="critical",
        summary="An internal error occurred while checking this tool against the lockfile.",
        consequence="Blocked — fail-closed: an error in the trust check is never treated as a pass.",
        remediation=["mcpseal doctor", "mcpseal scan   # re-run to see if this reproduces"],
        retryable=True,
    ),
}


def describe_drift_reason(reason: str) -> EventDescription:
    return DRIFT_EVENTS[reason]


# --- Signed policy pull (policy_sync.py's Outcome) ---
POLICY_EVENTS: dict[str, EventDescription] = {
    "applied": EventDescription(
        code="POLICY_APPLIED",
        severity="info",
        summary="A newer, correctly-signed policy was verified and applied.",
        consequence=".mcp-lock.json was atomically replaced.",
    ),
    "no-newer-version": EventDescription(
        code="POLICY_UP_TO_DATE",
        severity="info",
        summary="The published policy version is not newer than what's already applied.",
        consequence="No change — this is a no-op, not an error.",
    ),
    "skipped-not-logged-in": EventDescription(
        code="POLICY_SKIPPED_NOT_LOGGED_IN",
        severity="info",
        summary="No workspace connection is configured.",
        consequence="Local enforcement continues unaffected — this only concerns organization-pushed policy.",
        remediation=["mcpseal login"],
    ),
    "skipped-no-pinned-key": EventDescription(
        code="POLICY_NO_PINNED_KEY",
        severity="high",
        summary="No org signing key is pinned for this workspace.",
        consequence="Fail-closed: no policy can be trusted without a pinned key to verify it against, so none was even requested.",
        remediation=["mcpseal login   # re-pins the org's signing key"],
    ),
    "skipped-no-policy-published": EventDescription(
        code="POLICY_NONE_PUBLISHED",
        severity="info",
        summary="The organization has not published a policy for this workspace yet.",
        consequence="No change to the local lockfile.",
        retryable=True,
        requires_network=True,
    ),
    "rejected-invalid-signature": EventDescription(
        code="POLICY_INVALID_SIGNATURE",
        severity="critical",
        summary="The policy's signature does not verify against the pinned org public key.",
        consequence="REJECTED — fail-closed. The last-known-good local lockfile remains active, byte-for-byte untouched.",
        remediation=[
            "Do not retry blindly — this can mean the update was tampered with in transit, or the org's signing key was rotated unexpectedly.",
            "Verify out-of-band with your organization admin, then `mcpseal login` again if a re-pin is genuinely expected.",
        ],
        requires_approval=True,
    ),
    "rejected-malformed-response": EventDescription(
        code="POLICY_MALFORMED_RESPONSE",
        severity="high",
        summary="The server's response was missing required fields or otherwise malformed.",
        consequence="REJECTED — the existing local lockfile remains active, untouched.",
        remediation=["mcpseal doctor", "mcpseal policy-pull   # retry — this can be a transient server-side issue"],
        retryable=True,
        requires_network=True,
    ),
    "rejected-network-error": EventDescription(
        code="POLICY_NETWORK_ERROR",
        severity="medium",
        summary="Could not reach the Control Plane to check for a policy update.",
        consequence="The existing local lockfile remains active — local enforcement is unaffected by Control Plane availability.",
        remediation=["mcpseal doctor", "mcpseal policy-pull   # retry once connectivity is restored"],
        retryable=True,
        requires_network=True,
    ),
}


def describe_policy_outcome(outcome: str) -> EventDescription:
    return POLICY_EVENTS[outcome]


# --- Generic error classification for existing raised message strings
# across config_discovery.py, install.py, manage.py, login.py,
# mcp_client.py. Matches on the SAME message text those modules already
# raise (unchanged).
@dataclass
class ClassifiedError(EventDescription):
    message: str = ""


@dataclass
class ClassifierRule:
    test: Callable[[str], bool]
    describe: EventDescription


RULES: list[ClassifierRule] = [
    ClassifierRule(
        test=lambda m: "read_lockfile:" in m and "could not read" in m,
        describe=EventDescription(
            code="LOCKFILE_NOT_FOUND",
            severity="high",
            summary="No .mcp-lock.json found in this project.",
            consequence="Fail-closed: the proxy refuses to start without a lockfile to check tools against.",
            remediation=["mcpseal init   # discovers your MCP servers and creates a lockfile"],
        ),
    ),
    ClassifierRule(
        test=lambda m: "read_lockfile:" in m and ("not valid JSON" in m or "missing required field" in m or "does not contain a JSON object" in m),
        describe=EventDescription(
            code="LOCKFILE_INVALID",
            severity="critical",
            summary="The lockfile exists but is malformed or corrupted.",
            consequence='Fail-closed: an unparseable lockfile is treated as untrusted, not as "nothing to check."',
            remediation=[
                "Inspect .mcp-lock.json for corruption (bad merge, manual edit, truncated write).",
                "Restore from git history if available, or re-run `mcpseal init` to regenerate it (this resets all approvals).",
            ],
        ),
    ),
    ClassifierRule(
        test=lambda m: m.startswith("discover_servers:") and "is not valid JSON" in m,
        describe=EventDescription(
            code="MCP_CONFIG_INVALID",
            severity="high",
            summary=".mcp.json exists but is not valid JSON.",
            consequence="mcpseal cannot discover which MCP servers to protect.",
            remediation=["Fix the JSON syntax error in .mcp.json (check for trailing commas, unmatched braces)."],
        ),
    ),
    ClassifierRule(
        test=lambda m: m.startswith("discover_servers:"),
        describe=EventDescription(
            code="MCP_CONFIG_INVALID",
            severity="high",
            summary=".mcp.json is missing a required field or has the wrong shape.",
            consequence="mcpseal cannot discover which MCP servers to protect.",
            remediation=['Check .mcp.json against Claude Code\'s mcpServers schema (each server needs at least a "command").'],
        ),
    ),
    ClassifierRule(
        test=lambda m: m.startswith("install:") and "no config found" in m,
        describe=EventDescription(
            code="MCP_CONFIG_NOT_FOUND",
            severity="high",
            summary="No .mcp.json found in this project.",
            consequence="There's nothing for `mcpseal install` to rewrite.",
            remediation=["mcpseal init   # creates the lockfile from your existing MCP config first"],
        ),
    ),
    ClassifierRule(
        test=lambda m: m.startswith("install:") and "already exists" in m,
        describe=EventDescription(
            code="ALREADY_INSTALLED",
            severity="info",
            summary="mcpseal already appears to be installed in this project (a backup config already exists).",
            consequence="No change made — install is refusing to overwrite an existing backup.",
            remediation=["mcpseal uninstall   # if you want to reset and reinstall"],
        ),
    ),
    ClassifierRule(
        test=lambda m: m.startswith("uninstall:") and "no backup found" in m,
        describe=EventDescription(
            code="NOT_INSTALLED",
            severity="info",
            summary="mcpseal does not appear to be installed in this project (no backup config found).",
            consequence="No change made.",
            remediation=["mcpseal install   # if you intended to install first"],
        ),
    ),
    ClassifierRule(
        test=lambda m: m.startswith("set_tool_status:") and "is not in this project" in m,
        describe=EventDescription(
            code="SERVER_NOT_CONFIGURED",
            severity="medium",
            summary="That server name isn't in this project's .mcp.json.",
            consequence="Nothing to approve/deny.",
            remediation=["mcpseal scan   # lists the currently-configured server names"],
        ),
    ),
    ClassifierRule(
        test=lambda m: m.startswith("set_tool_status:") and "was not found on server" in m,
        describe=EventDescription(
            code="TOOL_NOT_FOUND",
            severity="medium",
            summary="That tool name isn't in the server's current live tool list.",
            consequence="Nothing to approve/deny — approve/deny always re-fetch the live definition, they never trust a stale name.",
            remediation=["mcpseal scan   # lists the currently-live tool names for this server"],
        ),
    ),
    ClassifierRule(
        test=lambda m: "device authorization failed to start" in m or "device authorization poll failed" in m or "machine registration failed" in m,
        describe=EventDescription(
            code="AUTH_SERVER_ERROR",
            severity="medium",
            summary="The Control Plane rejected or failed to handle a login request.",
            consequence="Login did not complete. Local enforcement is completely unaffected.",
            remediation=["mcpseal doctor", "mcpseal login   # retry"],
            retryable=True,
            requires_network=True,
        ),
    ),
    ClassifierRule(
        test=lambda m: m == "login was denied",
        describe=EventDescription(
            code="AUTH_DENIED",
            severity="info",
            summary="The device login request was denied.",
            consequence="No workspace connection was made. Local enforcement is unaffected.",
            remediation=["mcpseal login   # try again if this was unintentional"],
            retryable=True,
            requires_network=True,
        ),
    ),
    ClassifierRule(
        test=lambda m: "login code expired" in m or m == "login timed out waiting for approval",
        describe=EventDescription(
            code="AUTH_EXPIRED",
            severity="info",
            summary="The device login code expired before it was approved.",
            consequence="No workspace connection was made. Local enforcement is unaffected.",
            remediation=["mcpseal login   # generates a fresh code"],
            retryable=True,
            requires_network=True,
        ),
    ),
    ClassifierRule(
        test=lambda m: "refusing to overwrite a previously pinned org signing key" in m,
        describe=EventDescription(
            code="AUTH_KEY_REPIN_REFUSED",
            severity="critical",
            summary="This login would pin a DIFFERENT org signing key than the one already trusted on this machine.",
            consequence="Fail-closed: refused. Nothing was changed — the previously pinned key and existing credentials remain in place.",
            remediation=[
                "This is either a compromised org, or you're intentionally switching workspaces.",
                "If intentional: `mcpseal logout` first, then `mcpseal login` again.",
                "If not expected: do not proceed — investigate with your organization admin.",
            ],
            requires_approval=True,
        ),
    ),
    ClassifierRule(
        test=lambda m: "server process exited" in m or "spawn" in m,
        describe=EventDescription(
            code="MCP_SERVER_UNAVAILABLE",
            severity="high",
            summary="The MCP server process could not be started or exited unexpectedly.",
            consequence="No tool list could be verified for this server.",
            remediation=["Confirm the server's command/args in .mcp.json are correct and runnable on their own.", "mcpseal doctor"],
            retryable=True,
        ),
    ),
    ClassifierRule(
        test=lambda m: "timed out after" in m,
        describe=EventDescription(
            code="MCP_TIMEOUT",
            severity="medium",
            summary="The MCP server did not respond in time.",
            consequence="No tool list could be verified for this server within the timeout.",
            remediation=["Retry — a slow server start (e.g. a cold dependency cache) can cause a one-off timeout.", "mcpseal doctor"],
            retryable=True,
        ),
    ),
]

FALLBACK = EventDescription(
    code="UNKNOWN_ERROR",
    severity="high",
    summary="An unexpected error occurred.",
    consequence="The operation did not complete.",
    remediation=["mcpseal doctor", "Re-run with --json for a machine-readable error if filing an issue."],
    retryable=True,
)


def classify_thrown(err: BaseException | str) -> ClassifiedError:
    message = str(err)
    for rule in RULES:
        if rule.test(message):
            d = rule.describe
            return ClassifiedError(
                code=d.code,
                severity=d.severity,
                summary=d.summary,
                consequence=d.consequence,
                remediation=list(d.remediation),
                retryable=d.retryable,
                requires_network=d.requires_network,
                requires_approval=d.requires_approval,
                message=message,
            )
    return ClassifiedError(
        code=FALLBACK.code,
        severity=FALLBACK.severity,
        summary=FALLBACK.summary,
        consequence=FALLBACK.consequence,
        remediation=list(FALLBACK.remediation),
        retryable=FALLBACK.retryable,
        requires_network=FALLBACK.requires_network,
        requires_approval=FALLBACK.requires_approval,
        message=message,
    )


# --- Rendering helper (terminal output) ---
def format_event_block(desc: EventDescription, extra: dict[str, str | None] | None = None) -> str:
    lines = [f"[{desc.code}] ({desc.severity})", desc.summary]
    if extra:
        for k, v in extra.items():
            if v is not None:
                lines.append(f"  {k}: {v}")
    lines.append(f"  consequence: {desc.consequence}")
    if desc.remediation:
        lines.append("  next:")
        for cmd in desc.remediation:
            lines.append(f"    {cmd}")
    return "\n".join(lines)
