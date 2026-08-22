# Security Policy

`mcpseal` is a security tool. If it fails to block something it should have blocked, that is a vulnerability in the thing people installed it for — please report it.

## Reporting a vulnerability

**Do not open a public issue for a security bug.**

Use GitHub's private reporting: [**Report a vulnerability**](https://github.com/confuseddude/mcpseal/security/advisories/new) (Security tab → Report a vulnerability). This is private to the maintainers until a fix is released.

Please include:

- What you did, and what `mcpseal` did instead of blocking
- Version (`mcpseal --version`), OS, and which MCP client
- A minimal reproduction if you have one — a stub MCP server that demonstrates the bypass is ideal
- Whether you have disclosed this anywhere else

You'll get an acknowledgement within **72 hours** and an assessment within **7 days**. This is currently maintained by one person, so those are honest targets rather than an SLA. If you don't hear back, please ping the advisory thread.

## What counts as a vulnerability

Highest severity — the tool's core promise failing:

- **A drifted tool definition that is not blocked.** Any way to change a tool's description or input schema after approval and have the proxy forward it.
- **A hash collision or canonicalization gap** — two materially different tool definitions producing the same hash, or a definition whose hash differs between the Node and Python implementations (they must agree; see `test-vectors/hash-fixtures.json`).
- **A policy signature bypass** — getting `mcpseal` to apply a pushed policy that is unsigned, or signed by a key other than the org key pinned at login.
- **Fail-open behavior.** Any error path in the proxy, hash verifier, or signature check that results in a tool call being forwarded instead of blocked. `mcpseal` is designed to fail closed everywhere; a crash that lets traffic through is a security bug, not just a stability bug.
- **Secret disclosure** — the workspace API key or machine private key ending up anywhere other than the OS keychain (a log line, a config file, an error message, a network request).
- **Tool-call contents leaving the machine.** Only tool-definition metadata and block decisions are ever transmitted, and only after explicit `mcpseal login`. Anything else is a privacy vulnerability.

Also in scope: a free-tier CLI making any network request before `mcpseal login` has been run.

## What is not a vulnerability

- A tool being blocked that you wanted allowed. That's the intended direction of failure — use `mcpseal manage` to approve it.
- Someone with write access to your `.mcp-lock.json` approving a malicious tool. The lockfile is trusted input, like `package-lock.json`; protect it with code review.
- An MCP server that was malicious from the very first `mcpseal init`. `mcpseal` pins what you approved and detects *change*; it does not judge whether the original definition was safe.
- Vulnerabilities in the MCP servers themselves, or in your MCP client.

## Supported versions

Only the latest published release receives security fixes. Given the current version numbers, please upgrade before reporting.

## Verifying what you installed

Every release is published from GitHub Actions via OIDC Trusted Publishing, with no long-lived credentials stored anywhere. Both artifacts carry build provenance tying them to a specific commit and CI run:

```bash
npm audit signatures        # verifies the npm SLSA provenance attestation
```

PyPI attestations (PEP 740) appear on the [project page](https://pypi.org/project/mcpseal/) and name the publishing repo (`confuseddude/mcpseal`) and workflow (`publish.yml`).

If you ever find a published `mcpseal` artifact **without** valid provenance, or with provenance naming a repo other than `confuseddude/mcpseal`, treat it as compromised and report it immediately.
