#!/usr/bin/env python3
"""单durable原101 owner的可重入CAS归档；不改旧migration marker/计数。"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import stat

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prior = load('maintenance-reopen-lock.py')
locks, tx = prior.locks, prior.tx
maintenance = load('deployment-maintenance.py')
SERIAL, OWNER = 'ANGYVB4311010223', 'ys261104032759_101'
TRANSACTION = 'discovery-review-6a18b697-c009-4a5c-8133-ecb77f346a71'
ARCHIVE = '.review-retired-' + TRANSACTION + '-' + SERIAL


def need(ok, code):
    if not ok:
        raise ValueError('DISCOVERY_REVIEW_LOCK_' + code)


def retire(old_root, durable_root, journal_path, authority_sha256, *, after_step=lambda _: None, before_commit=lambda: None, legacy_record=None):
    old, durable, journal = map(Path, (old_root, durable_root, journal_path))
    need(len(authority_sha256) == 64 and all(c in '0123456789abcdef' for c in authority_sha256), 'AUTHORITY')
    marker = locks.verify(durable)
    logical_old = old
    need(marker['legacy_root'] == str(logical_old), 'ROOT')
    def binding_unchanged():
        if legacy_record is not None:
            need(legacy_record.get('legacy_root') == str(logical_old)
                 and legacy_record.get('legacy_binding'), 'LEGACY_BINDING')
            maintenance.verify_legacy_binding(legacy_record)
    if old.resolve() != old:
        need(legacy_record is not None, 'LEGACY_BINDING_REQUIRED')
        binding_unchanged()
        old, binding = maintenance.legacy_binding(legacy_record['legacy_binding']['home'], logical_old)
        need(binding == legacy_record['legacy_binding'], 'LEGACY_BINDING')
    else:
        need(legacy_record is None, 'UNEXPECTED_BINDING')
    need(old.is_absolute() and old.resolve() == old and old.is_dir() and not old.is_symlink(), 'ROOT')
    need(journal.is_absolute() and journal.parent.is_dir() and not journal.is_symlink(), 'JOURNAL')
    source = SERIAL + '.lock'
    # Current owner never existed in legacy. Never manufacture a second owner.
    need(not os.path.lexists(old / source), 'LEGACY_TARGET')
    guards = sorted([*old.glob('*.guard'), *durable.glob('*.guard')])
    need(guards and durable / (SERIAL + '.guard') in guards, 'GUARDS')
    fds = []
    try:
        for path in guards:
            fd = os.open(path, os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0))
            fds.append((fd, path))
            info = os.fstat(fd)
            need(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o022, 'GUARD')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        prior._guard_inodes(fds)
        binding_unchanged()
        if legacy_record is not None:
            need({str(path) for _, path in fds} == set(legacy_record.get('guard_identity', {})), 'GUARD_SET')
            for fd, path in fds:
                actual = os.fstat(fd)
                need([actual.st_dev, actual.st_ino, actual.st_ctime_ns] == legacy_record['guard_identity'][str(path)], 'ORIGINAL_GUARD_IDENTITY')
        before_old = locks.inventory(old)
        current = locks.inventory(durable)
        identity = {'transaction': TRANSACTION, 'serial': SERIAL, 'owner': OWNER,
                    'old_root': str(logical_old), 'physical_old_root': str(old),
                    'legacy_binding': legacy_record, 'durable_root': str(durable), 'authority_sha256': authority_sha256}
        if journal.exists():
            plan = prior._read_plan(journal)
            need(all(plan.get(k) == v for k, v in identity.items()), 'JOURNAL_SCOPE')
        else:
            prior.owner_directory(durable / source, OWNER)
            need(not os.path.lexists(durable / ARCHIVE), 'ARCHIVE_CONFLICT')
            target = (durable / source).lstat()
            plan = {**identity, 'schema_version': 1,
                    'owner_inode': [target.st_dev, target.st_ino, target.st_uid, target.st_mode],
                    'old_inventory': before_old,
                    'before': current, 'after': prior.changed_inventory(current, source, ARCHIVE)}
            prior._save_plan(journal, plan)
        need(plan.get('schema_version') == 1 and before_old == plan['old_inventory']
             and current in (plan['before'], plan['after'])
             and not os.path.lexists(old / source), 'INVENTORY_DRIFT')
        # Journal itself must describe exactly this one directory rename.
        need(plan['after'] == prior.changed_inventory(plan['before'], source, ARCHIVE), 'JOURNAL_CHANGE')
        target_path = durable / (source if current == plan['before'] else ARCHIVE)
        prior.owner_directory(target_path, OWNER)
        target = target_path.lstat()
        need([target.st_dev, target.st_ino, target.st_uid, target.st_mode] == plan['owner_inode'], 'OWNER_INODE')
        before_commit()
        binding_unchanged()
        prior._guard_inodes(fds)
        target = target_path.lstat()
        need([target.st_dev, target.st_ino, target.st_uid, target.st_mode] == plan['owner_inode'], 'OWNER_INODE')
        if current == plan['before']:
            need(locks.inventory(old) == plan['old_inventory'] and locks.inventory(durable) == plan['before']
                 and not os.path.lexists(old / source), 'CAS')
            os.rename(durable / source, durable / ARCHIVE)
            tx.sync_directory(durable)
            after_step('durable_retired')
        prior._guard_inodes(fds)
        binding_unchanged()
        need(guards == sorted([*old.glob('*.guard'), *durable.glob('*.guard')])
             and locks.inventory(old) == plan['old_inventory']
             and locks.inventory(durable) == plan['after']
             and not os.path.lexists(old / source), 'AFTER_DRIFT')
        need(locks.check_serial(durable, SERIAL)['state'] == 'free', 'NOT_FREE')
        return {'released': True, 'serial': SERIAL, 'owner': OWNER,
                'transaction': TRANSACTION, 'archive': ARCHIVE, 'marker_unchanged': True,
                'central_lease_released': False}
    finally:
        for fd, _ in fds:
            os.close(fd)
