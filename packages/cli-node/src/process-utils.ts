// Found via real end-to-end testing (Tasks.md 2.2 verification notes), not
// spec-driven: on Windows, spawning with `shell: true` runs the command
// through cmd.exe, so child.pid is cmd.exe's PID — child.kill() only kills
// the shell wrapper, leaving the actual server process (e.g. a `npx`-spawned
// node process) running and its stdio pipes open. `taskkill /T` kills the
// whole process tree instead.
import { spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill();
  }
}
