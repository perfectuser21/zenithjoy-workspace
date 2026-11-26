"""Publish or restore one production Dashboard release across both public origins."""

import argparse
from contextlib import nullcontext
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tempfile


HOSTS = {'hz': 'aliyun-cn', 'hk': 'hk-vps'}
SHA = re.compile(r'[a-f0-9]{40}')
DIGEST = re.compile(r'[a-f0-9]{64}')
MAX_ARCHIVE = 100 * 1024 * 1024


class ReleaseError(RuntimeError):
    pass


def require(value, reason):
    if not value:
        raise ReleaseError(reason)


def valid(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value)


def validate_receipt(value):
    require(isinstance(value, dict) and set(value) == {'sha', 'digest'}
            and valid(SHA, value['sha']) and valid(DIGEST, value['digest']),
            'unexpected host receipt or unresolved local activation')
    return value


def validate_pair(pair):
    require(isinstance(pair, dict) and set(pair) == set(HOSTS), 'release receipt must cover both hosts')
    for region in HOSTS:
        validate_receipt(pair[region])
    require(pair['hz']['sha'] == pair['hk']['sha'], 'production hosts report different versions')
    return pair


def read_state(path):
    if not path.exists() and not path.is_symlink():
        return None
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o077,
            'unsafe release journal')
    state = json.loads(path.read_text())
    require(isinstance(state, dict) and set(state) == {'current', 'previous', 'pending'},
            'invalid release journal')
    for field in ('current', 'previous', 'pending'):
        if state[field] is not None or field == 'current':
            validate_pair(state[field])
    return state


def persist(path, state):
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        try:
            json.dump(state, handle, sort_keys=True)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
            temporary.replace(path)
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            temporary.unlink(missing_ok=True)


def read_hosts(host):
    return validate_pair({region: host(region, 'inspect') for region in HOSTS})


def check_live(host, expected):
    live = read_hosts(host)
    require(live == expected, 'served Dashboard differs from the recorded version or content')
    return live


def restore_all(path, host, state):
    previous, target = state['current'], state['pending']
    failures = []
    for region in reversed(HOSTS):
        try:
            observed = host(region, 'restore', previous[region]['sha'], target[region]['sha'])
            require(validate_receipt(observed) == previous[region], 'restored artifact differs')
        except ReleaseError:
            failures.append(region)
    require(not failures, 'recovery pending on ' + ', '.join(failures))
    check_live(host, previous)
    restored = {**state, 'pending': None}
    persist(path, restored)
    return restored


def archive_info(archive):
    size = archive.stat().st_size
    require(0 < size <= MAX_ARCHIVE, 'invalid Dashboard archive size')
    digest = hashlib.sha256()
    with archive.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest(), str(size)


def run_transaction(path, host, action, sha=None, archive=None):
    state = read_state(path)
    if state and state['pending']:
        if action == 'inspect':
            return {'current': state['current'], 'previous': state['previous'], 'pending': state['pending'],
                    'observed': {region: host(region, 'inspect') for region in HOSTS}}
        require(action == 'rollback' and sha == state['current']['hz']['sha'],
                'release recovery pending; run rollback to ' + state['current']['hz']['sha'])
        return restore_all(path, host, state)

    live = check_live(host, state['current']) if state else read_hosts(host)
    state = state or {'current': live, 'previous': None, 'pending': None}
    if action == 'inspect':
        return state
    require(action in ('promote', 'rollback') and valid(SHA, sha), 'release requires an exact SHA')
    if sha == live['hz']['sha']:
        return state

    if action == 'promote':
        require(archive is not None, 'release requires a verified build archive')
        digest, size = archive_info(archive)
        target = validate_pair({
            region: host(region, 'prepare', sha, digest, size, archive=archive) for region in HOSTS
        })
        require(target['hz']['sha'] == sha and target['hz']['digest'] == target['hk']['digest'],
                'hosts prepared different production assets')
        switch = 'activate'
    else:
        target = state['previous']
        require(target and target['hz']['sha'] == sha, 'rollback requires the recorded predecessor SHA')
        switch = 'restore'

    state = {**state, 'pending': target}
    persist(path, state)
    try:
        for region in HOSTS:
            result = host(region, switch, sha, live[region]['sha'])
            require(validate_receipt(result) == target[region], 'activated artifact differs')
        check_live(host, target)
    except ReleaseError as error:
        restore_all(path, host, state)
        raise ReleaseError(f'release failed; predecessor restored ({error})') from None
    committed = {'current': target, 'previous': live, 'pending': None}
    persist(path, committed)
    return committed


def remote_host(source):
    def call(region, action, *args, archive=None):
        command = shlex.join(['sudo', '-n', 'python3', '-I', '-c', source, region, action, *args])
        ssh = ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
               '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', HOSTS[region], command]
        with archive.open('rb') if archive else nullcontext(subprocess.DEVNULL) as stream:
            try:
                response = subprocess.run(ssh, stdin=stream, capture_output=True, timeout=240)
            except subprocess.TimeoutExpired:
                raise ReleaseError(f'{region} {action} timed out') from None
            except OSError:
                raise ReleaseError(f'{region} {action} could not start') from None
        if response.returncode:
            raise ReleaseError(f'{region} {action} failed')
        try:
            return json.loads(response.stdout)
        except ValueError:
            raise ReleaseError(f'{region} {action} did not return a receipt') from None
    return call


def receive_archive(archive, size, digest):
    require(0 < size <= MAX_ARCHIVE and valid(DIGEST, digest), 'invalid input archive identity')
    remaining = size
    with archive.open('xb') as output:
        while remaining:
            block = sys.stdin.buffer.read(min(remaining, 1024 * 1024))
            require(block, 'truncated production archive')
            output.write(block)
            remaining -= len(block)
    require(not sys.stdin.buffer.read(1) and archive_info(archive) == (digest, str(size)),
            'received archive differs from the built bundle')


def run_remote(source, action, sha, size, digest):
    os.umask(0o077)
    state_dir = Path.home() / '.local/share/zenithjoy/dashboard-production'
    if action != 'inspect':
        state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    if state_dir.exists() or state_dir.is_symlink():
        info = state_dir.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o077,
                'unsafe coordinator directory')
    state = state_dir / 'release.json'
    lock = state_dir / 'release.lock'
    lock_flags = os.O_NOFOLLOW | os.O_NONBLOCK
    if action != 'inspect':
        lock_flags |= os.O_CREAT | os.O_RDWR
    elif not lock.exists() and not lock.is_symlink():
        return run_transaction(state, remote_host(source), action)
    fd = os.open(lock, lock_flags, 0o600)
    with os.fdopen(fd, 'rb') as handle:
        info = os.fstat(handle.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o077,
                'unsafe coordinator lock')
        try:
            fcntl.flock(handle, (fcntl.LOCK_SH if action == 'inspect' else fcntl.LOCK_EX) | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ReleaseError('another Dashboard operation is in progress') from None
        if action == 'promote':
            with tempfile.TemporaryDirectory(prefix='dashboard-input-', dir=state_dir) as folder:
                archive = Path(folder) / 'dashboard.tar.gz'
                receive_archive(archive, int(size), digest)
                return run_transaction(state, remote_host(source), action, sha, archive)
        return run_transaction(state, remote_host(source), action, sha)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--mmv':
        print(json.dumps(run_remote(*sys.argv[2:])))
        return
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['inspect', 'promote', 'rollback'])
    parser.add_argument('--sha', default='')
    parser.add_argument('--archive', type=Path)
    args = parser.parse_args()
    require((args.action == 'inspect' or valid(SHA, args.sha))
            and (args.archive is not None) == (args.action == 'promote'), 'invalid Dashboard release arguments')
    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location('mmv_ssh', here / 'hz-api-candidate.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    host_source = (here / 'dashboard-production-host.py').read_text()
    digest, size = archive_info(args.archive) if args.archive else ('', '0')
    coordinator = shlex.join(['python3', '-I', '-c', Path(__file__).read_text(), '--mmv',
                               host_source, args.action, args.sha, size, digest])
    with tempfile.TemporaryDirectory(prefix='dashboard-mmv-') as folder:
        ssh = module.outer_ssh(Path(folder), os.environ)
        with args.archive.open('rb') if args.archive else nullcontext(subprocess.DEVNULL) as stream:
            subprocess.run([*ssh, coordinator], stdin=stream, check=True, timeout=2400)


if __name__ == '__main__':
    try:
        main()
    except ReleaseError as error:
        print(f'Dashboard release refused: {error}', file=sys.stderr)
        sys.exit(1)
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
        print('Dashboard release refused: unable to execute or verify the operation', file=sys.stderr)
        sys.exit(1)
