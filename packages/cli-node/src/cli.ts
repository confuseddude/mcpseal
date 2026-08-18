#!/usr/bin/env node
// build-bible.md Part 3.2: the command surface. `init` (2.1) and `proxy`
// (2.2) exist so far — the rest (scan, install, uninstall, approve, deny,
// diff, login, status) come in later steps.
import path from "node:path";
import { readLockfile } from "@mcplock/cli-core";
import { init } from "./init.js";
import { runProxy } from "./proxy.js";
import { install, uninstall } from "./install.js";
import { appendEvent, readEvents, recentBlocks } from "./event-log.js";
import { scan } from "./scan.js";
import { setToolStatus } from "./manage.js";
import { diffDrifted, formatDiff } from "./diff.js";

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

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
      const lockfile = readLockfile(lockfilePath);

      const handle = runProxy({
        server: { command: command_, args: serverArgs },
        serverName,
        lockfile,
        input: process.stdin,
        output: process.stdout,
        onDecision: (toolName, result) => {
          if (result.decision !== "block") return;
          console.error(`mcplock: blocked tool "${toolName}" (${result.reason})`);
          if (result.reason === "blocked_drift") {
            console.error(`  old description: ${result.oldDescription}`);
            console.error(`  new description: ${result.newDescription}`);
          }
          appendEvent({
            type: result.reason,
            server: serverName,
            tool: toolName,
            observedHash: result.newHash,
            expectedHash: result.oldHash,
            oldDescription: result.oldDescription,
            newDescription: result.newDescription,
          });
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
      for (const d of decisions) {
        console.log(`${d.result.decision === "block" ? "BLOCK" : "OK   "} ${d.serverName}/${d.toolName} (${d.result.reason})`);
        if (d.result.decision === "block") anyBlocked = true;
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
      console.log(`mcplock ${command}: ${result.serverName}/${result.toolName} is now "${result.status}" (${result.hash})`);
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
      }
      return;
    }
    case "status": {
      const events = readEvents();
      const blocks = recentBlocks(events, 10);
      if (events.length === 0) {
        console.log("mcplock status: no events recorded yet on this machine.");
        return;
      }
      console.log(`mcplock status: ${events.length} event(s) recorded, ${blocks.length} recent block(s):`);
      for (const b of blocks) {
        console.log(`  [${b.ts}] ${b.type} — ${b.server}/${b.tool}`);
      }
      return;
    }
    default: {
      console.error(
        `Unknown or missing command: ${command ?? "(none)"}\nUsage: mcplock init|install|uninstall|status|scan|diff [projectDir] | mcplock proxy <serverName> <command> [args...] | mcplock approve|deny <serverName> <toolName>`
      );
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(`mcplock: fatal error: ${(err as Error).message}`);
  process.exitCode = 1;
});
