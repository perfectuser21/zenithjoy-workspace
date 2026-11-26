#!/usr/bin/env python3
"""Read the exact two MMV listeners and prove their process bindings."""
from datetime import datetime
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import socket
import stat
import subprocess
import sys
import types

HERE = Path(__file__).resolve().parent
HELPER = 'yuesheng-adb-daemon-binding.py'
INSTANCE = 'mmv-yuesheng-direct'
EXTRA_SOURCE = ('adb-private-supervisor.py', 'adb-process-observation.py', HELPER)


def load(name):
    path = HERE / (name + '.py')
    module = types.ModuleType(name.replace('-', '_'))
    module.__file__ = str(path)
    exec(compile(path.read_bytes(), str(path), 'exec'), module.__dict__)
    return module


process = load('adb-private-supervisor')
instance = load('adb-host-instance-policy')


def need(value):
    if not value:
        raise ValueError('YUESHENG_MIGRATION_DAEMON_IDENTITY')


def ipv4_listener(port, pid=None):
    found = sorted(process.listeners(port, pid), key=lambda item: item['endpoint'])
    local = '127.0.0.1:' + str(port)
    if sys.platform == 'linux':
        local = 'loopback:' + str(port)
    ipv4 = [row for row in found if row['endpoint'] == local]
    need(len(ipv4) == 1 and len(found) <= 2 and type(ipv4[0]['pid']) is int)
    owner = ipv4[0]['pid']
    need(all(row['pid'] == owner for row in found) and (pid is None or pid == owner))
    return owner, found


def external_identity(port, policy, expected=None):
    previous = expected['child'] if expected else None
    if previous:
        need(expected['endpoint'] == 'tcp:127.0.0.1:' + str(port))
    child_pid, listening = ipv4_listener(port, previous.get('pid') if previous else None)
    child = process.process_identity(child_pid, previous)
    need(child is not None and child['executable'] == policy['adb_realpath']
         and child['executable_sha256'] == policy['adb_sha256'])
    argv = shlex.split(child['_argv'])
    need(len(argv) == 7 and Path(argv[0]).name == 'adb'
         and argv[1] == '-L' and argv[2] in ('tcp:localhost:' + str(port), 'tcp:127.0.0.1:' + str(port), 'tcp:' + str(port))
         and argv[3:6] == ['fork-server', 'server', '--reply-fd'] and argv[6].isdigit())
    public = process.public(child)
    need(ipv4_listener(port, child_pid)[1] == listening and process.process_identity(child_pid, public) is not None)
    observation = {'endpoint': 'tcp:127.0.0.1:' + str(port), 'kind': 'external_existing',
                   'child': public, 'listeners': listening}
    need(expected is None or expected == observation)
    return observation


def lock_bytes(path, supervisor_pid):
    # A pinned supervisor controls the flock lifecycle. Observe its descriptors
    # and inode here without attempting to acquire either of its locks.
    snapshot = path.lstat()
    raw = instance.read_file(path, private=True)
    reply = process.command(['/usr/sbin/lsof', '-nP', '-a', '-p', str(supervisor_pid), '-Ffint', str(path)], check=True)
    rows = reply.stdout.splitlines()
    need(rows and rows[0] == 'p' + str(supervisor_pid)
         and [row for row in rows if row.startswith('p')] == rows[:1]
         and len([row for row in rows if re.fullmatch(r'f[0-9]+', row)]) == 1
         and [row for row in rows if row.startswith('i')] == ['i' + str(snapshot.st_ino)]
         and [row for row in rows if row.startswith('n')] == ['n' + str(path)])
    same = path.lstat()
    need((same.st_dev, same.st_ino, same.st_ctime_ns) == (snapshot.st_dev, snapshot.st_ino, snapshot.st_ctime_ns))
    return {'dev': snapshot.st_dev, 'ino': snapshot.st_ino, 'sha256': process.sha(raw)}, raw


def supervisor_interpreter():
    launcher = Path('/opt/homebrew/bin/python3').resolve(strict=True)
    info = launcher.stat()
    need(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o022)
    probe = ('import ctypes, os; b=ctypes.create_string_buffer(4096); '
             'n=ctypes.CDLL("/usr/lib/libproc.dylib").proc_pidpath(os.getpid(),b,len(b)); '
             'assert 0<n<len(b); print(os.fsdecode(b.value))')
    result = process.command([str(launcher), '-I', '-B', '-S', '-c', probe], check=True)
    executable = Path(result.stdout.strip()).resolve(strict=True)
    runtime = executable.stat()
    need(stat.S_ISREG(runtime.st_mode) and not runtime.st_mode & 0o022)
    return str(executable), process.sha(executable.read_bytes())


def startup_source(supervisor, candidate_root, row, manifest, home):
    argv = shlex.split(supervisor['_argv'])
    need(argv and Path(argv[0]).resolve(strict=True) == Path(supervisor['executable']))
    args = argv[1:]
    if args[:3] == ['-I', '-B', '-S']:
        args = args[3:]
    elif args[:1] == ['-B']:
        args = args[1:]
    need(len(args) in (6, 7) and args[1:5] == ['run', '--config', row['policy_path'], '--maintenance-receipt']
         and (len(args) == 6 or args[6] == '--resume-reserved-start'))
    service = Path(args[0])
    root = service.parent
    need(service.name == 'adb-host-service.py' and root == candidate_root
         and root == home / '.local/share/zenithjoy/phone-candidates' / manifest['source_commit'] / 'runtime'
         and root.resolve(strict=True) == root)
    need(instance.source_manifest(root=root) == manifest)
    working = process.command(['/usr/sbin/lsof', '-nP', '-a', '-p', str(supervisor['pid']), '-d', 'cwd', '-Ffn'], check=True)
    need(working.stdout.splitlines() == ['p' + str(supervisor['pid']), 'fcwd', 'n' + str(root)])
    receipt_raw = instance.read_file(Path(args[5]), private=True)
    receipt = json.loads(receipt_raw)
    scope = receipt.get('scope', {})
    issued = datetime.fromisoformat(receipt['issued_at'].replace('Z', '+00:00'))
    expires = datetime.fromisoformat(receipt['expires_at'].replace('Z', '+00:00'))
    started = supervisor['kernel_start'][0] + supervisor['kernel_start'][1] / 1_000_000
    need(issued.tzinfo is not None and expires.tzinfo is not None
         and issued.timestamp() <= started < expires.timestamp()
         and 0 < (expires - issued).total_seconds() <= 120)
    need(receipt.get('protocol') == 'device-epoch-clean-startup/v1' and receipt.get('action') == 'start_private_server'
         and scope.get('serial') == 'B114E2190975' and scope.get('adb_serial') == '127.0.0.1:15555'
         and scope.get('instance_id') == INSTANCE and scope.get('endpoint') == row['policy']['endpoint']
         and scope.get('source_commit') == manifest['source_commit'] and scope.get('policy_sha256') == process.sha(instance.read_file(Path(row['policy_path']), private=True))
         and scope.get('registry_sha256') == process.sha(instance.read_file(candidate_root / instance.REGISTRY)))
    return {'source_commit': manifest['source_commit'], 'startup_receipt_sha256': process.sha(receipt_raw)}


def managed_identity(port, policy, lock_paths, read_startup, expected=None):
    entry = json.loads(instance.read_file(lock_paths[0], private=True))
    need(type(entry) is dict and set(entry) == {'supervisor_pid', 'child_pid'}
         and all(type(pid) is int and pid > 1 for pid in entry.values()))
    supervisor_pid, child_pid = entry['supervisor_pid'], entry['child_pid']
    if expected is not None:
        need(expected['endpoint'] == 'tcp:127.0.0.1:' + str(port)
             and expected['supervisor']['pid'] == supervisor_pid and expected['child']['pid'] == child_pid)
    locks = [lock_bytes(path, supervisor_pid) for path in lock_paths]
    need(json.loads(locks[0][1]) == entry)
    supervisor = process.process_identity(supervisor_pid, expected['supervisor'] if expected else None)
    child = process.process_identity(child_pid, expected['child'] if expected else None)
    need(supervisor is not None and child is not None and child['ppid'] == supervisor_pid
         and child['executable'] == policy['adb_realpath'] and child['executable_sha256'] == policy['adb_sha256']
         and shlex.split(child['_argv']) == [policy['adb_realpath'], '-L', 'tcp:' + str(port), 'server', 'nodaemon'])
    proof = read_startup(supervisor)
    _, listening = ipv4_listener(port, child_pid)
    actual = {'endpoint': 'tcp:127.0.0.1:' + str(port), 'kind': 'managed', 'supervisor': process.public(supervisor),
              'child': process.public(child), 'startup': proof, 'listeners': listening, 'locks': [state[0] for state in locks]}
    need(all(process.process_identity(actual[role]['pid'], actual[role]) is not None for role in ('supervisor', 'child'))
         and ipv4_listener(port, child_pid)[1] == listening
         and [lock_bytes(path, supervisor_pid) for path in lock_paths] == locks
         and read_startup(supervisor) == proof)
    need(expected is None or expected == actual)
    return actual


def main(document):
    need(sys.platform == 'darwin' and os.geteuid() != 0
         and socket.gethostname().lower().split('.')[0] in ('r10-7', 'aad17-2'))
    need(type(document) is dict and set(document) == {'source_commit', 'route', 'expected'}
         and re.fullmatch('[a-f0-9]{40}', document['source_commit']) and document['route'] in ('old', 'next'))
    commit = document['source_commit']
    home = Path(pwd.getpwuid(os.geteuid()).pw_dir)
    need(HERE == home / '.local/share/zenithjoy/phone-candidates' / commit / 'runtime')
    manifest = instance.source_manifest(extra=EXTRA_SOURCE)
    need(manifest['source_commit'] == commit)
    registry, _ = instance.registry()
    rows = [row for row in registry['instances'] if row['instance_id'] == INSTANCE and row['kind'] == 'managed']
    need(len(rows) == 1 and rows[0]['policy']['endpoint'] == 'tcp:127.0.0.1:5045')
    row = rows[0]
    policy = row['policy']
    instance.verify_binary(policy)
    expected = document['expected']
    if document['route'] == 'old':
        return external_identity(5044, policy, expected)
    instance.read_instance_policy(row['policy_path'], policy)
    lock_root = home / '.config/zenithjoy'
    locks = [lock_root / name for name in ('adb-host.instance-' + INSTANCE + '.lock', 'adb-host.port-5045.lock', 'adb-host.lock')]
    executable = supervisor_interpreter()
    def proof(supervisor):
        need((supervisor['executable'], supervisor['executable_sha256']) == executable)
        return startup_source(supervisor, HERE, row, manifest, home)
    return managed_identity(5045, policy, locks, proof, expected)


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(65537)
        need(len(raw) <= 65536)
        print(json.dumps(main(json.loads(raw)), sort_keys=True))
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        sys.stderr.write('YUESHENG_MIGRATION_DAEMON_IDENTITY\n')
        sys.exit(1)
