# Mirrors packages/cli-node/src/command-hash.ts. build-bible.md Part 2.3
# says commandHash "pins the command+args that launch the server" but
# doesn't specify the exact hash input (Tasks.md Change Log, 2026-08-17):
# sha256 of the canonical JSON of {command, args}, reusing the same
# canonicalization machinery as tool hashing for consistency.
import hashlib

from mcpseal.canonical_json import canonicalize


def hash_command(command: str, args: list[str]) -> str:
    canonical_bytes = canonicalize({"command": command, "args": args}).encode("utf-8")
    hex_digest = hashlib.sha256(canonical_bytes).hexdigest()
    return f"sha256:{hex_digest}"
