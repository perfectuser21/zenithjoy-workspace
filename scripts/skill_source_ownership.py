#!/usr/bin/env python3
"""Reject tracked skill definitions in a consuming business repository."""
import subprocess
import sys


def violations(root="."):
    paths = subprocess.check_output(["git", "-C", str(root), "ls-files", "-z"]).split(b"\0")
    return [p.decode("utf-8", "surrogateescape") for p in paths if p and p.rsplit(b"/", 1)[-1].lower() == b"skill.md"]


if __name__ == "__main__":
    found = violations()
    if found:
        print("Skill definitions belong in perfectuser21/zenithjoy-skills; keep pinned references here.", file=sys.stderr)
        for path in found:
            print(repr(path), file=sys.stderr)
        sys.exit(1)
    print("Skill source ownership passed")
