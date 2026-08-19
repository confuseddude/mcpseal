from mcplock.command_hash import hash_command


def test_same_command_args_same_hash():
    assert hash_command("node", ["a.js", "--flag"]) == hash_command("node", ["a.js", "--flag"])


def test_different_args_different_hash():
    assert hash_command("node", ["a.js"]) != hash_command("node", ["b.js"])


def test_hash_format():
    h = hash_command("node", [])
    assert h.startswith("sha256:")
    assert len(h) == len("sha256:") + 64
