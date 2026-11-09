#!/usr/bin/env python3
"""本人私有ADB supervisor的固定源进程原语；动态批准仅来自固定Node。"""
import ctypes
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import signal
import socket
import stat
import subprocess
import sys
import types

HERE = Path(__file__).resolve().parent
OLD_SOURCE = '48b04e27c58d3244b37000dee8711d329a2ddb3b'
OLD_SERVICE_SHA = '80e7af96e045a4268e96effdd2e12dfe7898c597e76f350fec84312dd00e8919'


def need(value):
    if not value:
        raise ValueError('ADB_PRIVATE_SUPERVISOR_UNVERIFIED')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def load(name, root=HERE):
    path = Path(root) / (name + '.py')
    module = types.ModuleType(name.replace('-', '_'))
    module.__file__ = str(path)
    exec(compile(path.read_bytes(), str(path), 'exec'), module.__dict__)
    return module


def kernel_identity(pid):
    need(type(pid) is int and pid > 1)
    observer = load('adb-process-observation')
    if sys.platform == 'darwin':
        first = observer.kernel_snapshot(pid)
        if first is None:
            return None
        library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        info = observer.BSDInfo()
        count = library.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
        if count == 0 and ctypes.get_errno() == errno.ESRCH:
            return None
        need(count == 136 and info.pbi_pid == pid and info.pbi_uid == first['uid']
             and [info.pbi_start_tvsec, info.pbi_start_tvusec] == first['start'])
        return {**first, 'ppid': int(info.pbi_ppid)}
    need(sys.platform == 'linux')
    try:
        raw = Path('/proc/%d/stat' % pid).read_text()
        fields = raw[raw.rfind(')')+2:].split()
        boot = next(int(row.split()[1]) for row in Path('/proc/stat').read_text().splitlines() if row.startswith('btime '))
        micros = int(fields[19])*1000000//os.sysconf('SC_CLK_TCK')
        return {'pid': pid, 'uid': Path('/proc/%d' % pid).stat().st_uid, 'ppid': int(fields[1]),
                'status': 5 if fields[0] == 'Z' else 1, 'start': [boot+micros//1000000, micros%1000000]}
    except (FileNotFoundError, ProcessLookupError):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return None
        raise ValueError('ADB_PRIVATE_SUPERVISOR_UNVERIFIED')


def command(argv, check=False):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=2,
                            env={'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'})
    need(len(result.stdout.encode()) <= 65536 and len(result.stderr.encode()) <= 65536)
    if check:
        need(result.returncode == 0)
    return result


def executable(pid):
    if sys.platform == 'linux':
        return str(Path('/proc/%d/exe' % pid).resolve(strict=True))
    need(sys.platform == 'darwin')
    library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    data = ctypes.create_string_buffer(4096)
    count = library.proc_pidpath(pid, data, len(data))
    need(0 < count < len(data))
    return str(Path(os.fsdecode(data.value)).resolve(strict=True))


def process_identity(pid, expected=None):
    observer = load('adb-process-observation')
    row = observer.observe(pid, command, executable, expected, kernel_identity)
    if row is None:
        return None
    kernel = kernel_identity(pid)
    need(kernel is not None and kernel['uid'] == os.geteuid()
         and kernel['start'] == row['kernel_start'])
    row['ppid'] = kernel['ppid']
    row['executable_sha256'] = sha(Path(row['executable']).read_bytes())
    if expected is not None:
        for key in ('pid', 'uid', 'kernel_start', 'argv_sha256', 'executable', 'executable_sha256'):
            need(row[key] == expected.get(key))
        if 'ppid' in expected:
            need(row['ppid'] == expected['ppid'])
    return row


def identity_terminal(expected):
    need(isinstance(expected, dict) and expected.get('uid') == os.geteuid()
         and isinstance(expected.get('kernel_start'), list) and len(expected['kernel_start']) == 2
         and all(type(x) is int and x >= 0 for x in expected['kernel_start']) and expected['kernel_start'][0] > 0
         and all(isinstance(expected.get(k), str) and re.fullmatch('[a-f0-9]{64}', expected[k]) for k in ('argv_sha256', 'executable_sha256'))
         and isinstance(expected.get('executable'), str) and Path(expected['executable']).is_absolute())
    observer = load('adb-process-observation')
    current = kernel_identity(expected.get('pid'))
    if current is None:
        return True
    observer.bind_expected(current, expected)
    return current['status'] == 5


def public(row):
    return None if row is None else {k: v for k, v in row.items() if not k.startswith('_') and k != 'lstart'}


def context(document):
    need(isinstance(document, dict) and document.get('action') in ('inspect', 'terminal', 'kernel'))
    allowed = {'action', 'instance_id', 'endpoint', 'source_commit', 'policy_path', 'policy_sha256', 'supervisor_source', 'expected', 'pid'}
    need(not set(document) - allowed)
    instance = load('adb-host-instance-policy')
    manifest = instance.source_manifest(extra=('adb-private-supervisor.py', 'adb-process-observation.py'))
    need(document.get('source_commit') == manifest['source_commit'])
    registry, _ = instance.registry()
    rows = [r for r in registry['instances'] if r['kind'] == 'managed' and r['instance_id'] == document.get('instance_id')]
    need(len(rows) == 1 and rows[0]['instance_id'] == 'mmv-cloud-epoch2')
    row = rows[0]
    policy = row['policy']
    need(document.get('endpoint') == policy['endpoint'] and document.get('policy_path') == row['policy_path']
         and document.get('policy_sha256') == sha(instance.read_file(Path(row['policy_path']), private=True)))
    instance.read_instance_policy(row['policy_path'], policy)
    instance.verify_binary(policy)
    port = int(policy['endpoint'].rsplit(':', 1)[1])
    need(port not in (5037, 5041))
    old = document.get('supervisor_source')
    need(isinstance(old, dict) and set(old) == {'runtime_root', 'source_commit', 'service_sha256'})
    root = Path(old['runtime_root'])
    need(root.is_absolute() and root.resolve(strict=True) == root)
    prior_manifest = instance.source_manifest(root=root)
    actual = sha(instance.read_file(root / 'adb-host-service.py'))
    need(prior_manifest['source_commit'] == old['source_commit'] and actual == old['service_sha256'])
    if old['source_commit'] == OLD_SOURCE:
        need(actual == OLD_SERVICE_SHA)
    else:
        need(old['source_commit'] == manifest['source_commit'] and actual == sha(instance.read_file(HERE / 'adb-host-service.py')))
    home = Path(pwd.getpwuid(os.geteuid()).pw_dir)
    base = home / '.config/zenithjoy'
    locks = [base / ('adb-host.instance-' + row['instance_id'] + '.lock'), base / ('adb-host.port-' + str(port) + '.lock')]
    return instance, policy, port, root, locks


def lock_state(path):
    need(path.is_absolute() and not any(p.is_symlink() for p in (path, *path.parents)))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            held = False
        except BlockingIOError:
            held = True
        raw = os.read(fd, 65537)
        need(len(raw) <= 65536)
        after = path.lstat()
        need((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns))
        return {'held': held, 'device': info.st_dev, 'inode': info.st_ino, 'sha256': sha(raw)}, raw
    finally:
        os.close(fd)


def listeners(port, child_pid=None):
    if sys.platform == 'darwin':
        result = command(['/usr/sbin/lsof', '-nP', '-a', '-iTCP:' + str(port), '-sTCP:LISTEN', '-Fpn'])
        need(result.returncode in (0, 1) and not result.stderr.strip())
        if not result.stdout.strip():
            need(result.returncode == 1)
            return []
        owner = None
        found = []
        for line in result.stdout.splitlines():
            if re.fullmatch(r'p[0-9]+', line):
                owner = int(line[1:])
            elif line.startswith('n'):
                need(owner and line[1:] in ('127.0.0.1:' + str(port), '[::1]:' + str(port)))
                found.append({'pid': owner, 'endpoint': line[1:]})
        need(found and result.returncode == 0)
        return found
    need(sys.platform == 'linux')
    owned = set()
    if child_pid is not None:
        for file in Path('/proc/%d/fd' % child_pid).iterdir():
            try:
                target = os.readlink(file)
                if re.fullmatch(r'socket:\[[0-9]+\]', target):
                    owned.add(target[8:-1])
            except FileNotFoundError:
                pass
    found = []
    for name in ('tcp', 'tcp6'):
        for line in Path('/proc/net/' + name).read_text().splitlines()[1:]:
            fields = line.split()
            address, socket_port = fields[1].split(':')
            if int(socket_port, 16) != port or fields[3] != '0A':
                continue
            need(address in ('0100007F', '00000000000000000000000001000000'))
            found.append({'pid': child_pid if fields[9] in owned else None, 'endpoint': 'loopback:' + str(port)})
    return found


def inspect(document):
    instance, policy, port, old_root, locks = context(document)
    states = [lock_state(path) for path in locks]
    need(all(row[0]['held'] for row in states))
    candidate = json.loads(states[0][1])
    need(isinstance(candidate, dict) and set(candidate) == {'supervisor_pid', 'child_pid'})
    expected = document.get('expected')
    if expected is not None:
        need(isinstance(expected, dict) and set(expected) == {'supervisor', 'child'}
             and candidate['supervisor_pid'] == expected['supervisor'].get('pid')
             and candidate['child_pid'] == expected['child'].get('pid'))
    supervisor = process_identity(candidate['supervisor_pid'], expected.get('supervisor') if expected else None)
    child = process_identity(candidate['child_pid'], expected.get('child') if expected else None)
    need(supervisor is not None and child is not None and child['ppid'] == supervisor['pid'])
    need(supervisor['uid'] == child['uid'] == os.geteuid())
    argv = shlex.split(supervisor['_argv'])
    need(len(argv) in (7, 8) and Path(argv[0]).resolve(strict=True) == Path(supervisor['executable'])
         and argv[1:6] == [str(old_root / 'adb-host-service.py'), 'run', '--config', document['policy_path'], '--maintenance-receipt']
         and (len(argv) == 7 or argv[7] == '--resume-reserved-start' and document['supervisor_source']['source_commit'] != OLD_SOURCE))
    instance.read_file(Path(argv[6]), private=True)
    need(child['executable'] == policy['adb_realpath'] and child['executable_sha256'] == policy['adb_sha256']
         and shlex.split(child['_argv']) == [policy['adb_realpath'], '-L', 'tcp:' + str(port), 'server', 'nodaemon'])
    listening = listeners(port, child['pid'])
    need(listening and all(row['pid'] == child['pid'] for row in listening))
    # Identity and lock bytes are checked once more after the listener lookup.
    need(process_identity(supervisor['pid'], public(supervisor)) is not None
         and process_identity(child['pid'], public(child)) is not None)
    need([lock_state(path)[0] for path in locks] == [row[0] for row in states])
    return {'actual': {'supervisor': public(supervisor), 'child': public(child)}, 'listeners': listening,
            'locks': [row[0] for row in states]}


def terminal(document):
    _, _, port, _, locks = context(document)
    expected = document.get('expected')
    need(isinstance(expected, dict) and set(expected) == {'supervisor', 'child'})
    need(expected['child'].get('ppid') == expected['supervisor'].get('pid'))
    need(all(identity_terminal(expected[key]) for key in ('supervisor', 'child')))
    need(not listeners(port))
    states = [lock_state(path)[0] for path in locks]
    need(not any(row['held'] for row in states))
    # No signals, writes or lock deletion; existing JSON alone proves nothing.
    need(all(identity_terminal(expected[key]) for key in ('supervisor', 'child')) and not listeners(port))
    return {'execution_stopped': True, 'listener_absent': True, 'instance_locks_released': True, 'locks': states}


def run(document):
    if document.get('action') == 'inspect':
        value = inspect(document)
    elif document.get('action') == 'terminal':
        value = terminal(document)
    else:
        context(document)
        need(document.get('action') == 'kernel')
        value = {'identity': public(process_identity(document.get('pid')))}
        need(value['identity'] is not None)
    return {'protocol': 'adb-private-supervisor/v1', 'action': document['action'], 'source_commit': document['source_commit'],
            'instance_id': document['instance_id'], 'endpoint': document['endpoint'], 'policy_sha256': document['policy_sha256'],
            'supervisor_source': document['supervisor_source'], **value}


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(65537)
        need(len(raw) <= 65536)
        print(json.dumps(run(json.loads(raw))))
    except Exception:
        print(json.dumps({'protocol': 'adb-private-supervisor/v1', 'verified': False, 'error': 'ADB_PRIVATE_SUPERVISOR_UNVERIFIED'}))
        sys.exit(2)
