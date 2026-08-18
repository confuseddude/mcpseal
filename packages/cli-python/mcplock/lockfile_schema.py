# Matches build-bible.md Part 2.3 exactly.

from typing import Literal, TypedDict

ToolStatus = Literal["approved", "denied", "quarantined"]


class ToolEntry(TypedDict):
    hash: str
    # The tool's last-approved description text. Stored alongside the hash
    # (which is not reversible) so drift detection can show an actual
    # old-vs-new description diff (Part 2.4) rather than just two opaque
    # hashes.
    description: str
    approvedAt: str
    approvedBy: str
    status: ToolStatus


class ServerEntry(TypedDict):
    transport: str
    command: str
    args: list[str]
    commandHash: str
    tools: dict[str, ToolEntry]


class Policy(TypedDict):
    onDrift: str
    onUnknownTool: str
    allowNewToolsFromApprovedServer: bool


class Lockfile(TypedDict):
    version: int
    generatedAt: str
    generatedBy: str
    servers: dict[str, ServerEntry]
    policy: Policy
    signature: str | None
