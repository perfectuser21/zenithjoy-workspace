#!/usr/bin/env python3
"""手机部署本机恢复日志。准入锁与 Brain 证明由固定源协调器持有。"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

STATE = '.local/share/zenithjoy/phone-transactions'
ROOTS = ('bin-harvest/', '.local/bin/', '.openclaw/leadgen-scripts/',
         '.openclaw/commander/', 'openclaw-root/workspaces-root/clawd-work-commander/skills/')
EXACT = {'bin/escort-claude-escalation.sh', 'bin/log-bridge-liveness.sh',
         '.openclaw/cmdr-escort.txt', '.openclaw/cmdr-stream.txt',
         '.codex-team1/skills/multi-platform-publish', '.openclaw/skills/multi-platform-publish',
         'openclaw-root/workspaces-root/clawd-work-commander/AGENTS.md'}


def require(ok, message):
    if not ok:
        raise ValueError('phone transaction: ' + message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def safe_path(home, relative, leaf_link=False):
    home = Path(home)
    require(home.is_absolute() and home.resolve(strict=True) == home, 'canonical home required')
    require(isinstance(relative, str) and relative and not relative.startswith('/') and
            all(part not in ('', '.', '..') for part in relative.split('/')), 'invalid path')
    result = home / relative
    for path in [home, *list(result.relative_to(home).parents)]:
        if path != home:
            path = home / path
        require(not path.is_symlink(), 'symlink parent rejected')
    require(leaf_link or not result.is_symlink(), 'symlink path rejected')
    return result


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_bytes(path, data, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temp = tempfile.mkstemp(prefix='.phone-write-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(data)
            out.flush()
            os.fchmod(out.fileno(), mode)
            os.fsync(out.fileno())
        os.replace(temp, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def regular(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= 32 * 1024 * 1024, 'bounded regular file required')
        chunks = []
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            chunks.append(chunk)
        after = os.fstat(fd)
        named = path.lstat()
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) and
                (named.st_dev, named.st_ino) == (after.st_dev, after.st_ino), 'file changed during read')
        return b''.join(chunks), stat.S_IMODE(before.st_mode)
    finally:
        os.close(fd)


def describe(path):
    if path.is_symlink():
        return {'kind': 'symlink', 'target': os.readlink(path)}
    if not path.exists():
        return {'kind': 'missing'}
    data, mode = regular(path)
    return {'kind': 'file', 'sha256': digest(data), 'mode': mode}


def transaction_directory(home, transaction):
    require(isinstance(transaction, str) and re.fullmatch('[A-Za-z0-9][A-Za-z0-9_-]{0,99}', transaction), 'invalid transaction')
    return safe_path(home, STATE + '/' + transaction)


def record_path(home, relative):
    require(relative in EXACT or any(relative.startswith(root) for root in ROOTS), 'path outside deployment write set')
    require(not any(part.startswith('.') for part in relative.split('/')[2:]) and
            not relative.endswith(('.lock', '.deploying')) and '/node_modules/' not in relative,
            'runtime state/lock path forbidden')
    return safe_path(home, relative, leaf_link=True)


def validate_description(value):
    require(isinstance(value, dict), 'invalid file description')
    if value.get('kind') == 'file':
        require(set(value) == {'kind', 'sha256', 'mode'} and re.fullmatch('[a-f0-9]{64}', value.get('sha256', '')) and
                type(value.get('mode')) is int and 0 <= value['mode'] <= 0o777, 'invalid file hash/mode')
    elif value.get('kind') == 'missing':
        require(value == {'kind': 'missing'}, 'invalid missing file')
    elif value.get('kind') == 'symlink':
        require(set(value) == {'kind', 'target'} and isinstance(value['target'], str) and
                0 < len(value['target']) <= 4096 and '\x00' not in value['target'], 'invalid symlink')
    else:
        raise ValueError('phone transaction: unsupported file kind')


def save(directory, record):
    content = {**record}
    content.pop('sha256', None)
    content['sha256'] = digest(canonical(content))
    atomic_bytes(directory / 'journal.json', canonical(content))
    return content


def read_transaction(home, transaction):
    directory = transaction_directory(home, transaction)
    value = json.loads(regular(directory / 'journal.json')[0])
    body = {k: v for k, v in value.items() if k != 'sha256'}
    require(value.get('sha256') == digest(canonical(body)) and value.get('transaction') == transaction and
            value.get('home') == str(home) and value.get('schema_version') == 1, 'journal identity/digest mismatch')
    require(value.get('phase') in ('prepared', 'restoring', 'restored', 'committed', 'released'), 'invalid journal phase')
    require(isinstance(value.get('entries'), list) and 0 < len(value['entries']) <= 3000, 'bounded write set required')
    seen = set()
    for entry in value['entries']:
        record_path(home, entry['path'])
        require(entry['path'] not in seen, 'duplicate journal destination')
        seen.add(entry['path'])
        for name in ('before', 'after'):
            validate_description(entry[name])
        if entry['before']['kind'] == 'file':
            blob = safe_path(home, STATE + '/' + transaction + '/blobs/' + entry['before']['sha256'])
            require(digest(regular(blob)[0]) == entry['before']['sha256'], 'snapshot hash mismatch')
    return value


def active_file(home):
    return safe_path(home, STATE + '/active.json')


def owned(home, transaction):
    require(json.loads(regular(active_file(home))[0]).get('transaction') == transaction, 'pending owner conflict')


def prepare(home, transaction, entries, identity):
    directory = transaction_directory(home, transaction)
    require(identity.get('target') in ('mmv', 'xian-m4') and
            all(re.fullmatch('[a-f0-9]{40}', identity.get(k, '')) for k in ('source_commit', 'previous_source_commit')) and
            all(re.fullmatch('[a-f0-9-]{36}', identity.get(k, '')) for k in ('release_id', 'previous_release_id')), 'release identity required')
    if (directory / 'journal.json').exists():
        old = read_transaction(home, transaction)
        require(old['identity'] == identity and [{k: v for k, v in e.items() if k != 'before'} for e in old['entries']] == entries,
                'reused transaction identity mismatch')
        if not active_file(home).exists():
            require(old['phase'] == 'prepared' and all(describe(record_path(home, e['path'])) == e['before'] for e in old['entries']),
                    'missing admission marker after write; preserve recovery evidence')
            atomic_bytes(active_file(home), canonical({'transaction': transaction}))
        owned(home, transaction)
        return old
    active = active_file(home)
    require(not active.exists(), 'pending transaction requires recovery')
    require(isinstance(entries, list) and 0 < len(entries) <= 3000, 'bounded write set required')
    rows = []
    seen = set()
    # Validate the entire write set before creating a snapshot or admission marker.
    for entry in entries:
        require(set(entry) == {'path', 'after'} and entry['path'] not in seen, 'invalid/duplicate destination')
        path = record_path(home, entry['path'])
        validate_description(entry['after'])
        seen.add(entry['path'])
        rows.append({**entry, 'before': describe(path)})
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    blobs = directory / 'blobs'
    blobs.mkdir(mode=0o700, exist_ok=True)
    for entry in rows:
        if entry['before']['kind'] == 'file':
            data, _ = regular(record_path(home, entry['path']))
            require(digest(data) == entry['before']['sha256'], 'snapshot source changed')
            atomic_bytes(blobs / digest(data), data)
    record = {'schema_version': 1, 'transaction': transaction, 'home': str(home),
              'identity': identity, 'phase': 'prepared', 'entries': rows}
    result = save(directory, record)
    sync_directory(directory.parent)
    # No deployment is authorized until both the complete snapshot and marker are durable.
    atomic_bytes(active, canonical({'transaction': transaction}))
    return result


def restore_entry(home, directory, entry):
    path = record_path(home, entry['path'])
    current = describe(path)
    require(current in (entry['before'], entry['after']), 'restore writer conflict: ' + entry['path'])
    if current == entry['before']:
        return
    previous = entry['before']
    if previous['kind'] == 'file':
        data = regular(directory / 'blobs' / previous['sha256'])[0]
        require(digest(data) == previous['sha256'], 'snapshot hash mismatch')
        atomic_bytes(path, data, previous['mode'])
    elif previous['kind'] == 'missing':
        path.unlink()
        sync_directory(path.parent)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.parent / ('.phone-link-' + str(os.getpid()))
        os.symlink(previous['target'], temp)
        try:
            os.replace(temp, path)
            sync_directory(path.parent)
        finally:
            if temp.is_symlink():
                temp.unlink()
    require(describe(path) == previous, 'restoration readback failed')


def rollback(home, transaction, explicit=False):
    record = read_transaction(home, transaction)
    owned(home, transaction)
    require(record['phase'] not in ('committed', 'released') or explicit, 'committed release requires explicit rollback')
    # A conflict anywhere preserves every file. A crash after this pass remains resumable.
    for entry in record['entries']:
        require(describe(record_path(home, entry['path'])) in (entry['before'], entry['after']), 'restore writer conflict: ' + entry['path'])
    directory = transaction_directory(home, transaction)
    record['phase'] = 'restoring'
    save(directory, record)
    for entry in reversed(record['entries']):
        restore_entry(home, directory, entry)
    record['phase'] = 'restored'
    return save(directory, record)


def commit(home, transaction):
    record = read_transaction(home, transaction)
    owned(home, transaction)
    require(record['phase'] in ('prepared', 'committed'), 'cannot commit restored release')
    for entry in record['entries']:
        require(describe(record_path(home, entry['path'])) == entry['after'], 'installed write set mismatch: ' + entry['path'])
    record['phase'] = 'committed'
    return save(transaction_directory(home, transaction), record)


def authorize(home, transaction, relative, after):
    """仅受信观察器在实际ACK落文件前，补记其准确新字节；旧快照永不覆盖。"""
    record = read_transaction(home, transaction)
    owned(home, transaction)
    require(record['phase'] == 'prepared', 'write authorization requires prepared transaction')
    matches = [e for e in record['entries'] if e['path'] == relative]
    require(len(matches) == 1, 'destination not in frozen write set')
    entry = matches[0]
    require(describe(record_path(home, relative)) in (entry['before'], entry['after']), 'authorize writer conflict')
    validate_description(after)
    entry['after'] = after
    return save(transaction_directory(home, transaction), record)


def release(home, transaction, release_id):
    """协调器真实回读两机观测后才能调用；本机只检查恢复方向及最终字节。"""
    record = read_transaction(home, transaction)
    require(record['phase'] in ('committed', 'restored', 'released'), 'final installed/restored state required')
    restored = record['phase'] == 'restored' or record.get('released_direction') == 'restored'
    expected = record['identity']['previous_release_id' if restored else 'release_id']
    require(expected == release_id, 'release authority does not match restoration direction')
    for entry in record['entries']:
        require(describe(record_path(home, entry['path'])) == entry['before' if restored else 'after'], 'final release bytes mismatch')
    active = active_file(home)
    if record['phase'] == 'released' and not active.exists():
        return record
    owned(home, transaction)
    record.update(phase='released', released_direction='restored' if restored else 'committed')
    result = save(transaction_directory(home, transaction), record)
    active.unlink()
    sync_directory(active.parent)
    return result


if __name__ == '__main__':
    try:
        action, transaction = sys.argv[1:3]
        home = Path.home().resolve()
        if action == 'prepare':
            data = json.load(sys.stdin)
            result = prepare(home, transaction, data['entries'], data['identity'])
        elif action == 'status':
            result = read_transaction(home, transaction)
        elif action == 'commit':
            result = commit(home, transaction)
        elif action == 'authorize':
            data = json.load(sys.stdin)
            result = authorize(home, transaction, data['path'], data['after'])
        elif action == 'release':
            result = release(home, transaction, sys.argv[3])
        elif action in ('recover', 'rollback'):
            result = rollback(home, transaction, explicit=action == 'rollback')
        else:
            raise ValueError('unknown transaction action')
        print(json.dumps(result))
    except (OSError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
