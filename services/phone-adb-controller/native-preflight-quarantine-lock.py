#!/usr/bin/env python3
"""私有双根guard与隔离目录CAS。无手机、网络、中央释放或旧活动恢复入口。"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tarfile


def need(ok, code):
    if not ok:
        raise ValueError('PREFLIGHT_REVIEW_' + code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    path = Path(path)
    need(path.is_absolute() and path.resolve() == path, 'PATH')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        a = os.fstat(fd)
        need(stat.S_ISREG(a.st_mode) and a.st_uid == os.geteuid() and a.st_nlink == 1
             and not a.st_mode & 0o022 and a.st_size <= 64 * 1024 * 1024, 'FILE')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            raw = stream.read(64 * 1024 * 1024 + 1)
        b, c = os.fstat(fd), path.lstat()
        need(len(raw) == a.st_size and all(getattr(a, k) == getattr(b, k) == getattr(c, k)
             for k in ['st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns']), 'FILE_DRIFT')
        return raw
    finally:
        os.close(fd)


def directory(path, private=False):
    path = Path(path)
    need(path.is_absolute() and path.resolve() == path, 'DIRECTORY')
    s = path.lstat()
    need(stat.S_ISDIR(s.st_mode) and s.st_uid == os.geteuid() and not s.st_mode & 0o022
         and (not private or stat.S_IMODE(s.st_mode) == 0o700), 'DIRECTORY')
    return s


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def durable(path, value):
    raw = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        offset = 0
        while offset < len(raw):
            written = os.write(fd, raw[offset:])
            need(written > 0, 'DURABLE_WRITE')
            offset += written
        os.fsync(fd)
    finally:
        os.close(fd)
    sync(path.parent)


def archive_manifest(path):
    raw = read(path)
    files, seen, total = {}, set(), 0
    with tarfile.open(fileobj=__import__('io').BytesIO(raw), mode='r:*') as archive:
        for member in archive.getmembers():
            name = member.name.rstrip('/')
            need(re.fullmatch(r'[A-Za-z0-9_.:-]+(?:/[A-Za-z0-9_.:-]+)*', name or '')
                 and all(p not in ('.', '..') for p in name.split('/'))
                 and name not in seen and (member.isfile() or member.isdir()), 'ARCHIVE_TYPE')
            seen.add(name)
            need(len(seen) <= 12000, 'ARCHIVE_LIMIT')
            need(name == 'ledger' or name.startswith('ledger/'), 'ARCHIVE_SCOPE')
            if member.isfile():
                total += member.size
                need(0 <= member.size <= 64 * 1024 * 1024 and len(files) < 10000
                     and total <= 256 * 1024 * 1024, 'ARCHIVE_LIMIT')
                data = archive.extractfile(member).read(64 * 1024 * 1024 + 1)
                need(len(data) == member.size, 'ARCHIVE_SIZE')
                files[name[7:]] = {'sha256': digest(data), 'bytes': len(data)}
    need(files, 'ARCHIVE_EMPTY')
    return {'sha256': digest(raw), 'files': files}


class Transaction:
    def __init__(self, root, serial, review_id):
        self.root = Path(root)
        need(re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}', serial or '') and serial not in ('.', '..')
             and re.fullmatch(r'[a-f0-9-]{36}', review_id or ''), 'SCOPE')
        self.serial, self.review_id = serial, review_id
        self.marker = read(self.root / '.migration-complete.json')
        marker = json.loads(self.marker)
        need(marker.get('schema_version') == 1 and marker.get('state') == 'complete', 'MIGRATION')
        self.legacy = Path(marker['legacy_root'])
        need(self.legacy != self.root, 'MIGRATION_ROOT')
        self.roots = [(p, directory(p, p == self.root)) for p in [self.root, self.legacy]]
        self.paths = [p / (serial + '.guard') for p, _ in self.roots]
        self.fd = os.open(self.paths[0], os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        self.original_guard = os.fstat(self.fd)
        fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.assert_guard()
        self.journal = self.root / ('.native-preflight-review-' + review_id)
        self.active = self.root / (serial + '.lock')
        self.retired = self.root / ('.native-preflight-review-' + review_id + '.superseded')

    def assert_guard(self):
        need(read(self.root / '.migration-complete.json') == self.marker, 'MARKER_DRIFT')
        for root, original in self.roots:
            current = directory(root, root == self.root)
            need((current.st_dev, current.st_ino) == (original.st_dev, original.st_ino), 'ROOT_DRIFT')
        for path in self.paths:
            s = path.lstat()
            need(path.resolve() == path and stat.S_ISREG(s.st_mode) and s.st_uid == os.geteuid()
                 and stat.S_IMODE(s.st_mode) == 0o600 and s.st_size == 0 and s.st_nlink == 2
                 and (s.st_dev, s.st_ino) == (self.original_guard.st_dev, self.original_guard.st_ino), 'GUARD_DRIFT')
        need((os.fstat(self.fd).st_dev, os.fstat(self.fd).st_ino) ==
             (self.original_guard.st_dev, self.original_guard.st_ino), 'GUARD_FD')
        fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def snapshot(self, path):
        s = directory(path, True)
        names = {'owner', 'acquired_at', 'standalone_review_required', 'preflight_epoch',
                 'preflight_proof_required', 'preflight_quarantined'}
        need({p.name for p in path.iterdir()} == names, 'LOCK_INVENTORY')
        fields = {name: read(path / name).decode() for name in sorted(names)}
        need(re.fullmatch(r'[0-9]+\n', fields['acquired_at']) and
             fields['owner'] == fields['standalone_review_required'] and
             fields['preflight_epoch'] == fields['preflight_proof_required'] == fields['preflight_quarantined'], 'LOCK_FIELDS')
        return {'dev': s.st_dev, 'ino': s.st_ino, 'fields': fields}

    def checkpoint(self, callback):
        self.assert_guard()
        callback()
        self.assert_guard()

    def journal_ready(self):
        if not self.journal.exists():
            self.journal.mkdir(mode=0o700)
            sync(self.root)
        directory(self.journal, True)
        need({p.name for p in self.journal.iterdir()} <= {'plan.json', 'apply.intent.json', 'apply.returned.json'}, 'JOURNAL_INVENTORY')

    def plan(self, value, callback):
        self.checkpoint(callback)
        self.journal_ready()
        wanted = {'protocol': 'native-preflight-quarantine-review/v1', 'review_task_id': self.review_id,
                  'facts': value, 'lock': self.snapshot(self.active if self.active.exists() else self.retired),
                  'retired_path': str(self.retired), 'original_execution_stopped': False}
        need(self.active.exists() != self.retired.exists(), 'LOCK_LOCATION')
        if (self.journal / 'plan.json').exists():
            prior = json.loads(read(self.journal / 'plan.json'))
            need(prior == wanted, 'PLAN_DRIFT')
            if self.retired.exists():
                need((self.journal / 'apply.intent.json').exists(), 'RETIRED_WITHOUT_INTENT')
            return prior
        need(self.active.exists() and not self.retired.exists(), 'PLAN_ORIGINAL_REQUIRED')
        self.checkpoint(callback)
        durable(self.journal / 'plan.json', wanted)
        return wanted

    def apply(self, value, callback):
        self.checkpoint(callback)
        self.journal_ready()
        plan = json.loads(read(self.journal / 'plan.json'))
        need(plan.get('facts') == value and plan.get('review_task_id') == self.review_id
             and plan.get('protocol') == 'native-preflight-quarantine-review/v1'
             and plan.get('original_execution_stopped') is False and plan.get('retired_path') == str(self.retired), 'PLAN_DRIFT')
        expected = {'protocol': plan['protocol'], 'plan_sha256': digest(read(self.journal / 'plan.json')),
                    'review_task_id': self.review_id, 'original_execution_stopped': False}
        intent = self.journal / 'apply.intent.json'
        if intent.exists():
            need(json.loads(read(intent)) == expected, 'INTENT_DRIFT')
        else:
            need(self.active.exists() and not self.retired.exists() and not
                 (self.journal / 'apply.returned.json').exists(), 'INTENT_REQUIRED')
            self.checkpoint(callback)
            durable(intent, expected)
        need(self.active.exists() != self.retired.exists(), 'LOCK_LOCATION')
        if self.active.exists():
            need(not (self.journal / 'apply.returned.json').exists() and self.snapshot(self.active) == plan['lock'], 'LOCK_DRIFT')
            self.checkpoint(callback)
            need(self.snapshot(self.active) == plan['lock'], 'LOCK_DRIFT')
            os.rename(self.active, self.retired)
            sync(self.root)
        self.checkpoint(callback)
        need(not self.active.exists() and self.snapshot(self.retired) == plan['lock'], 'RETIRED_DRIFT')
        # 双根实际读回：legacy中不得残留该serial活动owner。
        need(not (self.legacy / (self.serial + '.lock')).exists(), 'LEGACY_OWNER')
        result = {**expected, 'state': 'superseded', 'retired_path': str(self.retired),
                  'local_readback': {'durable_free': True, 'legacy_free': True}, 'central_write_performed': False}
        returned = self.journal / 'apply.returned.json'
        if returned.exists():
            need(json.loads(read(returned)) == result, 'RETURNED_DRIFT')
        else:
            self.checkpoint(callback)
            durable(returned, result)
        self.assert_guard()
        return result

    def close(self):
        os.close(self.fd)


def main():
    if len(sys.argv) == 3 and sys.argv[1] == 'archive':
        print(json.dumps(archive_manifest(sys.argv[2]), sort_keys=True))
        return
    need(len(sys.argv) == 5 and sys.argv[1] == 'serve', 'PRIVATE_USAGE')
    tx = Transaction(sys.argv[2], sys.argv[3], sys.argv[4])
    def emit(value):
        print(json.dumps(value, sort_keys=True), flush=True)
    def checkpoint():
        emit({'event': 'checkpoint'})
        value = json.loads(sys.stdin.readline())
        need(value == {'authorize': True}, 'CHECKPOINT_DENIED')
    try:
        emit({'event': 'locked'})
        for raw in sys.stdin:
            request = json.loads(raw)
            need(set(request) == {'op', 'facts'} and request['op'] in ['plan', 'apply'], 'PRIVATE_OPERATION')
            result = getattr(tx, request['op'])(request['facts'], checkpoint)
            emit({'event': 'returned', 'value': result})
    finally:
        tx.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'PREFLIGHT_REVIEW_LOCAL_IO_UNKNOWN', file=sys.stderr)
        sys.exit(2)
