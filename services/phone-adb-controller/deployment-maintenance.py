#!/usr/bin/env python3
"""复用原serial.guard和不可自动回收的standalone owner，部署不操作手机。"""
from contextlib import contextmanager
import csv
import fcntl
import hashlib
import importlib.util
import json
import os
import pwd
from pathlib import Path
import re
import stat
import sys
import tempfile
import time

spec = importlib.util.spec_from_file_location('phone_transaction', Path(__file__).with_name('deployment-transaction.py'))
transaction = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transaction)
require = transaction.require


def canonical_path(path):
    path = Path(path)
    require(path.is_absolute(), 'absolute maintenance path required')
    for item in [path, *path.parents]:
        require(not item.is_symlink(), 'maintenance symlink rejected')
    return path


def context(home, tx, registry, root):
    home = Path(home)
    transaction.owned(home, tx)
    registry, root = canonical_path(registry), canonical_path(root)
    require(root.is_dir(), 'device lock root missing')
    raw, _ = transaction.regular(registry)
    rows = list(csv.reader(raw.decode().splitlines(), delimiter='\t'))
    headers = [r for r in rows if r and r[0].lstrip('#') == 'profile']
    require(len(headers) == 1, 'unique registry header required')
    header = [key.lstrip('#') for key in headers[0]]
    require(len(set(header)) == len(header) and all(key in header for key in ('profile', 'serial')), 'invalid registry columns')
    serials = []
    for row in rows:
        if not row or row[0].startswith('#') or row[0] == 'profile':
            continue
        require(len(row) == len(header), 'invalid registry row')
        serial = row[header.index('serial')]
        require(re.fullmatch('[A-Za-z0-9_-]{1,80}', serial), 'invalid registry serial')
        serials.append(serial)
    require(serials and len(set(serials)) == len(serials), 'registry serials empty/repeated')
    return {'transaction': tx, 'owner': 'phone-deploy-' + tx,
            'registry': str(registry), 'registry_sha256': hashlib.sha256(raw).hexdigest(),
            'lock_root': str(root), 'serials': sorted(serials)}


@contextmanager
def guards(record):
    root = canonical_path(record['lock_root'])
    descriptors = []
    try:
        for serial in record['serials']:
            path = canonical_path(root / (serial + '.guard'))
            fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
            descriptors.append((fd, path))
            require(stat.S_ISREG(os.fstat(fd).st_mode), 'regular device guard required')
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError('phone maintenance: device guard busy') from None
        def check():
            for fd, path in descriptors:
                info, named = os.fstat(fd), path.lstat()
                require(stat.S_ISREG(named.st_mode) and (info.st_dev, info.st_ino) == (named.st_dev, named.st_ino),
                        'device guard replaced')
        check()
        yield check
    finally:
        for fd, _ in descriptors:
            os.close(fd)


def read_intent(home, tx, current):
    path = transaction.transaction_directory(home, tx) / 'maintenance.json'
    record = json.loads(transaction.regular(path)[0])
    require(record == current, 'maintenance registry or owner identity changed')
    return record


def owned_directory(path, owner):
    canonical_path(path)
    require(path.is_dir(), 'maintenance owner directory missing')
    require({p.name for p in path.iterdir()} == {'owner', 'standalone_review_required', 'acquired_at'},
            'maintenance owner has unknown state')
    for name in ('owner', 'standalone_review_required'):
        raw, _ = transaction.regular(path / name)
        require(raw.decode().strip() == owner, 'maintenance owner conflict')


def check_owners(record, allow_missing=False):
    root = Path(record['lock_root'])
    expected = {serial + '.lock' for serial in record['serials']}
    require(all(path.name in expected for path in root.glob('*.lock')), 'unknown device owner exists')
    for name in sorted(expected):
        path = root / name
        if allow_missing and not path.exists() and not path.is_symlink():
            continue
        owned_directory(path, record['owner'])


def retired_directories(record):
    result = []
    for serial in record['serials']:
        path = canonical_path(Path(record['lock_root']) / ('.phone-retired-' + record['transaction'] + '-' + serial))
        if not path.exists():
            continue
        require(path.is_dir(), 'retired owner directory required')
        names = {p.name for p in path.iterdir()}
        require(names <= {'owner', 'standalone_review_required', 'acquired_at'}, 'retired owner has unknown state')
        # owner最后删除。缺owner只有空目录合法，不能清理无法归属的残片。
        require('owner' in names or not names, 'retired owner identity missing')
        for name in names & {'owner', 'standalone_review_required'}:
            raw, _ = transaction.regular(path / name)
            require(raw.decode().strip() == record['owner'], 'retired owner conflict')
        if 'acquired_at' in names:
            transaction.regular(path / 'acquired_at')
        result.append(path)
    return result


def clean_retired(record):
    paths = retired_directories(record)
    for path in paths:
        for name in ('acquired_at', 'standalone_review_required', 'owner'):
            file = path / name
            if file.exists():
                file.unlink()
                transaction.sync_directory(path)
        path.rmdir()
        transaction.sync_directory(path.parent)


def acquire(home, tx, registry, root):
    current = context(home, tx, registry, root)
    directory = transaction.transaction_directory(home, tx)
    intent = directory / 'maintenance.json'
    with guards(current) as check:
        if intent.exists():
            read_intent(home, tx, current)
            check_owners(current, allow_missing=True)
            clean_retired(current)
        else:
            require(not list(Path(root).glob('*.lock')), 'device owner exists; deployment cannot reap')
            transaction.atomic_bytes(intent, transaction.canonical(current))
        for serial in current['serials']:
            path = Path(root) / (serial + '.lock')
            if path.exists():
                continue
            stage = Path(tempfile.mkdtemp(prefix='.phone-deploy-', dir=root))
            try:
                for name, value in [('owner', current['owner']), ('standalone_review_required', current['owner']),
                                    ('acquired_at', str(int(time.time())))]:
                    transaction.atomic_bytes(stage / name, (value + '\n').encode())
                check()
                os.rename(stage, path)
                transaction.sync_directory(Path(root))
            finally:
                if stage.exists():
                    for file in stage.iterdir():
                        file.unlink()
                    stage.rmdir()
        require(context(home, tx, registry, root) == current, 'registry changed while acquiring device maintenance')
        check_owners(current)
        check()
    return current


def verify(home, tx, registry, root):
    current = context(home, tx, registry, root)
    read_intent(home, tx, current)
    check_owners(current)
    return current


def release(home, tx, registry, root):
    current = context(home, tx, registry, root)
    read_intent(home, tx, current)
    with guards(current) as check:
        # Validate all owners first; an unrelated owner never causes partial unlocking.
        check_owners(current, allow_missing=True)
        clean_retired(current)
        for serial in current['serials']:
            path = Path(root) / (serial + '.lock')
            if not path.exists():
                continue
            owned_directory(path, current['owner'])
            check()
            # 一次rename移走整个owner；恢复中断不能留下半个owner目录被误判。
            retired = Path(root) / ('.phone-retired-' + tx + '-' + serial)
            require(not retired.exists(), 'previous maintenance release cleanup pending')
            os.rename(path, retired)
            transaction.sync_directory(Path(root))
            clean_retired(current)
    return {'released': True, 'transaction': tx}


if __name__ == '__main__':
    try:
        action, tx = sys.argv[1:3]
        home = Path(pwd.getpwuid(os.getuid()).pw_dir).resolve()
        registry = home / '.config/openclaw/douyin-phone-profiles.tsv'
        root = home / '.local/share/zenithjoy/phone-locks'
        require(action in ('acquire', 'verify', 'release'), 'invalid maintenance action')
        result = globals()[action](home, tx, registry, root)
        print(json.dumps(result))
    except (OSError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
