#!/usr/bin/env python3
"""Generated business bootstrap; maintained in zenithjoy-skills/distribution."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time


# Every retry retains the same pinned object, private identity and host-key check.
FETCH_ATTEMPTS = 3
FETCH_TIMEOUT_SECONDS = 35
FETCH_RETRY_DELAYS = (1, 2)


def classify_fetch_error(stderr):
    message = stderr.lower()
    permanent = (
        'invalid format', 'error in libcrypto', 'incorrect passphrase',
        'repository not found', 'does not appear to be a git repository',
        'not our ref', "couldn't find remote ref", 'unadvertised object',
        'host key verification failed', 'remote host identification has changed',
    )
    if any(reason in message for reason in permanent):
        return 'permanent', False
    if 'permission denied (publickey)' in message:
        # The same deployed identity has succeeded and failed concurrently in CI.
        # A genuinely invalid identity still fails after this bounded budget.
        return 'ssh_publickey', True
    transient = (
        'connection timed out', 'connection timeout', 'connection reset',
        'connection refused', 'connection closed', 'could not resolve hostname',
        'kex_exchange_identification', 'remote end hung up', 'early eof',
        'rpc failed', 'temporary failure in name resolution',
    )
    if any(reason in message for reason in transient):
        return 'transport', True
    return 'permanent', False


def fetch_pinned_revision(source, remote, revision, env, key):
    command = ['git', '-C', str(source), 'fetch', '--quiet', '--depth=1', remote, revision]
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            result = subprocess.run(command, env=env, capture_output=True, text=True,
                                    timeout=FETCH_TIMEOUT_SECONDS)
            if result.returncode == 0:
                return
            original_error = result.stderr.strip() or f'git fetch exit {result.returncode}'
            category, retryable = classify_fetch_error(original_error)
        except subprocess.TimeoutExpired as error:
            partial = error.stderr or ''
            if isinstance(partial, bytes):
                partial = partial.decode('utf-8', errors='replace')
            original_error = partial.strip() or f'git fetch timed out after {FETCH_TIMEOUT_SECONDS}s'
            category, retryable = 'transport_timeout', True
        if retryable and attempt < FETCH_ATTEMPTS:
            delay = FETCH_RETRY_DELAYS[attempt - 1]
            print(f'skill source fetch attempt {attempt}/{FETCH_ATTEMPTS} failed '
                  f'({category}); retrying the same pinned identity/object in {delay}s', file=sys.stderr)
            time.sleep(delay)
            continue
        # Git/SSH errors normally contain only public diagnostics. Guard against
        # accidental credential echoes while preserving the original failure reason.
        for secret in [key, *key.replace('\r\n', '\n').splitlines()]:
            if secret.strip():
                original_error = original_error.replace(secret, '[REDACTED]')
        raise ValueError(f'skill source fetch failed after {attempt} attempt(s) '
                         f'({category}): {original_error}')


def write_identity(directory, key):
    keyfile = Path(directory) / "key"
    keyfile.write_bytes((key.replace("\r\n", "\n").rstrip() + "\n").encode("utf-8"))
    keyfile.chmod(0o600)
    return keyfile


def bootstrap(workspace, source, command, ref="HEAD", read_path=None):
    if command == "cat":
        lock = json.loads(subprocess.check_output(["git", "-C", str(workspace), "show",
                                                  f"{ref}:.skills-source.json"]))
    else:
        lock = json.loads((workspace / ".skills-source.json").read_text())
    if lock.get("repository") != "perfectuser21/zenithjoy-skills":
        raise ValueError("unexpected skill source repository")
    revision = lock.get("revision", "")
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("skill source must pin a complete revision")
    if not re.fullmatch(r"[0-9a-f]{64}", lock.get("loader_sha256", "")):
        raise ValueError("skill source must pin the loader checksum")
    actual = None
    if (source / ".git").exists():
        result = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"], capture_output=True, text=True)
        if result.returncode == 0:
            actual = result.stdout.strip()
    if command != "cat" and source != workspace / ".skills-source" and actual != revision:
        raise ValueError("explicit source revision does not match lock; refusing to change its checkout")
    object_present = (source / ".git").exists() and subprocess.run(
        ["git", "-C", str(source), "cat-file", "-e", revision + "^{commit}"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if not object_present:
        with tempfile.TemporaryDirectory(prefix="skill-source-auth-") as private:
            env = os.environ.copy()
            # Keep a read-only deploy key in a private temporary file, never in arguments/logs.
            key = env.pop("SKILLS_SOURCE_SSH_KEY", "")
            if not key.strip():
                raise ValueError('SKILLS_SOURCE_SSH_KEY is required for an uncached private skill source')
            keyfile = write_identity(private, key)
            hosts = Path(private) / "known_hosts"
            hosts.write_bytes(b"github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n")
            # No agent, alternate identity, credential helper or interactive fallback.
            env["GIT_SSH_COMMAND"] = (f'ssh -i "{keyfile}" -o IdentitiesOnly=yes '
                f'-o IdentityAgent=none -o BatchMode=yes -o ConnectTimeout=10 '
                f'-o ConnectionAttempts=1 -o ServerAliveInterval=10 -o ServerAliveCountMax=2 '
                f'-o StrictHostKeyChecking=yes -o UserKnownHostsFile="{hosts}"')
            remote = "git@github.com:perfectuser21/zenithjoy-skills.git"
            if not (source / ".git").exists():
                source.mkdir(parents=True, exist_ok=True)
                subprocess.run(["git", "init", "-q", str(source)], env=env, check=True)
            fetch_pinned_revision(source, remote, revision, env, key)
    if command == "cat":
        catalog = json.loads(subprocess.check_output(["git", "-C", str(source), "show",
                                                     f"{revision}:distribution/catalog.json"]))
        entry = next((e for e in catalog["profiles"][lock["profile"]]["files"]
                      if e["path"] == read_path), None)
        if entry is None:
            raise ValueError("path is not a distributed skill source: " + str(read_path))
        payload = subprocess.check_output(["git", "-C", str(source), "show", f"{revision}:{entry['source']}"])
        if hashlib.sha256(payload).hexdigest() != entry["sha256"]:
            raise ValueError("source checksum mismatch")
        sys.stdout.buffer.write(payload)
        return
    if actual != revision:
        # Distribution digests cover Git blob bytes, including on Windows runners.
        subprocess.run(["git", "-C", str(source), "-c", "core.autocrlf=false",
                        "checkout", "--quiet", "--detach", revision], check=True)
    loader = source / "distribution/skills_source.py"
    if hashlib.sha256(loader.read_bytes()).hexdigest() != lock["loader_sha256"]:
        raise ValueError("skill loader checksum mismatch")
    env = os.environ.copy()
    env.pop("SKILLS_SOURCE_SSH_KEY", None)
    subprocess.run([sys.executable, str(loader), command, "--workspace", str(workspace),
                    "--source", str(source)], check=True, env=env)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["install", "verify", "cat"])
    parser.add_argument("--workspace", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--source", type=Path)
    parser.add_argument("--ref", default="HEAD")
    parser.add_argument("--path")
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    source = args.source.resolve() if args.source else workspace / ".skills-source"
    try:
        bootstrap(workspace, source, args.command, args.ref, args.path)
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        parser.exit(1, str(error) + "\n")


if __name__ == "__main__":
    main()
