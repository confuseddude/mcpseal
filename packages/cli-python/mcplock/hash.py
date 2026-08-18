# build-bible.md Part 2.1 / 2.2: the pinned hash covers exactly
# {name, description, inputSchema} - nothing else. Extra fields on the input
# (version strings, timestamps, etc.) must never leak into the hash.
import hashlib
from typing import TypedDict

from mcplock.canonical_json import canonicalize


class McpTool(TypedDict):
    name: str
    description: str
    inputSchema: dict


# Strictly extracts only the three hashed fields and validates their types
# before hashing, so a malformed tool object raises instead of silently
# producing a hash that looks valid (fail closed - CLAUDE.md invariant 1).
def hash_tool(tool: dict) -> str:
    name = tool.get("name")
    description = tool.get("description")
    input_schema = tool.get("inputSchema")

    if not isinstance(name, str):
        raise ValueError("hash_tool: tool['name'] must be a string")
    if not isinstance(description, str):
        raise ValueError("hash_tool: tool['description'] must be a string")
    if not isinstance(input_schema, dict):
        raise ValueError("hash_tool: tool['inputSchema'] must be an object")

    canonical_object = {"name": name, "description": description, "inputSchema": input_schema}
    canonical_bytes = canonicalize(canonical_object).encode("utf-8")
    hex_digest = hashlib.sha256(canonical_bytes).hexdigest()
    return f"sha256:{hex_digest}"
