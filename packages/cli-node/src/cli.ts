#!/usr/bin/env node
// build-bible.md Part 3.2: the command surface. Track A ("wedge
// completion"): every command's failure output now goes through
// events.ts's classifyThrown()/describeDriftReason()/describePolicyOutcome()
// so a developer gets diagnosis + consequence + remediation instead of a
// raw exception message, without changing any underlying security
// decision or the exact text of existing thrown errors (tests assert on
// those substrings).
import path from "node:path";
import { readLockfile } from "@mcplock/cli-core";
import { init } from "./init.js";
import { runProxy } from "./proxy.js";
import { install, uninstall } from "./install.js";
import { appendEvent, readEvents, recentBlocks } from "./event-log.js";
import { scan } from "./scan.js";
import { setToolStatus } from "./manage.js";
import { diffDrifted, formatDiff } from "./diff.js";
import { login, API_KEY_ACCOUNT } from "./login.js";
import { shipEventsBestEffort } from "./ship-events.js";
import { readConfig, isLoggedIn, clearConfig } from "./config.js";
import { pullAndApplyPolicy } from "./policy-sync.js";
import { getSecret, deleteSecret } from "./keychain.js";
import { buildStatusReport, formatStatusReport } from "./status.js";
import { runDoctor, formatDoctorReport } from "./doctor.js";
import { classifyThrown, describeDriftReason, describePolicyOutcome, formatEventBlock } from "./events.js";

const PRIVATE_KEY_ACCOUNT = "machine-private-key";

// `--json` is accepted anywhere in the argument list (after the command)
// for status/doctor/scan, per Track A's CI/scripting requirement. Every
// other positional argument keeps its existing meaning and order.
function extractJsonFlag(args: string[]): { json: boolean; rest: string[] } {
  const json = args.includes("--json");
  return { json, rest: args.filter((a) => a !== "--json") };
}

function printClassifiedError(err: unknown): void {
  const classified = classifyThrown(err);
  console.error(formatEventBlock(classified));
}

async function main(): Promise<void> {
  const [, , command, ...rawRest] = process.argv;
  const { json, rest } = extractJsonFlag(rawRest);

  switch (command) {
    case "init": {
      const projectDir = rest[0] ?? process.cwd();
      const result = await init({ projectDir });
      console.log(
        `mcplock init: wrote ${result.lockfilePath} (${result.serverCount} server(s), ${result.toolCount} tool(s) approved)`
      );
      return;
    }
    case "proxy": {
      // Judgment call (Tasks.md 2.2 Change Log): Part 3.2 shows `mcplock
      // proxy <server>` but doesn't specify how the proxy learns which
      // lockfile entry to check against when it only receives the launch
      // command. Syntax here: `mcplock proxy <serverName> <command> [args...]`
      // — `install` (step 2.4) will be the thing that rewrites client
      // configs to invoke it this way, embedding the lockfile's server key.
      const [serverName, command_, ...serverArgs] = rest;
      if (!serverName || !command_) {
        console.error("Usage: mcplock proxy <serverName> <command> [args...]");
        process.exitCode = 1;
        return;
      }

      // Fail closed (CLAUDE.md invariant 1): if the lockfile can't be read,
      // refuse to start rather than proxying traffic unchecked.
      const lockfilePath = path.join(process.cwd(), ".mcp-lock.json");
      let lockfile;
      try {
        lockfile = readLockfile(lockfilePath);
      } catch (err) {
        printClassifiedError(err);
        process.exitCode = 1;
        return;
      }

      const handle = runProxy({
        server: { command: command_, args: serverArgs },
        serverName,
        lockfile,
        input: process.stdin,
        output: process.stdout,
        onDecision: (toolName, result) => {
          if (result.decision !== "block") return;
          const desc = describeDriftReason(result.reason);
          console.error(
            formatEventBlock(desc, {
              server: serverName,
              tool: toolName,
              expected: result.oldHash,
              observed: result.newHash,
              ...(result.reason === "blocked_drift"
                ? { "old description": result.oldDescription, "new description": result.newDescription }
                : {}),
            })
          );
          appendEvent({
            type: result.reason,
            server: serverName,
            tool: toolName,
            observedHash: result.newHash,
            expectedHash: result.oldHash,
            oldDescription: result.oldDescription,
            newDescription: result.newDescription,
          });
          // Opt-in only (CLAUDE.md invariant 2): shipEvents() checks
          // isLoggedIn() first and is a total no-op — zero network calls —
          // if the user never ran `mcplock login`. Fire-and-forget so a
          // shipping failure or slow network never delays the block itself,
          // which has already happened by this point.
          shipEventsBestEffort();
        },
      });
      await handle.closed;
      return;
    }
    case "install": {
      const projectDir = rest[0] ?? process.cwd();
      const result = install(projectDir);
      console.log(`mcplock install: rewrote ${result.configPath} (${result.serverCount} server(s)), backup at ${result.backupPath}`);
      return;
    }
    case "uninstall": {
      const projectDir = rest[0] ?? process.cwd();
      const result = uninstall(projectDir);
      console.log(`mcplock uninstall: restored ${result.configPath} from backup`);
      return;
    }
    case "scan": {
      const projectDir = rest[0] ?? process.cwd();
      const decisions = await scan(projectDir);
      let anyBlocked = false;
      if (json) {
        const rows = decisions.map((d) => {
          const desc = describeDriftReason(d.result.reason);
          if (d.result.decision === "block") anyBlocked = true;
          return {
            server: d.serverName,
            tool: d.toolName,
            decision: d.result.decision,
            reason: d.result.reason,
            code: desc.code,
            severity: desc.severity,
          };
        });
        console.log(JSON.stringify({ decisions: rows, blocked: anyBlocked }, null, 2));
      } else {
        for (const d of decisions) {
          const desc = describeDriftReason(d.result.reason);
          const label = d.result.decision === "block" ? "BLOCK" : "OK   ";
          console.log(`${label} ${d.serverName}/${d.toolName} (${d.result.reason})`);
          if (d.result.decision === "block") {
            anyBlocked = true;
            if (desc.remediation[0]) console.log(`      next: ${desc.remediation[0]}`);
          }
        }
      }
      // CI-friendly (Part 3.2): non-zero exit specifically signals drift/blocks.
      process.exitCode = anyBlocked ? 1 : 0;
      return;
    }
    case "approve":
    case "deny": {
      const [serverName, toolName] = rest;
      if (!serverName || !toolName) {
        console.error(`Usage: mcplock ${command} <serverName> <toolName>`);
        process.exitCode = 1;
        return;
      }
      const status = command === "approve" ? "approved" : "denied";
      const result = await setToolStatus(process.cwd(), serverName, toolName, status);
      // Approve/deny only ever change the LOCAL lockfile (CLAUDE.md: never
      // hardcode plan/policy logic client-side) — say so explicitly so this
      // is never confused with organization-wide policy, which only an
      // admin can push via the Control Plane and `mcplock policy-pull`.
      console.log(
        `mcplock ${command}: ${result.serverName}/${result.toolName} is now "${result.status}" (${result.hash}) — local lockfile only, not organization policy`
      );
      return;
    }
    case "diff": {
      const projectDir = rest[0] ?? process.cwd();
      const diffs = await diffDrifted(projectDir);
      if (diffs.length === 0) {
        console.log("mcplock diff: no drifted tools.");
        return;
      }
      for (const d of diffs) {
        console.log(formatDiff(d));
        console.log("  next:");
        console.log(`    mcplock approve ${d.serverName} ${d.toolName}   # only after reviewing the change above`);
        console.log(`    mcplock deny ${d.serverName} ${d.toolName}`);
        console.log("");
      }
      return;
    }
    case "status": {
      const report = buildStatusReport(rest[0] ?? process.cwd());
      if (json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatStatusReport(report));
      }
      return;
    }
    case "doctor": {
      const report = await runDoctor(rest[0] ?? process.cwd());
      if (json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatDoctorReport(report));
      }
      // Only local-health failures affect the exit code — Control Plane
      // unreachability is never a doctor failure (offline-first: Part 13).
      process.exitCode = report.allLocalOk ? 0 : 1;
      return;
    }
    case "login": {
      if (isLoggedIn()) {
        console.log("mcplock login: already logged in. Run `mcplock logout` first to switch workspaces.");
        return;
      }
      try {
        const result = await login({
          onWaitingForApproval: (userCode) => {
            console.log(`mcplock login: go approve this device — user code: ${userCode}`);
            console.log("mcplock login: waiting for approval...");
          },
        });
        console.log(`mcplock login: connected to workspace ${result.workspaceId} (machine ${result.machineId})`);
      } catch (err) {
        printClassifiedError(err);
        process.exitCode = 1;
      }
      return;
    }
    case "logout": {
      // Reverses login: clears the non-secret config AND both keychain
      // secrets (the workspace API key and the machine's ed25519 private
      // key). A fresh `mcplock login` afterward creates a brand-new
      // machine identity rather than reusing a possibly-compromised one.
      clearConfig();
      deleteSecret(API_KEY_ACCOUNT);
      deleteSecret(PRIVATE_KEY_ACCOUNT);
      console.log("mcplock logout: cleared workspace connection and local credentials. Local enforcement is unaffected.");
      return;
    }
    case "policy-pull": {
      // build-bible.md Part 8.1 (Milestone 6 addition — see build-bible.md
      // Change Log). Fail closed on every rejection path: never touches
      // .mcp-lock.json unless the signature verifies against the pinned
      // org key AND the version is newer than what's already applied.
      const apiKeyToken = getSecret(API_KEY_ACCOUNT);
      const result = await pullAndApplyPolicy({ apiKeyToken: apiKeyToken ?? undefined });
      const desc = describePolicyOutcome(result.outcome);
      const isRejection = result.outcome.startsWith("rejected") || result.outcome === "skipped-no-pinned-key";
      const extra =
        result.outcome === "applied"
          ? { version: String(result.version) }
          : result.outcome === "no-newer-version"
            ? { "current version": String(result.currentVersion) }
            : result.outcome === "rejected-network-error"
              ? { detail: result.message }
              : undefined;
      const line = formatEventBlock(desc, extra);
      if (isRejection) {
        console.error(line);
        process.exitCode = 1;
      } else {
        console.log(line);
      }
      return;
    }
    default: {
      console.error(
        `Unknown or missing command: ${command ?? "(none)"}\nUsage: mcplock init|install|uninstall|status|doctor|scan|diff|login|logout|policy-pull [projectDir] [--json] | mcplock proxy <serverName> <command> [args...] | mcplock approve|deny <serverName> <toolName>`
      );
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  printClassifiedError(err);
  process.exitCode = 1;
});
