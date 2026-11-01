#!/usr/bin/env python3
"""受控迁移临时手机锁真身；运行时只验证持久根，不创建空锁根。"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat
import sys
import tempfile


MARKER = '.migration-complete.json'
MAX_BYTES = 8 * 1024 * 1024


def require(value, message):
    if not value:
        raise ValueError('PHONE_LOCK_ROOT_UNSAFE: ' + message)


def regular(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_size <= MAX_BYTES, 'non-regular or oversized file')
    return path.read_bytes()


def inventory(root):
    require(root.is_absolute() and root.is_dir() and not root.is_symlink(), 'root missing or not canonical')
    records = []
    total = 0
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root).as_posix()
        require(not path.is_symlink(), 'symlink in lock tree')
        info = path.lstat()
        if stat.S_ISDIR(info.st_mode):
            records.append([relative, 'dir', stat.S_IMODE(info.st_mode)])
        else:
            data = regular(path)
            total += len(data)
            require(total <= MAX_BYTES, 'lock tree exceeds size budget')
            records.append([relative, 'file', stat.S_IMODE(info.st_mode), hashlib.sha256(data).hexdigest()])
    return records


def sync_tree(root):
    paths = sorted(root.rglob('*'), key=lambda path: len(path.parts), reverse=True)
    for path in [*paths, root]:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def verify(root):
    root = Path(root)
    require(root.is_absolute() and root.is_dir() and not root.is_symlink() and
            root.resolve() == root, 'persistent root unavailable')
    info = root.stat()
    require(stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.geteuid(),
            'persistent root permissions invalid')
    record = json.loads(regular(root / MARKER))
    require(record.get('schema_version') == 1 and record.get('state') == 'complete' and
            isinstance(record.get('source_sha256'), str) and
            re.fullmatch(r'[a-f0-9]{64}', record['source_sha256']) and
            isinstance(record.get('legacy_root'), str) and Path(record['legacy_root']).is_absolute(),
            'migration marker invalid')
    if root == trusted_root():
        require(record['legacy_root'] == '/private/tmp/openclaw-phone/locks',
                'production migration marker names unexpected legacy root')
    return record


def trusted_root():
    home = Path(pwd.getpwuid(os.geteuid()).pw_dir)
    require(home.is_absolute() and home.resolve() == home and home.is_dir() and not home.is_symlink(),
            'system account home is not canonical')
    return home / '.local/share/zenithjoy/phone-locks'


def check_serial(root, serial):
    require(re.fullmatch(r'[A-Za-z0-9._-]{1,80}', serial) is not None, 'invalid serial')
    record = verify(root)
    durable = Path(root) / (serial + '.lock')
    legacy = Path(record['legacy_root']) / (serial + '.lock')
    require(not durable.exists() and not durable.is_symlink(), 'persistent owner or review held')
    require(not legacy.exists() and not legacy.is_symlink(), 'legacy owner or review held')
    return {'serial': serial, 'state': 'free', 'migration': 'verified'}


def migrate(old, durable):
    old, durable = Path(old), Path(durable)
    require(old.is_absolute() and old.is_dir() and not old.is_symlink(), 'legacy root unavailable')
    require(durable.is_absolute() and not durable.exists() and not durable.is_symlink(),
            'persistent root already exists; refusing overwrite')
    require(durable.parent.resolve() == durable.parent, 'persistent parent is not canonical')
    guards = sorted(old.glob('*.guard'))
    require(guards, 'legacy guards missing')
    descriptors = []
    stage = None
    try:
        for path in guards:
            fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
            descriptors.append((fd, path))
            require(stat.S_ISREG(os.fstat(fd).st_mode), 'legacy guard not regular')
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError('PHONE_LOCK_ROOT_UNSAFE: legacy guard busy') from None
        owners = list(old.glob('*.lock'))
        require(owners, 'no legacy review owners to migrate')
        guarded = {path.stem for path in guards}
        for owner in owners:
            require(owner.is_dir() and not owner.is_symlink(), 'malformed legacy owner')
            require(owner.name.removesuffix('.lock') in guarded, 'owner guard missing')
            owner_bytes = regular(owner / 'owner')
            name = owner_bytes.decode().removesuffix('\n')
            require(bool(name) and '\n' not in name and regular(owner / 'standalone_review_required') == owner_bytes,
                    'non-review or conflicting legacy owner')
            acquired = regular(owner / 'acquired_at').decode().strip()
            require(acquired.isdecimal(), 'legacy acquired_at invalid')
            if (owner / 'pid').exists():
                require(regular(owner / 'pid').decode().strip().isdecimal(), 'legacy pid invalid')
        before = inventory(old)
        durable.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix='.phone-lock-migrate-', dir=durable.parent))
        os.chmod(stage, 0o700)
        for entry in old.iterdir():
            target = stage / entry.name
            if entry.is_dir():
                shutil.copytree(entry, target, copy_function=shutil.copy2, symlinks=False)
            else:
                shutil.copy2(entry, target, follow_symlinks=False)
        require(inventory(old) == before and inventory(stage) == before, 'legacy tree changed during copy')
        for fd, path in descriptors:
            a, b = os.fstat(fd), path.stat()
            require((a.st_dev, a.st_ino) == (b.st_dev, b.st_ino), 'legacy guard inode changed')
        source = hashlib.sha256(json.dumps(before, separators=(',', ':')).encode()).hexdigest()
        marker = {'schema_version': 1, 'state': 'complete', 'source_sha256': source,
                  'legacy_root': str(old), 'entries': len(before), 'review_owners': len(owners)}
        with open(stage / MARKER, 'x', encoding='utf-8') as handle:
            os.fchmod(handle.fileno(), 0o600)
            json.dump(marker, handle, sort_keys=True, separators=(',', ':'))
            handle.flush()
            os.fsync(handle.fileno())
        sync_tree(stage)
        os.rename(stage, durable)
        stage = None
        fd = os.open(durable.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        verify(durable)
        return marker
    finally:
        if stage is not None:
            shutil.rmtree(stage)
        for fd, _ in descriptors:
            os.close(fd)


if __name__ == '__main__':
    try:
        if len(sys.argv) == 2 and sys.argv[1] == 'trusted-root':
            print(trusted_root())
        elif len(sys.argv) == 2 and sys.argv[1] == 'verify-production':
            print(json.dumps(verify(trusted_root()), sort_keys=True))
        elif len(sys.argv) == 2 and sys.argv[1] == 'migrate-production':
            print(json.dumps(migrate('/private/tmp/openclaw-phone/locks', trusted_root()), sort_keys=True))
        elif len(sys.argv) == 3 and sys.argv[1] == 'verify':
            print(json.dumps(verify(sys.argv[2]), sort_keys=True))
        elif len(sys.argv) == 4 and sys.argv[1] == 'check-serial':
            print(json.dumps(check_serial(sys.argv[2], sys.argv[3]), sort_keys=True))
        elif len(sys.argv) == 4 and sys.argv[1] == 'migrate':
            print(json.dumps(migrate(sys.argv[2], sys.argv[3]), sort_keys=True))
        else:
            raise ValueError('usage: phone-lock-root.py trusted-root | verify-production | migrate-production | verify ROOT | check-serial ROOT SERIAL | migrate OLD_ROOT DURABLE_ROOT')
    except (OSError, ValueError, UnicodeError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
