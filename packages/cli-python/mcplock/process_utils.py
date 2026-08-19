# Mirrors packages/cli-node/src/process-utils.ts's finding (Tasks.md 2.2
# verification notes): on Windows, spawning through a shell means the
# tracked PID is the shell wrapper's, not the real server process's, so a
# plain terminate()/kill() leaves the actual child running with its stdio
# pipes open. `taskkill /T` kills the whole process tree instead.
import subprocess
import sys


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
