"""Single source of truth for the CLI's own version string.

Mirrors packages/cli-node/src/version.ts. Before this existed the version
was hand-copied into event_log.py, login.py, mcp_client.py and
lockfile.py, and every release meant grepping for the old number and
editing each site by hand. tests/test_version_consistency.py now fails
the build if this constant and pyproject.toml ever disagree, or if
cli-node's package.json drifts from either — so a half-finished version
bump cannot ship.
"""

VERSION = "0.1.3"

# What goes in a lockfile's `generatedBy` field and the MCP handshake's
# clientInfo.version — kept here so the format is defined once.
GENERATED_BY = f"mcpseal@{VERSION}"
