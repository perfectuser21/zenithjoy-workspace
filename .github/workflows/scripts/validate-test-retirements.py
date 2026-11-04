#!/usr/bin/env python3
"""Immutable sprint contracts may only retire through a content-anchored deletion."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

DIMENSIONS = {"current_value", "active_status", "real_effect", "test_and_blocking",
              "duplication_and_obsolescence", "runtime_and_maintenance_cost",
              "retirement_and_dependencies"}


def git(*args, binary=False):
    return subprocess.check_output(["git", *args], text=not binary, stderr=subprocess.PIPE)


def normalized(value):
    if not isinstance(value, str) or not value or any(c in value for c in "\\\n\r\t"):
        raise ValueError("retirement path must be a normalized repository path")
    p = PurePosixPath(value)
    if p.is_absolute() or ".." in p.parts or str(p) != value:
        raise ValueError("retirement path escapes or is not normalized")
    return value


def contract(path):
    if not re.match(r"^sprints/[^/]+/tests/", path):
        return False
    name = PurePosixPath(path).name
    return bool(re.search(r"\.(?:test|spec)\.(?:[cm]?[jt]sx?|sh|bash|zsh|py|ps1)$", name)
                or re.match(r"test_.+\.(?:py|sh)$", name)
                or name.endswith("-smoke-contract.sh"))


def tracked_file(root, path):
    normalized(path)
    p = root / path
    if not p.is_file() or not p.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"missing current replacement/evidence file: {path}")
    git("ls-files", "--error-unmatch", "--", path)


def blob_at(revision, path):
    try:
        return git("rev-parse", "--verify", f"{revision}:{path}").strip()
    except subprocess.CalledProcessError:
        return None


def main(base_ref):
    root = Path(git("rev-parse", "--show-toplevel").strip())
    base = git("merge-base", base_ref, "HEAD").strip()  # Invalid base must fail closed.
    manifest_path = root / "docs/ci/test-retirements.json"
    data = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"schema_version": 1, "retirements": []}
    if not isinstance(data, dict) or data.get("schema_version") != 1 or not isinstance(data.get("retirements"), list):
        raise ValueError("invalid retirement manifest schema")
    records = {}
    for record in data["retirements"]:
        if not isinstance(record, dict):
            raise ValueError("retirement record must be an object")
        path = normalized(record.get("path"))
        if not contract(path) or path in records:
            raise ValueError(f"non-contract or duplicate retirement record: {path}")
        if (root / path).exists() or (root / path).is_symlink():
            raise ValueError(f"retired contract is present/resurrected: {path}")
        commit, blob, digest = (record.get(k, "") for k in ("source_commit", "source_blob", "source_sha256"))
        if not re.fullmatch(r"[0-9a-f]{40}", commit) or not re.fullmatch(r"[0-9a-f]{40}", blob) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError(f"missing full source commit/blob/sha256: {path}")
        if git("cat-file", "-t", commit).strip() != "commit" or blob_at(commit, path) != blob:
            raise ValueError(f"source commit/blob mismatch: {path}")
        if hashlib.sha256(git("cat-file", "blob", blob, binary=True)).hexdigest() != digest:
            raise ValueError(f"source sha256 mismatch: {path}")
        dimensions = record.get("dimensions")
        if not isinstance(dimensions, dict) or set(dimensions) != DIMENSIONS or any(not isinstance(v, str) or not v.strip() for v in dimensions.values()):
            raise ValueError(f"complete seven-dimension retirement rationale required: {path}")
        if not isinstance(record.get("reason"), str) or not record["reason"].strip():
            raise ValueError(f"retirement reason required: {path}")
        replacements = record.get("replacement_test_paths", [])
        evidence = record.get("evidence_paths", [])
        if not isinstance(replacements, list) or not isinstance(evidence, list):
            raise ValueError(f"replacement/evidence lists required: {path}")
        for replacement in replacements:
            tracked_file(root, replacement)
            if not re.search(r"(?:\.(?:test|spec)\.|(?:^|/)test_[^/]+\.|-smoke\.sh$)", replacement):
                raise ValueError(f"replacement must be a current test: {replacement}")
        if not replacements:
            historical = record.get("historical_obligation_evidence")
            if not isinstance(historical, str) or not historical.strip() or not evidence:
                raise ValueError(f"no current test replacement or evidenced absence of unique obligation: {path}")
        for evidence_path in evidence:
            tracked_file(root, evidence_path)
        records[path] = record

    fields = git("diff", "--name-status", "--find-renames", "-z", f"{base}...HEAD").split("\0")
    changes = []
    n = 0
    while n < len(fields) and fields[n]:
        status, path = fields[n], fields[n + 1]
        n += 2
        if status.startswith(("R", "C")):
            destination = fields[n]
            n += 1
            if contract(path) or contract(destination):
                raise ValueError(f"renaming/copying an immutable contract is not the deletion channel: {path} -> {destination}")
        elif contract(path):
            changes.append((status, path))
    for status, path in changes:
        if status == "D":
            record = records.get(path)
            if record is None:
                raise ValueError(f"deleted contract lacks a retirement record: {path}")
            if blob_at(base, path) != record["source_blob"]:
                raise ValueError(f"base content differs from approved source blob: {path}")
            print(f"RETIRED: {path} (verified source and current replacement/obligation evidence)")
            continue
        if blob_at(base, path):
            raise ValueError(f"existing immutable contract was modified ({status}): {path}")
        first = git("log", "--reverse", "--diff-filter=A", "--format=%H", f"{base}..HEAD", "--", path).splitlines()
        if not first or git("log", "--format=%H", f"{first[0]}..HEAD", "--", path).strip():
            raise ValueError(f"contract was modified after first introduction: {path}")
        print(f"UNCHANGED AFTER INTRODUCTION: {path}")
    print(f"PASS: immutable contracts; {len(records)} content-anchored retirement records validated")


if __name__ == "__main__":
    try:
        main(sys.argv[1] if len(sys.argv) > 1 else "origin/main")
    except (ValueError, OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print(f"FAIL: contract immutability: {error}", file=sys.stderr)
        sys.exit(1)
