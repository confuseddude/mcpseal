# Canonicalization per build-bible.md Part 2.2: keys sorted lexicographically
# at every nesting level, no insignificant whitespace, UTF-8, no trailing
# newline. Never use json.dumps directly here — its default output doesn't
# guarantee key order. `canonicaljson` (used by the Matrix protocol's
# reference implementations, github.com/matrix-org/python-canonicaljson)
# implements RFC 8785 (JSON Canonicalization Scheme) and is the maintained
# library for this on the Python side, mirroring the TS package's use of
# `canonicalize` (see canonical-json.ts's header comment for why
# json-canonicalize was rejected on the TS side).
from canonicaljson import encode_canonical_json


def canonicalize(obj: object) -> str:
    return encode_canonical_json(obj).decode("utf-8")
