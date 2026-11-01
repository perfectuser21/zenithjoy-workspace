#!/usr/bin/env python3
"""Crash-safe retirement of one reviewed phone owner in both lock roots.

The caller must separately prove the old process has ended, the phone is at
HOME, automatic entries are closed, and a new candidate has passed its gate.
This module never releases more than the named serial and owner.
"""

import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat


HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


locks = load('phone-lock-root.py')
tx = load('deployment-transaction.py')


def require(value, code):
    if not value:
        raise ValueError('REOPEN_LOCK_' + code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def owner_directory(path, owner):
    require(path.is_dir() and not path.is_symlink(), 'OWNER_DIR')
    names = {p.name for p in path.iterdir()}
    require({'owner', 'standalone_review_required', 'acquired_at'} <= names <=
            {'owner', 'standalone_review_required', 'acquired_at', 'pid'}, 'OWNER_SHAPE')
    require(locks.regular(path / 'owner') == (owner + '\n').encode() and
            locks.regular(path / 'standalone_review_required') == (owner + '\n').encode(),
            'OWNER_MISMATCH')
    require(locks.regular(path / 'acquired_at').decode().strip().isdecimal(), 'OWNER_TIME')
    if 'pid' in names:
        require(locks.regular(path / 'pid').decode().strip().isdecimal(), 'OWNER_PID')


def changed_inventory(before, source, target):
    result = []
    for row in before:
        name = row[0]
        if name == source or name.startswith(source + '/'):
            name = target + name[len(source):]
        result.append([name, *row[1:]])
    return sorted(result, key=lambda item: item[0])


def _read_plan(path):
    value = json.loads(tx.regular(path)[0])
    proof = value.pop('sha256', None)
    require(proof == digest(value), 'JOURNAL_DIGEST')
    return value


def _save_plan(path, plan):
    tx.atomic_bytes(path, tx.canonical({**plan, 'sha256': digest(plan)}))


def _guards(old, durable):
    paths = sorted([*old.glob('*.guard'), *durable.glob('*.guard')])
    require(paths and len(paths) == 2 * len(list(old.glob('*.guard'))), 'GUARD_SET')
    descriptors = []
    try:
        for path in paths:
            fd = os.open(path, os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0))
            descriptors.append((fd, path))
            require(stat.S_ISREG(os.fstat(fd).st_mode), 'GUARD_FILE')
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError('REOPEN_LOCK_GUARD_BUSY') from None
        return descriptors
    except Exception:
        for fd, _ in descriptors:
            os.close(fd)
        raise


def _guard_inodes(descriptors):
    for fd, path in descriptors:
        info, named = os.fstat(fd), path.lstat()
        require(stat.S_ISREG(named.st_mode) and
                (info.st_dev, info.st_ino) == (named.st_dev, named.st_ino), 'GUARD_CHANGED')


def retire_exact_review(old_root, durable_root, serial, owner, transaction, journal_path,
                        *, after_step=lambda _: None):
    old, durable, journal = Path(old_root), Path(durable_root), Path(journal_path)
    require(re.fullmatch(r'[A-Za-z0-9._-]{1,80}', serial or '') and
            re.fullmatch(r'[A-Za-z0-9_:-]{1,160}', owner or '') and
            re.fullmatch(r'phone-reopen-[a-f0-9]{24}', transaction or ''), 'SCOPE')
    require(old.is_absolute() and durable.is_absolute() and old.is_dir() and
            not old.is_symlink() and durable.is_dir() and not durable.is_symlink(), 'ROOT')
    require(journal.is_absolute() and journal.parent.is_dir() and not journal.is_symlink(), 'JOURNAL_PATH')
    source = serial + '.lock'
    archived = '.review-retired-' + transaction + '-' + serial
    fds = _guards(old, durable)
    try:
        _guard_inodes(fds)
        if journal.exists():
            plan = _read_plan(journal)
            require(all(plan.get(k) == v for k, v in
                        {'transaction': transaction, 'serial': serial, 'owner': owner,
                         'old_root': str(old), 'durable_root': str(durable)}.items()), 'JOURNAL_SCOPE')
        else:
            prior = locks.verify_review(old, durable, guards_held=True)
            require(prior['review_owners'] > 1, 'LAST_REVIEW_UNSUPPORTED')
            for root in (old, durable):
                require(not (root / archived).exists() and not (root / archived).is_symlink(), 'ARCHIVE_CONFLICT')
                owner_directory(root / source, owner)
            before = locks.inventory(old)
            after = changed_inventory(before, source, archived)
            marker = locks.verify(durable)
            require(marker['review_owners'] == prior['review_owners'], 'MARKER_COUNT')
            updated = {**marker, 'entries': len(after), 'review_owners': prior['review_owners'] - 1,
                       'source_sha256': hashlib.sha256(json.dumps(after, separators=(',', ':')).encode()).hexdigest()}
            plan = {'schema_version': 1, 'transaction': transaction, 'serial': serial, 'owner': owner,
                    'old_root': str(old), 'durable_root': str(durable), 'before': before,
                    'after': after, 'marker_before': marker, 'marker_after': updated}
            _save_plan(journal, plan)
        require(plan.get('schema_version') == 1, 'JOURNAL_VERSION')
        before, after = plan['before'], plan['after']
        marker = locks.verify(durable)
        old_inventory = locks.inventory(old)
        durable_inventory = [row for row in locks.inventory(durable) if row[0] != locks.MARKER]
        require(old_inventory in (before, after) and durable_inventory in (before, after) and
                marker in (plan['marker_before'], plan['marker_after']), 'INVENTORY_DRIFT')
        for root, current in ((old, old_inventory), (durable, durable_inventory)):
            owner_directory(root / (source if current == before else archived), owner)
        # Durable goes first. The legacy lock continues to block even if power fails.
        if durable_inventory == before:
            require(old_inventory == before and marker == plan['marker_before'], 'ORDER')
            os.rename(durable / source, durable / archived)
            tx.sync_directory(durable)
            after_step('durable_retired')
            durable_inventory = after
        if marker == plan['marker_before']:
            require(old_inventory == before and durable_inventory == after, 'ORDER')
            tx.atomic_bytes(durable / locks.MARKER, tx.canonical(plan['marker_after']))
            after_step('marker_updated')
            marker = plan['marker_after']
        if old_inventory == before:
            require(durable_inventory == after and marker == plan['marker_after'], 'ORDER')
            os.rename(old / source, old / archived)
            tx.sync_directory(old)
            after_step('legacy_retired')
        _guard_inodes(fds)
        remaining = locks.verify_review(old, durable, guards_held=True)
        require(locks.check_serial(durable, serial)['state'] == 'free', 'NOT_FREE')
        return {'released': True, 'serial': serial, 'owner': owner,
                'remaining_review_owners': remaining['review_owners'], 'transaction': transaction}
    finally:
        for fd, _ in fds:
            os.close(fd)
