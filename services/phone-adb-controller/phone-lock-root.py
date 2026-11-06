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


def verify_root(root):
    require(Path(root) == trusted_root(), 'caller root differs from system account home')
    verify(root)


def is_canonical_tcp_serial(value):
    if not isinstance(value, str) or len(value) > 21:
        return False
    match = re.fullmatch(r'((?:[0-9]{1,3}\.){3}[0-9]{1,3}):([1-9][0-9]{0,4})', value)
    return bool(match and all(str(int(part)) == part and int(part) <= 255 for part in match[1].split('.')) and int(match[2]) <= 65535)


def check_serial(root, serial):
    require(re.fullmatch(r'[A-Za-z0-9._-]{1,80}', serial) is not None or is_canonical_tcp_serial(serial), 'invalid serial')
    record = verify(root)
    durable = Path(root) / (serial + '.lock')
    legacy = Path(record['legacy_root']) / (serial + '.lock')
    require(not durable.exists() and not durable.is_symlink(), 'persistent owner or review held')
    require(not legacy.exists() and not legacy.is_symlink(), 'legacy owner or review held')
    return {'serial': serial, 'state': 'free', 'migration': 'verified'}


def verify_review(old, durable, guards_held=False):
    """在旧、新 guard 下核代码安装所需的双根原件；不解除任何 owner。"""
    old, durable = Path(old), Path(durable)
    require(old.is_absolute() and old.is_dir() and not old.is_symlink(), 'legacy root unavailable')
    marker = verify(durable)
    require(marker['legacy_root'] == str(old), 'migration source changed')
    require(type(marker.get('entries')) is int and marker['entries'] > 0 and
            type(marker.get('review_owners')) is int and marker['review_owners'] > 0,
            'migration review inventory missing')
    legacy_guards = sorted(old.glob('*.guard'))
    require(legacy_guards, 'legacy guards missing')
    require({p.name for p in legacy_guards} == {p.name for p in durable.glob('*.guard')},
            'guard set changed')
    descriptors = []
    try:
        if not guards_held:
            for path in sorted([*legacy_guards, *(durable / p.name for p in legacy_guards)]):
                fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
                descriptors.append((fd, path))
                require(stat.S_ISREG(os.fstat(fd).st_mode), 'guard not regular')
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise ValueError('PHONE_LOCK_ROOT_UNSAFE: guard busy') from None
        before = inventory(old)
        copied = [item for item in inventory(durable) if item[0] != MARKER]
        require(before == copied and len(before) == marker['entries'], 'dual root inventory changed')
        source = hashlib.sha256(json.dumps(before, separators=(',', ':')).encode()).hexdigest()
        require(source == marker['source_sha256'], 'migration source digest changed')
        owners = sorted(old.glob('*.lock'))
        require(len(owners) == marker['review_owners'] and owners, 'review owner set changed')
        for owner in owners:
            require(owner.is_dir() and not owner.is_symlink() and
                    (old / (owner.stem + '.guard')).is_file(), 'review owner guard missing')
            owner_bytes = regular(owner / 'owner')
            require(owner_bytes == regular(owner / 'standalone_review_required'),
                    'legacy review owner changed')
            require(regular(durable / owner.name / 'owner') == owner_bytes and
                    regular(durable / owner.name / 'standalone_review_required') == owner_bytes,
                    'persistent review owner changed')
        for fd, path in descriptors:
            info, named = os.fstat(fd), path.lstat()
            require(stat.S_ISREG(named.st_mode) and (info.st_dev, info.st_ino) == (named.st_dev, named.st_ino),
                    'guard inode changed')
        require(inventory(old) == before, 'legacy root changed during verification')
        return {'verified': True, 'review_owners': len(owners), 'entries': len(before)}
    finally:
        for fd, _ in descriptors:
            os.close(fd)


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


def _publish_clean_root(stage, durable):
    """OS atomic no-replace; unlike rename(), never replace a competing empty root."""
    import ctypes
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        # Darwin sys/stdio.h: RENAME_EXCL=0x4.
        operation = libc.renamex_np
        operation.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        result = operation(os.fsencode(stage), os.fsencode(durable), 0x4)
    elif sys.platform.startswith('linux') and hasattr(libc, 'renameat2'):
        operation = libc.renameat2
        operation.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        result = operation(-100, os.fsencode(stage), -100, os.fsencode(durable), 1)
    else:
        raise ValueError('PHONE_LOCK_ROOT_UNSAFE: exclusive publication unavailable')
    if result != 0:
        raise OSError(ctypes.get_errno(), 'PHONE_LOCK_ROOT_UNSAFE: exclusive publication failed')


def _clean_identity(path, directory=False):
    info = path.lstat()
    require((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)) and
            info.st_uid == os.geteuid() and not stat.S_IMODE(info.st_mode) & 0o022,
            'clean bootstrap entry identity or permissions invalid')
    return (info.st_dev, info.st_ino, info.st_uid, stat.S_IMODE(info.st_mode))


def _clean_inventory(old):
    """Only existing guards and empty, guarded claim namespaces are clean."""
    identities = {'.': _clean_identity(old, True)}
    guards = sorted(old.glob('*.guard'))
    require(guards, 'legacy guards missing')
    names = {path.stem for path in guards}
    for name in names:
        require(re.fullmatch(r'[A-Za-z0-9._-]{1,80}', name) is not None or
                is_canonical_tcp_serial(name), 'invalid clean guard serial')
    for path in sorted(old.rglob('*')):
        relative = path.relative_to(old)
        parts = relative.parts
        if len(parts) == 1 and path.name.endswith('.guard'):
            identities[str(relative)] = _clean_identity(path)
            require(path.stat().st_size == 0, 'nonempty guard is not a clean inventory')
        elif parts == ('standalone-claims',):
            identities[str(relative)] = _clean_identity(path, True)
        elif len(parts) == 2 and parts[0] == 'standalone-claims' and parts[1] in names:
            identities[str(relative)] = _clean_identity(path, True)
            require(not list(path.iterdir()), 'unresolved standalone claim')
        else:
            raise ValueError('PHONE_LOCK_ROOT_UNSAFE: owner, claim or unknown legacy entry')
    return inventory(old), identities, guards


def bootstrap_clean(old, durable):
    """Operator-only clean-host setup, never a worker operation or owner migration.

    All legacy guards remain locked through publication and are hardlinked into
    the durable root. Failure preserves staging/recovery evidence; no owner or
    claim is created, removed, or accepted as a JSON authorization capability.
    """
    old, durable = Path(old), Path(durable)
    require(old.is_absolute() and old.resolve() == old, 'legacy root is not canonical')
    require(durable.is_absolute() and durable.parent.resolve() == durable.parent,
            'persistent parent is not canonical')
    # Setup may create missing account-owned ancestors, but never traverse a
    # symlink or accept a writable/foreign destination parent.
    missing = []
    parent = durable.parent
    while not parent.exists():
        missing.append(parent)
        parent = parent.parent
    _clean_identity(parent, True)
    for parent in reversed(missing):
        parent.mkdir(mode=0o700)
    parent_identity = _clean_identity(durable.parent, True)
    descriptors = []
    stage, before, phase, published = None, None, 'inventory', False
    try:
        require(not durable.exists() and not durable.is_symlink(),
                'persistent root already exists; refusing overwrite')
        before, identities, guards = _clean_inventory(old)
        phase = 'guards'
        for path in guards:
            fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
            descriptors.append((fd, path))
            info = os.fstat(fd)
            require((info.st_dev, info.st_ino, info.st_uid, stat.S_IMODE(info.st_mode)) ==
                    identities[path.name], 'legacy guard inode changed')
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError('PHONE_LOCK_ROOT_UNSAFE: legacy guard busy') from None
        require(_clean_inventory(old)[:2] == (before, identities), 'legacy inventory changed')
        phase = 'stage'
        stage = Path(tempfile.mkdtemp(prefix='.phone-lock-bootstrap-stage-', dir=durable.parent))
        os.chmod(stage, 0o700)
        stage_identity = _clean_identity(stage, True)
        for relative, kind, mode, *unused in before:
            target = stage / relative
            if kind == 'dir':
                target.mkdir(mode=mode)
                os.chmod(target, mode)
            else:
                os.link(old / relative, target, follow_symlinks=False)
        source = hashlib.sha256(json.dumps(before, separators=(',', ':')).encode()).hexdigest()
        marker = {'schema_version': 1, 'state': 'complete', 'bootstrap_type': 'clean',
                  'source_sha256': source, 'legacy_root': str(old),
                  'entries': len(before), 'review_owners': 0}
        with open(stage / MARKER, 'x', encoding='utf-8') as handle:
            os.fchmod(handle.fileno(), 0o600)
            json.dump(marker, handle, sort_keys=True, separators=(',', ':'))
            handle.flush()
            os.fsync(handle.fileno())
        sync_tree(stage)

        def unchanged(location):
            require(_clean_identity(durable.parent, True) == parent_identity and
                    _clean_identity(location, True) == stage_identity,
                    'bootstrap directory identity changed')
            require(_clean_inventory(old)[:2] == (before, identities), 'legacy inventory changed')
            require([item for item in inventory(location) if item[0] != MARKER] == before,
                    'staged inventory changed')
            require(json.loads(regular(location / MARKER)) == marker, 'bootstrap marker changed')
            for fd, path in descriptors:
                info = os.fstat(fd)
                expected = (info.st_dev, info.st_ino, info.st_uid, stat.S_IMODE(info.st_mode))
                require(_clean_identity(path) == expected and
                        _clean_identity(location / path.name) == expected,
                        'guard hardlink identity changed')

        unchanged(stage)
        phase = 'publish'
        _publish_clean_root(stage, durable)
        published = True
        phase = 'parent_sync'
        fd = os.open(durable.parent, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        phase = 'verify'
        unchanged(durable)
        verify(durable)
        return marker
    except (OSError, ValueError, UnicodeError) as error:
        # Audit only: even a complete-looking marker after a failed fsync is
        # not an affirmative setup receipt. Never remove a competitor's path.
        record = {'schema_version': 1, 'protocol': 'phone-lock-clean-bootstrap/v1',
                  'state': 'failed', 'phase': phase, 'commit_unknown': published,
                  'stage': str(stage) if stage is not None else None,
                  'durable_root': str(durable), 'error': 'clean_bootstrap_failed',
                  'source_sha256': hashlib.sha256(json.dumps(before, separators=(',', ':')).encode()).hexdigest()
                  if before is not None else None}
        try:
            fd, name = tempfile.mkstemp(prefix='.phone-lock-bootstrap-failure-', suffix='.json', dir=durable.parent)
            with os.fdopen(fd, 'w', encoding='utf-8') as handle:
                os.fchmod(handle.fileno(), 0o600)
                json.dump(record, handle, sort_keys=True, separators=(',', ':'))
                handle.flush()
                os.fsync(handle.fileno())
            fd = os.open(durable.parent, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        except OSError:
            # Original failure remains a failure; evidence failure cannot mint
            # successful state or trigger destructive cleanup/retry.
            pass
        raise error
    finally:
        for fd, unused in descriptors:
            os.close(fd)


if __name__ == '__main__':
    try:
        if len(sys.argv) == 3 and sys.argv[1] == 'verify-root':
            verify_root(sys.argv[2])
        elif len(sys.argv) == 2 and sys.argv[1] == 'verify-production':
            print(json.dumps(verify(trusted_root()), sort_keys=True))
        elif len(sys.argv) == 2 and sys.argv[1] == 'bootstrap-clean-production':
            print(json.dumps(bootstrap_clean('/private/tmp/openclaw-phone/locks', trusted_root()), sort_keys=True))
        elif len(sys.argv) == 4 and sys.argv[1] == 'bootstrap-clean':
            print(json.dumps(bootstrap_clean(sys.argv[2], sys.argv[3]), sort_keys=True))
        elif len(sys.argv) == 2 and sys.argv[1] == 'migrate-production':
            print(json.dumps(migrate('/private/tmp/openclaw-phone/locks', trusted_root()), sort_keys=True))
        elif len(sys.argv) == 3 and sys.argv[1] == 'verify':
            print(json.dumps(verify(sys.argv[2]), sort_keys=True))
        elif len(sys.argv) == 4 and sys.argv[1] == 'check-serial':
            print(json.dumps(check_serial(sys.argv[2], sys.argv[3]), sort_keys=True))
        elif len(sys.argv) == 4 and sys.argv[1] == 'migrate':
            print(json.dumps(migrate(sys.argv[2], sys.argv[3]), sort_keys=True))
        elif len(sys.argv) == 4 and sys.argv[1] == 'verify-review':
            print(json.dumps(verify_review(sys.argv[2], sys.argv[3]), sort_keys=True))
        else:
            raise ValueError('usage: phone-lock-root.py verify-root ROOT | verify-production | bootstrap-clean-production | bootstrap-clean OLD_ROOT DURABLE_ROOT | migrate-production | verify ROOT | check-serial ROOT SERIAL | migrate OLD_ROOT DURABLE_ROOT | verify-review OLD_ROOT DURABLE_ROOT')
    except (OSError, ValueError, UnicodeError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
