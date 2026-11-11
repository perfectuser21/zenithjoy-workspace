#!/usr/bin/env python3
"""内部文件事务机制，不产生停止或网络授权。仅受审Node维护controller持有stdin能力。"""
import fcntl
import hashlib
import json
import importlib.util
import marshal
import struct
import os
from pathlib import Path
import re
import signal
import stat
import sys


def need(value, code):
    if not value:
        raise ValueError('EPOCH_LOCK_' + code)


def raw_file(path, limit=65536):
    need(path.resolve(strict=True) == path and not path.is_symlink(), 'PATH')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        s = os.fstat(fd)
        need(stat.S_ISREG(s.st_mode) and s.st_uid == os.geteuid() and s.st_nlink == 1
             and not s.st_mode & 0o022 and s.st_size <= limit, 'FILE')
        raw = os.read(fd, limit + 1)
        e = os.fstat(fd)
        need(len(raw) == s.st_size and (s.st_dev, s.st_ino, s.st_mtime_ns, s.st_ctime_ns)
             == (e.st_dev, e.st_ino, e.st_mtime_ns, e.st_ctime_ns), 'FILE_DRIFT')
        return raw
    finally:
        os.close(fd)


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_once(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        raw = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
        with os.fdopen(fd, 'wb', closefd=False) as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(fd)
    finally:
        os.close(fd)
    sync_dir(path.parent)


def snapshot(root, serial):
    r = root.lstat()
    need(root.is_absolute() and root.resolve(strict=True) == root and stat.S_ISDIR(r.st_mode)
         and not root.is_symlink() and r.st_uid == os.geteuid() and stat.S_IMODE(r.st_mode) == 0o700, 'ROOT')
    marker_raw = raw_file(root / '.migration-complete.json')
    marker = json.loads(marker_raw)
    need(marker.get('schema_version') == 1 and marker.get('state') == 'complete', 'MIGRATION')
    legacy = Path(marker['legacy_root'])
    need(legacy.is_absolute() and legacy.resolve(strict=True) == legacy
         and not os.path.lexists(legacy / (serial + '.lock')), 'LEGACY')
    guards = []
    for path in (root / (serial + '.guard'), legacy / (serial + '.guard')):
        s = path.lstat()
        need(path.resolve(strict=True) == path and not path.is_symlink() and stat.S_ISREG(s.st_mode)
             and s.st_uid == os.geteuid() and stat.S_IMODE(s.st_mode) == 0o600
             and s.st_nlink == 2 and s.st_size == 0, 'GUARD')
        guards.append({'path': str(path), 'dev': s.st_dev, 'ino': s.st_ino, 'nlink': s.st_nlink})
    need((guards[0]['dev'], guards[0]['ino']) == (guards[1]['dev'], guards[1]['ino']), 'GUARD_ALIAS')
    lock = root / (serial + '.lock')
    s = lock.lstat()
    need(lock.resolve(strict=True) == lock and not lock.is_symlink() and stat.S_ISDIR(s.st_mode)
         and s.st_uid == os.geteuid() and stat.S_IMODE(s.st_mode) in (0o700, 0o755), 'QUARANTINE')
    names = ['owner', 'pid', 'acquired_at', 'standalone_review_required']
    actual_names = {p.name for p in lock.iterdir()}
    need(set(names) <= actual_names <= set(names) | {'standalone_quarantined'}, 'FIELDS')
    if 'standalone_quarantined' in actual_names:
        names.append('standalone_quarantined')
    fields = {name: raw_file(lock / name).decode() for name in names}
    need(re.fullmatch(r'[-A-Za-z0-9_]{1,120}\n', fields['owner'])
         and fields['standalone_review_required'] == fields['owner']
         and fields.get('standalone_quarantined', fields['owner']) == fields['owner']
         and re.fullmatch(r'[1-9][0-9]*\n', fields['pid'])
         and re.fullmatch(r'[0-9]+\n', fields['acquired_at']), 'OWNER')
    return {'root': {'dev': r.st_dev, 'ino': r.st_ino}, 'marker_sha256': hashlib.sha256(marker_raw).hexdigest(),
            'lock': {'dev': s.st_dev, 'ino': s.st_ino, 'mode': stat.S_IMODE(s.st_mode)},
            'fields': fields, 'guards': guards, 'guard_count': 1}


def emit(value):
    print(json.dumps(value, separators=(',', ':')), flush=True)


def message():
    line = sys.stdin.buffer.readline(1024 * 1024)
    need(line and line.endswith(b'\n') and len(line) < 1024 * 1024, 'PROTOCOL')
    return json.loads(line)


def main():
    if len(sys.argv) == 4 and sys.argv[1] == 'verify-bytecode':
        source, cache = map(Path, sys.argv[2:4])
        data, raw = raw_file(source), raw_file(cache)
        need(len(raw) >= 16 and raw[:4] == importlib.util.MAGIC_NUMBER
             and struct.unpack('<I', raw[4:8])[0] == 0
             and struct.unpack('<I', raw[8:12])[0] == int(source.stat().st_mtime)
             and struct.unpack('<I', raw[12:16])[0] == len(data), 'BYTECODE_HEADER')
        code = marshal.loads(raw[16:])
        expected = compile(data, str(source), 'exec', dont_inherit=True, optimize=0)
        need(code == expected and all(getattr(code, name) == getattr(expected, name) for name in dir(expected)
             if name.startswith('co_') and name != 'co_lnotab' and not callable(getattr(expected, name))), 'BYTECODE_SOURCE')
        emit({'code_matches': True, 'source_sha256': hashlib.sha256(data).hexdigest(),
              'cache_sha256': hashlib.sha256(raw).hexdigest()})
        return
    mode, root, serial = sys.argv[1:4]
    root = Path(root)
    need(mode in ('inspect', 'serve', 'resume-serve', 'continuation-serve', 'diagnostic-serve') and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}', serial), 'ARGUMENTS')
    before = snapshot(root, serial)
    # 两根是同一硬链：只open/flock一次，避免重复锁同inode自锁。
    fd = os.open(before['guards'][0]['path'], os.O_RDWR | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        need((s.st_dev, s.st_ino) == (before['guards'][0]['dev'], before['guards'][0]['ino']), 'GUARD_DRIFT')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        need(snapshot(root, serial) == before, 'SNAPSHOT_DRIFT')
        if mode == 'inspect':
            need(len(sys.argv) == 4, 'ARGUMENTS')
            emit(before)
            return
        diagnostic = mode == 'diagnostic-serve'
        continuation = mode == 'continuation-serve'
        resume = mode in ('resume-serve', 'continuation-serve', 'diagnostic-serve')
        need(len(sys.argv) == (14 if diagnostic else 12 if continuation else 8 if resume else 6) and re.fullmatch(r'[a-f0-9-]{36}', sys.argv[4])
             and re.fullmatch(r'[a-f0-9]{64}', sys.argv[5]), 'ARGUMENTS')
        task, plan = sys.argv[4:6]
        previous = None
        if resume:
            prior_plan, prior_sha = sys.argv[6:8]
            need(re.fullmatch(r'[a-f0-9]{64}', prior_plan) and re.fullmatch(r'[a-f0-9]{64}', prior_sha)
                 and prior_plan != plan, 'RESUME_ARGUMENTS')
            original = root / ('.device-epoch-fence-' + task + '-' + prior_plan)
            prior_raw = raw_file(Path(str(original) + '.pending.json'))
            previous = json.loads(prior_raw)
            need(hashlib.sha256(prior_raw).hexdigest() == prior_sha
                 and previous == {'protocol': 'device-epoch-fence-file-transaction/v1', 'task_id': task,
                                  'plan_sha256': prior_plan, 'snapshot': before,
                                  'original_execution_stopped': False, 'phase': 'prepared'}, 'RESUME_ORIGINAL')
            need(not any(os.path.lexists(str(original) + suffix) for suffix in
                         ('.completed.json', '.superseded', '.diagnostic-recovery-owner.json')), 'PREVIOUS_UNKNOWN')
            if not diagnostic:
                need(not os.path.lexists(str(original)+'.continuation-owner.json'), 'PREVIOUS_UNKNOWN')
            if diagnostic:
                failed, owner_sha, failed_sha, unknown_sha, history_path, history_sha = sys.argv[8:14]
                need(all(re.fullmatch(r'[a-f0-9]{64}', v) for v in (failed, owner_sha, failed_sha, unknown_sha, history_sha)) and failed not in (plan, prior_plan), 'DIAGNOSTIC_ARGUMENTS')
                def diagnostic_unchanged():
                    raw = raw_file(Path(history_path), 4*1024*1024)
                    need(hashlib.sha256(raw).hexdigest() == history_sha, 'DIAGNOSTIC_HISTORY_DRIFT')
                    h = json.loads(raw)
                    need(h['protocol'] == 'device-epoch-fence-diagnostic-recovery-history/v1' and h['failed_resume_plan_sha256'] == failed and h['owner_path'] == str(original)+'.continuation-owner.json', 'DIAGNOSTIC_HISTORY')
                    expected = [(h['owner_path'], owner_sha), (h['pending_path'], failed_sha), (h['unknown_path'], unknown_sha)]
                    need(Path(h['pending_path']).parent == root and re.fullmatch(r'\.device-epoch-fence-continuation-'+task+r'-[a-f0-9]{64}-'+failed+r'\.pending\.json', Path(h['pending_path']).name) and h['unknown_path'] == h['pending_path'][:-len('.pending.json')]+'.unknown.json', 'DIAGNOSTIC_PATH')
                    for path, value in expected:
                        need(h['files'].get(path) == value, 'DIAGNOSTIC_HISTORY')
                    for path, value in h['files'].items():
                        need(re.fullmatch(r'[a-f0-9]{64}', value) and hashlib.sha256(raw_file(Path(path), 8*1024*1024)).hexdigest() == value, 'DIAGNOSTIC_HISTORY_DRIFT')
                    owner = json.loads(raw_file(Path(h['owner_path'])))
                    need(owner.get('protocol') == 'device-epoch-fence-continuation-owner/v1' and owner.get('continuation_plan_sha256') == failed and owner.get('prior_pending_sha256') == prior_sha and owner.get('original_execution_stopped') is False, 'DIAGNOSTIC_OWNER')
                    pending, unknown = [json.loads(raw_file(Path(h[k]))) for k in ('pending_path', 'unknown_path')]
                    need(pending.get('plan_sha256') == failed and pending.get('snapshot') == before and pending.get('phase') == 'prepared' and unknown == {'event':'unknown','reason':'DIAGNOSTIC_RECEIPT','plan_sha256':failed,'retry_allowed':False,'original_execution_stopped':False}, 'DIAGNOSTIC_LATCH')
                diagnostic_unchanged()
                recovery_owner = {'protocol':'device-epoch-fence-diagnostic-recovery-owner/v1','recovery_plan_sha256':plan,'failed_continuation_plan_sha256':failed,'history_sha256':history_sha,'prior_pending_sha256':prior_sha,'original_execution_stopped':False}
                prefix = root / ('.device-epoch-fence-diagnostic-recovery-'+task+'-'+failed+'-'+plan)
            elif continuation:
                failed, owner_sha, failed_sha, unknown_sha = sys.argv[8:12]
                need(all(re.fullmatch(r'[a-f0-9]{64}', v) for v in (failed, owner_sha, failed_sha, unknown_sha))
                     and failed not in (plan, prior_plan), 'CONTINUATION_ARGUMENTS')
                old_prefix = root / ('.device-epoch-fence-resume-' + task + '-' + prior_plan + '-' + failed)
                need(not any(os.path.lexists(str(old_prefix) + suffix) for suffix in ('.completed.json', '.superseded')), 'PREVIOUS_UNKNOWN')
                expected_owner = {'protocol': 'device-epoch-fence-resume-owner/v1', 'resume_plan_sha256': failed,
                                  'prior_pending_sha256': prior_sha, 'original_execution_stopped': False}
                def prior_unchanged():
                    for path, expected_sha in [(Path(str(original)+'.resume-owner.json'), owner_sha),
                                               (Path(str(old_prefix)+'.pending.json'), failed_sha),
                                               (Path(str(old_prefix)+'.unknown.json'), unknown_sha)]:
                        need(hashlib.sha256(raw_file(path)).hexdigest() == expected_sha, 'CONTINUATION_HISTORY_DRIFT')
                    need(json.loads(raw_file(Path(str(original)+'.resume-owner.json'))) == expected_owner, 'CONTINUATION_OWNER')
                    need(json.loads(raw_file(Path(str(old_prefix)+'.pending.json'))) == {
                        'protocol': 'device-epoch-fence-file-transaction/v1', 'task_id': task, 'plan_sha256': failed,
                        'snapshot': before, 'original_execution_stopped': False, 'phase': 'prepared',
                        'prior_plan_sha256': prior_plan, 'prior_pending_sha256': prior_sha}, 'CONTINUATION_PENDING')
                    need(json.loads(raw_file(Path(str(old_prefix)+'.unknown.json'))) == {
                        'event': 'unknown', 'reason': 'RESUME_PRIVATE_TERMINAL_UNKNOWN', 'plan_sha256': failed,
                        'retry_allowed': False, 'original_execution_stopped': False}, 'CONTINUATION_UNKNOWN')
                prior_unchanged()
                continuation_owner = {'protocol': 'device-epoch-fence-continuation-owner/v1', 'continuation_plan_sha256': plan,
                                      'failed_resume_plan_sha256': failed, 'failed_resume_owner_sha256': owner_sha,
                                      'prior_pending_sha256': prior_sha, 'original_execution_stopped': False}
                prefix = root / ('.device-epoch-fence-continuation-' + task + '-' + failed + '-' + plan)
            else:
                need(not os.path.lexists(str(original)+'.resume-owner.json'), 'PREVIOUS_UNKNOWN')
                prefix = root / ('.device-epoch-fence-resume-' + task + '-' + prior_plan + '-' + plan)
        else:
            prefix = root / ('.device-epoch-fence-' + task + '-' + plan)
        need(not any(os.path.lexists(str(prefix) + suffix) for suffix in ('.pending.json', '.completed.json', '.superseded', '.unknown.json')), 'PREVIOUS_UNKNOWN')
        emit({'event': 'locked', 'snapshot': before})
        prepare = message()
        need(prepare == {'action': 'prepare', 'expected': before} and snapshot(root, serial) == before, 'PREPARE_CAS')
        if diagnostic:
            diagnostic_unchanged()
            write_once(Path(str(original)+'.diagnostic-recovery-owner.json'), recovery_owner)
        elif continuation:
            prior_unchanged()
            write_once(Path(str(original)+'.continuation-owner.json'), continuation_owner)
        elif resume:
            # 同一原unknown只准一个新授权事务；换plan也不能绕过ACK未知。
            write_once(Path(str(original) + '.resume-owner.json'), {'protocol': 'device-epoch-fence-resume-owner/v1',
                       'resume_plan_sha256': plan, 'prior_pending_sha256': prior_sha, 'original_execution_stopped': False})
        pending = {'protocol': 'device-epoch-fence-file-transaction/v1', 'task_id': task,
                   'plan_sha256': plan, 'snapshot': before, 'original_execution_stopped': False, 'phase': 'prepared'}
        if resume:
            pending.update({'prior_plan_sha256': prior_plan, 'prior_pending_sha256': prior_sha})
        if diagnostic:
            pending.update({'failed_continuation_plan_sha256':failed,'diagnostic_history_sha256':history_sha})
        if continuation:
            pending.update({'failed_resume_plan_sha256': failed, 'failed_resume_owner_sha256': owner_sha,
                            'failed_resume_pending_sha256': failed_sha, 'failed_resume_unknown_sha256': unknown_sha})
        write_once(Path(str(prefix) + '.pending.json'), pending)
        def unchanged():
            need(snapshot(root, serial) == before, 'RESUME_SNAPSHOT_DRIFT' if resume else 'SNAPSHOT_DRIFT')
            if resume:
                need(hashlib.sha256(raw_file(Path(str(original) + '.pending.json'))).hexdigest() == prior_sha,
                     'RESUME_ORIGINAL_DRIFT')
                if diagnostic:
                    diagnostic_unchanged()
                    need(json.loads(raw_file(Path(str(original)+'.diagnostic-recovery-owner.json'))) == recovery_owner, 'DIAGNOSTIC_OWNER_DRIFT')
                elif continuation:
                    prior_unchanged()
                    need(json.loads(raw_file(Path(str(original)+'.continuation-owner.json'))) == continuation_owner, 'CONTINUATION_OWNER_DRIFT')
                else:
                    owner = json.loads(raw_file(Path(str(original) + '.resume-owner.json')))
                    need(owner == {'protocol': 'device-epoch-fence-resume-owner/v1', 'resume_plan_sha256': plan,
                                   'prior_pending_sha256': prior_sha, 'original_execution_stopped': False}, 'RESUME_OWNER_DRIFT')
            return True
        unchanged()
        emit({'event': 'prepared'})
        commit = message()
        while commit == {'action': 'check'}:
            need(unchanged(), 'CHECK_CAS')
            emit({'event': 'checked'})
            commit = message()
        if isinstance(commit, dict) and commit.get('action') == 'abort_unknown':
            need(set(commit) == {'action', 'reason'} and re.fullmatch(r'[A-Z][A-Z0-9_]{0,99}', commit.get('reason', ''))
                 and unchanged(), 'ABORT_CAS')
            result = {'event': 'unknown', 'reason': commit['reason'], 'original_execution_stopped': False,
                      'retry_allowed': False, 'plan_sha256': plan}
            write_once(Path(str(prefix) + '.unknown.json'), result)
            emit(result)
            return
        need(set(commit) == {'action', 'proof_sha256'} and commit['action'] == 'commit'
             and re.fullmatch(r'[a-f0-9]{64}', commit['proof_sha256']) and unchanged(), 'COMMIT_CAS')
        # Node已完成真正的fence/中央强CAS及fresh读回。这里只执行一次原目录rename，不写原始字段。
        archive = Path(str(prefix) + '.superseded')
        need(not os.path.lexists(archive), 'ARCHIVE_EXISTS')
        os.rename(root / (serial + '.lock'), archive)
        sync_dir(root)
        result = {'event': 'committed', 'archive_path': str(archive), 'lock_ino': before['lock']['ino'],
                  'proof_sha256': commit['proof_sha256'], 'original_execution_stopped': False}
        write_once(Path(str(prefix) + '.completed.json'), result)
        emit(result)
    finally:
        os.close(fd)


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(ValueError('EPOCH_LOCK_DEADLINE')))
    signal.alarm(600)
    try:
        main()
    except Exception as error:
        code = str(error) if re.fullmatch(r'EPOCH_LOCK_[A-Z_]+', str(error)) else 'EPOCH_LOCK_UNKNOWN'
        print(code, file=sys.stderr)
        sys.exit(2)
