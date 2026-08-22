# Mirrors packages/cli-node/src/process-utils.ts's finding (Tasks.md 2.2
# verification notes): on Windows, spawning through a shell means the
# tracked PID is the shell wrapper's, not the real server process's, so a
# plain terminate()/kill() leaves the actual child running with its stdio
# pipes open. `taskkill /T` kills the whole process tree instead.
import subprocess
import sys

# Spawn MCP servers through a shell ONLY on Windows.
#
# On Windows the shell is required to resolve the .cmd/.bat shims that
# npm installs (`npx`, `npx.cmd`), and Popen joins the argument list into
# a command line via list2cmdline, so [command, *args] survives intact.
#
# On POSIX, `Popen([command, *args], shell=True)` does NOT do that: it
# runs `/bin/sh -c "<command>"` and demotes the remaining elements to
# $0/$1/..., so the server is spawned with NO arguments. A stdio server
# started that way never speaks JSON-RPC (e.g. bare `python` sits reading
# source from stdin), so the proxy blocks forever on its first response
# read. POSIX needs shell=False, where the list is exec'd directly.
USE_SHELL = sys.platform == "win32"


def kill_process_tree(proc: subprocess.Popen) -> None:
    if proc.pid is None:
        return
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/pid", str(proc.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
