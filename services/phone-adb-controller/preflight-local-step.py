#!/usr/bin/env python3
"""Fixed preflight local leaf: pure parsing; no subprocess or executable dispatch."""
import json
import types
import tempfile
import contextlib
import io
import os
import time
import stat
import fcntl
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET


def ui_facts(text):
    if len(text.encode('utf8')) > 5 * 1024 * 1024 or '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
        raise ValueError('PREFLIGHT_UI_INVALID')
    root = ET.fromstring(text)
    if root.tag != 'hierarchy':
        raise ValueError('PREFLIGHT_UI_INVALID')
    nodes = list(root.iter('node'))
    ids = [n.attrib.get('text', '')[4:] for n in nodes if n.attrib.get('text', '').startswith('抖音号：')]
    foreign = any(n.attrib.get('content-desc') == '私信' for n in nodes)
    own = any(n.attrib.get('text') == '编辑主页' or n.attrib.get('content-desc', '').startswith('切换账号') for n in nodes)
    kind = 'none' if not ids else 'foreign' if foreign else 'own' if own else 'partial'
    account = None
    if kind == 'own':
        if len(ids) != 1 or not ids[0] or '\n' in ids[0] or '\r' in ids[0]:
            raise ValueError('PREFLIGHT_ACCOUNT_AMBIGUOUS')
        account = {'douyin_id': ids[0], 'nickname': 'unknown'}
    matches = [n for n in nodes if n.attrib.get('content-desc') == '我，按钮']
    if len(matches) > 1:
        raise ValueError('PREFLIGHT_ME_AMBIGUOUS')
    me = None
    if matches:
        b = re.fullmatch(r'\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]', matches[0].attrib.get('bounds', ''))
        if not b:
            raise ValueError('PREFLIGHT_ME_BOUNDS')
        x1, y1, x2, y2 = map(int, b.groups())
        if not (0 <= x1 < x2 <= 10000 and 0 <= y1 < y2 <= 10000):
            raise ValueError('PREFLIGHT_ME_BOUNDS')
        me = {'x': (x1+x2)//2, 'y': (y1+y2)//2}
    return {'kind': kind, 'account': account, 'me': me}



def is_canonical_tcp_serial(value):
    return peer('phone-lock-root').is_canonical_tcp_serial(value)


def lock_record(root, serial, operation, owner, epoch, receipt=None, precondition=None):
    """Caller validates migrated root; all writers share the existing fcntl guard."""
    if not (re.fullmatch(r'[A-Za-z0-9._-]{1,80}', serial) or is_canonical_tcp_serial(serial)) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{1,119}', owner) or re.fullmatch(r'(?:a|attempt)[0-9]+', owner):
        raise ValueError('PREFLIGHT_LOCK_SCOPE')
    if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', epoch):
        raise ValueError('PREFLIGHT_LOCK_EPOCH')
    root = Path(root)
    if not root.is_absolute() or root.resolve() != root or root.is_symlink() or root.stat().st_uid != os.geteuid() or stat.S_IMODE(root.stat().st_mode) != 0o700:
        raise ValueError('PREFLIGHT_LOCK_ROOT')
    fd = os.open(root / (serial+'.guard'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    succeeded = False
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError('PREFLIGHT_LOCK_GUARD')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        lock = root / (serial+'.lock')
        if operation == 'acquire' and precondition is not None:
            precondition()
        def sync_dir(path):
            directory_fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)

        def private_value(path):
            field_fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(field_fd) as handle:
                info = os.fstat(handle.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 1024:
                    raise ValueError('PREFLIGHT_LOCK_FIELD')
                return handle.read(1024).strip()

        if operation == 'acquire':
            # Publish all fields and the persistent old-reader barrier together.
            # A parent crash must never expose an apparently reclaimable lock.
            if lock.exists() or lock.is_symlink():
                raise FileExistsError('PREFLIGHT_LOCK_EXISTS')
            staged = Path(tempfile.mkdtemp(prefix='.preflight-stage-', dir=root))
            try:
                fields = [('standalone_review_required', owner), ('owner', owner), ('preflight_epoch', epoch),
                          ('preflight_proof_required', epoch), ('acquired_at', str(int(time.time())))]
                for name, value in fields:
                    out = os.open(staged / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                    with os.fdopen(out, 'w') as handle:
                        handle.write(value+'\n');handle.flush();os.fsync(handle.fileno())
                sync_dir(staged)
                if lock.exists() or lock.is_symlink():
                    raise FileExistsError('PREFLIGHT_LOCK_EXISTS')
                os.rename(staged, lock)
                sync_dir(root)
            finally:
                if staged.exists():
                    for path in staged.iterdir():
                        path.unlink()
                    staged.rmdir()
            succeeded = True
            return {'lock': 'acquired', 'owner': owner, 'epoch': epoch, 'readback_owner': private_value(lock / 'owner'), 'readback_epoch': private_value(lock / 'preflight_epoch')}
        if operation not in ('refresh', 'release', 'quarantine') or lock.is_symlink() or not lock.is_dir():
            raise ValueError('PREFLIGHT_LOCK_NOT_RENEWABLE')
        if private_value(lock / 'owner') != owner:
            raise ValueError('PREFLIGHT_LOCK_OWNER')
        if private_value(lock / 'preflight_epoch') != epoch or private_value(lock / 'preflight_proof_required') != epoch:
            raise ValueError('PREFLIGHT_LOCK_EPOCH')
        if private_value(lock / 'standalone_review_required') != owner:
            raise ValueError('PREFLIGHT_LOCK_MARKER')
        quarantine = lock / 'preflight_quarantined'
        if operation == 'quarantine':
            if quarantine.exists():
                if private_value(quarantine) != epoch:
                    raise ValueError('PREFLIGHT_LOCK_QUARANTINE_EPOCH')
            else:
                out = os.open(quarantine, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(out, 'w') as handle:
                    handle.write(epoch+'\n');handle.flush();os.fsync(handle.fileno())
                sync_dir(lock)
            succeeded = True
            return {'lock': 'quarantined', 'owner': owner, 'epoch': epoch, 'review_required': True,
                    'readback_owner': private_value(lock / 'owner'), 'readback_epoch': private_value(lock / 'preflight_epoch')}
        if quarantine.exists() or quarantine.is_symlink():
            raise ValueError('PREFLIGHT_LOCK_QUARANTINED')
        if operation == 'release':
            names = {'owner', 'preflight_epoch', 'acquired_at', 'standalone_review_required', 'preflight_proof_required'}
            if {p.name for p in lock.iterdir()} != names:
                raise ValueError('PREFLIGHT_LOCK_INVENTORY')
            for name in names:
                info = (lock / name).lstat()
                if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600:
                    raise ValueError('PREFLIGHT_LOCK_INVENTORY')
            retired = Path(tempfile.mkdtemp(prefix='.preflight-release-', dir=root))
            os.rename(lock, retired)
            sync_dir(root)
            for name in names:
                (retired / name).unlink()
            retired.rmdir()
            sync_dir(root)
            if lock.exists() or lock.is_symlink():
                raise ValueError('PREFLIGHT_LOCK_RELEASE_READBACK')
            succeeded = True
            return {'lock': 'released', 'owner': owner, 'epoch': epoch, 'readback_owner': 'none', 'readback_epoch': 'none'}
        out = os.open(lock / 'acquired_at', os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW)
        with os.fdopen(out, 'w') as handle:
            handle.write(str(int(time.time()))+'\n');handle.flush();os.fsync(handle.fileno())
        succeeded = True
        return {'lock': 'refreshed', 'owner': owner, 'epoch': epoch, 'readback_owner': (lock / 'owner').read_text().strip(), 'readback_epoch': (lock / 'preflight_epoch').read_text().strip()}
    finally:
        try:
            if receipt is not None:
                path = Path(receipt['path'])
                kind = operation if operation in ('acquire', 'release', 'quarantine') else 'refresh'
                if not path.is_absolute() or path.name != owner+'-lock-'+kind+'.json' or receipt['run'] != owner or receipt['serial'] != serial:
                    raise ValueError('PREFLIGHT_LOCK_RECEIPT_SCOPE')
                readback_owner = 'none' if succeeded and operation == 'release' else 'unknown'
                if (root / (serial+'.lock')).is_dir():
                    owner_fd = os.open(root / (serial+'.lock') / 'owner', os.O_RDONLY | os.O_NOFOLLOW)
                    with os.fdopen(owner_fd) as handle:
                        readback_owner = handle.read(1024).strip()
                state = 'none' if readback_owner == 'none' else 'held' if readback_owner != 'unknown' else 'unknown'
                old_argv = sys.argv
                try:
                    sys.argv = [__file__, 'lock-receipt', str(path), kind, owner, owner+'-lock-'+kind,
                                'command=lock-'+operation, 'requested_owner='+owner, 'rc='+str(0 if succeeded else 2),
                                'receipt=lock='+('acquired' if operation=='acquire' else 'released' if operation=='release' else 'quarantined' if operation=='quarantine' else 'refreshed')+' owner='+owner if succeeded else 'receipt=',
                                'stderr=' if succeeded else 'stderr=PREFLIGHT_LOCK_REFUSED',
                                'readback=lock='+state+' owner='+readback_owner, 'profile='+receipt['profile'], 'serial='+serial,
                                'pid='+str(os.getpid()), 'epoch='+epoch]
                    with contextlib.redirect_stdout(io.StringIO()):
                        peer('phone-lock-helper').lock_receipt()
                finally:
                    sys.argv = old_argv
        finally:
            os.close(fd)


def peer(name):
    if name not in ('phone-lock-root', 'phone-lock-helper', 'adb-existing-route'):
        raise ValueError('PREFLIGHT_PEER_SCOPE')
    path = Path(__file__).parent / (name + '.py')
    module = types.ModuleType('preflight_' + name.replace('-', '_'))
    module.__file__ = str(path)
    # The parent pins these exact source files. Never substitute a timestamp-valid
    # bytecode cache which is outside the frozen source inventory.
    exec(compile(path.read_bytes(), str(path), 'exec'), module.__dict__)
    return module


def main():
    operation = sys.argv[1:]
    body = sys.stdin.read(5*1024*1024+1)
    if operation == ['ui']:
        result = ui_facts(body)
    elif operation == ['lock']:
        request = json.loads(body)
        if set(request) != {'root', 'serial', 'operation', 'owner', 'epoch', 'receipt'} or request['receipt'] is None:
            raise ValueError('PREFLIGHT_LOCK_SCOPE')
        roots = peer('phone-lock-root')
        roots.verify_root(request['root'])
        result = lock_record(request['root'], request['serial'], request['operation'], request['owner'], request['epoch'], request['receipt'],
                             precondition=lambda: roots.check_serial(request['root'], request['serial']))
    elif operation == ['route']:

        request = json.loads(body)
        if set(request) != {'config', 'policy', 'serial'}:
            raise ValueError('PREFLIGHT_ROUTE_SCOPE')
        route = peer('adb-existing-route')
        policy = route.read_host_policy(request['config'])
        if {k: v for k, v in policy.items() if k != 'port'} != request['policy']:
            raise ValueError('PREFLIGHT_ROUTE_POLICY')
        result = route.inspect_managed_host(policy)
        targets = [row for row in result['devices'] if row['serial'] == request['serial']]
        if len(targets) != 1 or targets[0]['state'] != 'device':
            raise ValueError('PREFLIGHT_ROUTE_DEVICE')
    else:
        raise ValueError('PREFLIGHT_LOCAL_OPERATION')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('PREFLIGHT_LOCAL_INVALID', file=sys.stderr)
        sys.exit(2)
