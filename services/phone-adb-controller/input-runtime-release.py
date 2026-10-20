#!/usr/bin/env python3
"""Paired input deployment with monotonic component identity and full-file CAS."""
import ast
from contextlib import contextmanager
import csv
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def component(raw, helper=False):
    text = raw.decode("utf-8")
    if helper:
        markers = re.findall(r"^INPUT_RUNTIME_REVISION = (\d+)$", text, re.M)
        return int(markers[0]) if len(markers) == 1 else 0, digest(raw)
    starts = list(re.finditer(r"^text_input\(\) \{$", text, re.M))
    if len(starts) != 1:
        raise ValueError("controller text_input function is absent or ambiguous")
    end = re.search(r"^}$", text[starts[0].end():], re.M)
    if not end:
        raise ValueError("controller text_input function has no boundary")
    function = text[starts[0].start():starts[0].end() + end.end()]
    markers = re.findall(r"^  # INPUT_RUNTIME_REVISION=(\d+)$", function, re.M)
    return int(markers[0]) if len(markers) == 1 else 0, digest(function.encode())


def source_info(controller, helper):
    c, h = Path(controller).read_bytes(), Path(helper).read_bytes()
    cr, function_hash = component(c)
    hr, helper_hash = component(h, True)
    if cr < 1 or cr != hr:
        raise ValueError("incoming input controller/helper revision is missing or incompatible; carry the verified pair")
    ast.parse(h.decode())
    subprocess.run(["zsh", "-n", str(controller)], check=True, capture_output=True)
    return {"revision": cr, "function_sha256": function_hash, "helper_sha256": helper_hash,
            "controller_sha256": digest(c)}


def capture(directories):
    result = {}
    for directory in directories:
        for name in ("douyin-phone-adb", "text-input-focus.py"):
            p = Path(directory).resolve() / name
            result[str(p)] = digest(p.read_bytes()) if p.exists() else None
    return result


def check_component_floor(info, directories):
    for directory in directories:
        for name, helper, expected in (("douyin-phone-adb", False, info["function_sha256"]),
                                      ("text-input-focus.py", True, info["helper_sha256"])):
            p = Path(directory) / name
            if not p.exists():
                continue
            revision, existing = component(p.read_bytes(), helper)
            if revision > info["revision"] or (revision == info["revision"] and existing != expected):
                raise ValueError("input component would regress or mutate an existing revision; preserve the verified function/helper or bump the paired revision")


def registry_serials(registry, raw=None):
    raw = Path(registry).read_bytes() if raw is None else raw
    rows = []
    header = None
    for row in csv.reader(raw.decode("utf-8").splitlines(), delimiter="\t"):
        if not row or not any(row):
            continue
        if row[0] in ("profile", "#profile"):
            header = [value.lstrip("#") for value in row]
            if "serial" not in header:
                raise ValueError("device registry has no serial column")
            continue
        if row[0].startswith("#"):
            continue
        index = header.index("serial") if header else 1
        if len(row) <= index or not re.fullmatch(r"[A-Za-z0-9._-]+", row[index]):
            raise ValueError("device registry has an invalid serial")
        rows.append(row[index])
    if not rows:
        raise ValueError("device registry is empty; installation safety is unknown")
    return sorted(set(rows))


@contextmanager
def device_barrier(registry, lock_root):
    # Same serial.guard kernel flock as phone-lock-helper.py; never reap/adopt/release owners.
    registry_raw = Path(registry).read_bytes()
    serials = registry_serials(registry, registry_raw)
    registry_hash = digest(registry_raw)
    root = Path(lock_root)
    if not root.is_dir():
        raise ValueError("kernel device lock root missing; installation safety is unknown")
    descriptors = []
    try:
        for serial in serials:
            fd = os.open(root / (serial + ".guard"), os.O_RDWR)
            descriptors.append(fd)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError("kernel device guard is busy; installation refused")
        def verify_free():
            if digest(Path(registry).read_bytes()) != registry_hash:
                raise ValueError("device registry changed while acquiring installation barrier")
            # Any owner directory, including malformed/stale/unknown serial, blocks deployment.
            if list(root.glob("*.lock")):
                raise ValueError("kernel device owner exists; installation refused without reap")
            for serial, fd in zip(serials, descriptors):
                actual, expected = os.fstat(fd), os.stat(root / (serial + ".guard"))
                if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
                    raise ValueError("device guard identity changed")
        verify_free()
        yield verify_free
    finally:
        for fd in descriptors:
            os.close(fd)


def path_identity(path):
    p = Path(path)
    value = p.lstat()
    return (value.st_dev, value.st_ino, value.st_mode, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns,
            os.readlink(p) if stat.S_ISLNK(value.st_mode) else None)


def unchanged_runtime(raw_directories, directories, expected, registry, lock_root, incoming):
    # This proves only byte identity. No device is declared free or stopped, and
    # no guard is acquired/created while an existing owner remains quarantined.
    targets = [Path(d) / name for d in directories for name in incoming]
    for directory in raw_directories:
        if not stat.S_ISDIR(Path(directory).lstat().st_mode):
            raise ValueError("input runtime directory is not a regular directory")
    if any(not p.exists() and not p.is_symlink() for p in targets):
        return None
    watched = {}
    def watch(path, kind=None):
        p = Path(path)
        identity = path_identity(p)
        if kind and not kind(identity[2]):
            raise ValueError("unchanged input identity is not a regular file/directory")
        watched[str(p)] = identity
        # Preserve existing compatibility aliases, but never silently resolve a
        # changed alias to a different root during the read-only proof.
        for parent in p.parents:
            if parent.is_symlink():
                watched[str(parent)] = path_identity(parent)
        return p
    for p in targets:
        watch(p, stat.S_ISREG)
    if any(stat.S_IMODE(watched[str(p)][2]) != 0o755 for p in targets):
        return None  # Permission repair is a real installation, never a read-only no-op.
    for p in [*raw_directories, *directories]:
        watch(p, stat.S_ISDIR)
    def verify_directories():
        for raw, canonical in zip(raw_directories, directories):
            if str(Path(raw).resolve(strict=True)) != canonical:
                raise ValueError("unchanged input raw directory changed canonical target")
    verify_directories()
    registry_path = watch(registry, stat.S_ISREG)
    root = watch(lock_root, stat.S_ISDIR)
    for owner in root.glob("*.lock"):
        watch(owner)
        if owner.is_dir() and not owner.is_symlink():
            for child in owner.iterdir():
                watch(child)
    def read_regular(path):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            value = os.fstat(fd)
            identity = watched[str(path)]
            if not stat.S_ISREG(value.st_mode) or (value.st_dev, value.st_ino) != identity[:2]:
                raise ValueError("unchanged input descriptor identity changed")
            raw = bytearray()
            while len(raw) <= value.st_size:
                part = os.read(fd, min(65536, value.st_size + 1 - len(raw)))
                if not part:
                    break
                raw.extend(part)
            if len(raw) != value.st_size:
                raise ValueError("unchanged input size changed")
            return bytes(raw)
        finally:
            os.close(fd)
    registry_raw = read_regular(registry_path)
    for serial in registry_serials(registry, registry_raw):
        watch(root / (serial + ".guard"), stat.S_ISREG)
    observed = {str(p): digest(read_regular(p)) for p in targets}
    verify_directories()
    for path, identity in watched.items():
        if path_identity(path) != identity:
            raise ValueError("unchanged input path identity changed during readback")
    if observed != expected:
        raise ValueError("input deployment CAS mismatch during unchanged readback")
    if all(observed[str(Path(d) / name)] == digest(raw)
           for d in directories for name, raw in incoming.items()):
        return observed
    return None


def install(controller, helper, expected_path, registry, lock_root, directories):
    # Freeze incoming bytes before validation/staging so the source cannot change midway.
    c, h = Path(controller).read_bytes(), Path(helper).read_bytes()
    info = source_info(controller, helper)
    if digest(c) != info["controller_sha256"] or digest(h) != info["helper_sha256"]:
        raise ValueError("incoming source changed during validation")
    expected = json.loads(Path(expected_path).read_text())
    raw_directories = list(directories)
    directories = [str(Path(d).resolve()) for d in raw_directories]
    if not directories or len(set(directories)) != len(directories):
        raise ValueError("input deployment paths are empty or repeated")
    for directory in directories:
        if not Path(directory).is_dir():
            raise ValueError("input runtime directory missing; installation refused")
    keys = {str(Path(d) / name) for d in directories
            for name in ("douyin-phone-adb", "text-input-focus.py")}
    if not isinstance(expected, dict) or set(expected) != keys or any(
            value is not None and (not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value))
            for value in expected.values()):
        raise ValueError("input deployment CAS target set is invalid")
    observed = unchanged_runtime(raw_directories, directories, expected, registry, lock_root,
                                 {"douyin-phone-adb": c, "text-input-focus.py": h})
    if observed is not None:
        return {"status": "unchanged", "component": info, "observed": observed}
    staged = []
    try:
        with device_barrier(registry, lock_root) as verify_free, (Path(directories[0]) / ".input-runtime.deploy.guard").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if capture(directories) != expected:
                raise ValueError("input deployment CAS mismatch; another deployment changed the target")
            check_component_floor(info, directories)
            for directory in directories:
                for name, raw in (("text-input-focus.py", h), ("douyin-phone-adb", c)):
                    fd, temp = tempfile.mkstemp(prefix="." + name + ".deploy-", dir=directory)
                    with os.fdopen(fd, "wb") as stream:
                        stream.write(raw)
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.chmod(temp, 0o755)
                    staged.append((Path(temp), Path(directory) / name))
            # Recheck immediately before the first replacement, including writers that ignore our lock.
            if capture(directories) != expected:
                raise ValueError("input deployment CAS mismatch after staging")
            verify_free()
            # Helper first: older controllers can still use its legacy API; new controller needs this helper.
            for temp, target in staged:
                os.replace(temp, target)
            observed = capture(directories)
            verify_free()
            for directory in directories:
                if observed[str(Path(directory) / "douyin-phone-adb")] != digest(c) or observed[str(Path(directory) / "text-input-focus.py")] != digest(h):
                    raise ValueError("input deployment readback mismatch; concurrent unguarded writer")
            return {"status": "installed", "component": info, "observed": observed}
    finally:
        for temp, _ in staged:
            temp.unlink(missing_ok=True)


def main():
    command = sys.argv[1]
    if command == "source-info":
        result = source_info(sys.argv[2], sys.argv[3])
    elif command == "capture":
        result = capture(sys.argv[2:])
    elif command == "install":
        result = install(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6], sys.argv[7:])
    else:
        raise ValueError("unknown input release operation")
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, SyntaxError, subprocess.CalledProcessError, IndexError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
