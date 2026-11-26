#!/usr/bin/env python3
"""Hold one existing hard-linked phone guard while the parent checks the epoch."""

import fcntl
import json
import re
import os
from pathlib import Path
import stat
import sys


def check(condition):
    if not condition:
        raise ValueError('CLOUD_FENCE_LOCAL_GUARD')


def snapshot(root, legacy, serial):
    facts = []
    for base in (root, legacy):
        info = base.lstat()
        check(base.resolve(strict=True) == base and stat.S_ISDIR(info.st_mode)
              and info.st_uid == os.getuid() and not info.st_mode & 0o022
              and (base != root or stat.S_IMODE(info.st_mode) == 0o700))
        check(not os.path.lexists(base / (serial + '.lock')))
        guard = base / (serial + '.guard')
        info = guard.lstat()
        check(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
              and info.st_uid == os.getuid() and info.st_nlink == 2 and info.st_size == 0)
        facts.append((info.st_dev, info.st_ino))
    check(facts[0] == facts[1])
    marker = root / '.migration-complete.json'
    descriptor = os.open(marker, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        check(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
              and info.st_nlink == 1 and not info.st_mode & 0o022 and info.st_size <= 65536)
        marker_raw = stream.read(65537)
    marker = json.loads(marker_raw)
    check(marker.get('schema_version') == 1 and marker.get('state') == 'complete'
          and isinstance(marker.get('source_sha256'), str)
          and re.fullmatch(r'[0-9a-f]{64}', marker['source_sha256'])
          and marker.get('legacy_root') == str(legacy))
    return facts[0], marker_raw


def main(root, legacy, serial):
    check(serial == '47.100.213.173:10001')
    original = snapshot(root, legacy, serial)
    descriptor = os.open(root / (serial + '.guard'), os.O_RDWR | os.O_NOFOLLOW)
    try:
        actual = os.fstat(descriptor)
        check((actual.st_dev, actual.st_ino) == original[0])
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        check(snapshot(root, legacy, serial) == original)
        print('held', flush=True)
        for command in sys.stdin.buffer:
            check(command == b'assert\n' and snapshot(root, legacy, serial) == original)
            print('held', flush=True)
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    try:
        check(len(sys.argv) == 4)
        main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
    except (OSError, ValueError):
        sys.stderr.write('CLOUD_FENCE_LOCAL_GUARD\n')
        sys.exit(1)
