# Minimal injectable HTTP client (stdlib only, no new network-library
# dependency for the one and only network path in this CLI — CLAUDE.md
# invariant 2). Mirrors the role of cli-node's injectable `fetchImpl`
# parameter: production code calls request() with no override; tests pass
# a fake callable instead so no real network call is ever made in a test.
from __future__ import annotations

import json as json_module
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable


@dataclass
class HttpResponse:
    status: int
    text: str

    def json(self) -> object:
        return json_module.loads(self.text)

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300


HttpRequestFn = Callable[[str, str, dict, str | None], HttpResponse]


# Raises on a genuine network failure (connection refused, DNS failure,
# timeout) so callers can distinguish "no network" from "server returned
# an error status" (which comes back as a normal HttpResponse with a
# non-2xx status, just like fetch() does in the TS version — never raises
# on 4xx/5xx, only real transport failures do).
def request(method: str, url: str, headers: dict | None = None, body: str | None = None, timeout: float = 15.0) -> HttpResponse:
    data = body.encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return HttpResponse(status=resp.status, text=resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        text = err.read().decode("utf-8") if err.fp else ""
        return HttpResponse(status=err.code, text=text)
