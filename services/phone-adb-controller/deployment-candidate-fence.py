#!/usr/bin/env python3
"""隔离旧候选执行入口；失败回退也不重新开放冻结运行包。"""
import importlib.util
import ctypes
import json
import os
from pathlib import Path
import pwd
import stat
import sys

spec = importlib.util.spec_from_file_location('phone_transaction', Path(__file__).with_name('deployment-transaction.py'))
tx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tx)
require = tx.require


def paths(home, transaction):
    home = Path(home)
    tx.owned(home, transaction)
    parent = home / '.local/share/zenithjoy'
    roots = [parent / name for name in ('phone-candidates', 'phone-candidate-runs')]
    sealed = [parent / (path.name + '.sealed.' + transaction) for path in roots]
    for path in (home, parent, *parent.parents, *roots, *sealed):
        require(not path.is_symlink(), 'candidate fence symlink rejected')
    require(parent.is_dir() and parent.stat().st_uid == os.geteuid() and
            not (parent.stat().st_mode & 0o022), 'candidate fence parent unsafe')
    journal = tx.transaction_directory(home, transaction) / 'candidate-fence.json'
    return roots, sealed, journal


def read(journal):
    value = json.loads(tx.regular(journal)[0])
    require(value.get('schema_version') == 1 and value.get('state') == 'sealed' and
            isinstance(value.get('roots'), list) and len(value['roots']) == 2 and
            all(isinstance(row.get('root_inode'), int) and row['root_inode'] > 0 and
                isinstance(row.get('root_device'), int) and row['root_device'] >= 0
                for row in value['roots']),
            'candidate fence journal invalid')
    return value


def blocker(root, transaction, create=False):
    expected = ('PHONE_CANDIDATE_FENCE ' + transaction + '\n').encode()
    if create and not root.exists() and not root.is_symlink():
        fd = os.open(root, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(expected)
            stream.flush()
            os.fsync(stream.fileno())
        tx.sync_directory(root.parent)
    info = root.lstat()
    require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and
            info.st_uid == os.geteuid() and tx.regular(root)[0] == expected,
            'candidate execution blocker changed')


def exchange(source, destination):
    """候选目录与预置阻挡文件由内核原子交换，启动路径从未暴露空窗。"""
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        result = libc.renamex_np(os.fsencode(source), os.fsencode(destination), 2)
    elif sys.platform.startswith('linux'):
        result = libc.renameat2(-100, os.fsencode(source), -100, os.fsencode(destination), 2)
    else:
        raise ValueError('candidate fence atomic exchange unsupported')
    if result:
        number = ctypes.get_errno()
        raise OSError(number, os.strerror(number))


def verify(home, transaction):
    roots, sealed, journal = paths(home, transaction)
    value = read(journal)
    for root, destination, row in zip(roots, sealed, value['roots']):
        require(row['sealed_path'] == str(destination) and row['root_path'] == str(root),
                'candidate fence identity mismatch')
        blocker(root, transaction)
        require(destination.is_dir() and not destination.is_symlink(), 'sealed candidate missing')
        info = destination.stat()
        require((info.st_dev, info.st_ino) == (row['root_device'], row['root_inode']) and
                info.st_uid == os.geteuid() and not (info.st_mode & 0o022),
                'sealed candidate inode or ownership changed')
    return value


def seal(home, transaction):
    roots, sealed, journal = paths(home, transaction)
    if journal.exists():
        value = read(journal)
    else:
        rows = []
        for root, destination in zip(roots, sealed):
            require(root.is_dir() and not root.is_symlink() and not destination.exists() and
                    not destination.is_symlink(), 'frozen candidate root unavailable or already sealed')
            info = root.stat()
            require(info.st_uid == os.geteuid() and not (info.st_mode & 0o022),
                    'frozen candidate ownership unsafe')
            rows.append({'root_path':str(root), 'sealed_path':str(destination),
                         'root_device':info.st_dev, 'root_inode':info.st_ino})
        value = {'schema_version':1, 'state':'sealed', 'roots':rows}
        tx.atomic_bytes(journal, tx.canonical(value))
    for root, destination, row in zip(roots, sealed, value['roots']):
        require(row['root_path'] == str(root) and row['sealed_path'] == str(destination),
                'candidate fence identity mismatch')
        if root.is_dir() and not root.is_symlink():
            info = root.stat()
            require((info.st_dev, info.st_ino) == (row['root_device'], row['root_inode']),
                    'candidate fence source changed')
            blocker(destination, transaction, create=True)
            exchange(root, destination)
            tx.sync_directory(root.parent)
        blocker(root, transaction)
    return verify(home, transaction)


if __name__ == '__main__':
    try:
        action, transaction = sys.argv[1:3]
        home = Path(pwd.getpwuid(os.getuid()).pw_dir).resolve()
        require(action in ('seal', 'verify', 'seal-if-review', 'verify-if-review'),
                'invalid candidate fence action')
        if action.endswith('-if-review'):
            spec = importlib.util.spec_from_file_location('phone_maintenance', Path(__file__).with_name('deployment-maintenance.py'))
            maintenance = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(maintenance)
            admission = maintenance.verify(home, transaction,
                                           home/'.config/openclaw/douyin-phone-profiles.tsv',
                                           home/'.local/share/zenithjoy/phone-locks')
            result = globals()[action.split('-')[0]](home, transaction) if admission['mode'] == 'review-preserve' else {'skipped':True}
        else:
            result = globals()[action](home, transaction)
        print(json.dumps({'transaction':transaction, 'verified':bool(result.get('state') == 'sealed'),
                          'skipped':bool(result.get('skipped'))}, sort_keys=True))
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
