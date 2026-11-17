"""固定SDK33 Darwin/arm64客户端的私有同ABI库；不访问ADB或手机。"""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import sys


def regular(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise ValueError('private runtime artifact is not a regular file')
            return stream.read()
    except OSError as error:
        raise ValueError('private runtime artifact unavailable') from error


def digest(data):
    return hashlib.sha256(data).hexdigest()


def dependency_lock():
    path = Path(__file__).with_name('runtime-private-deps-sdk33.darwin-arm64.json')
    raw = regular(path)
    try:
        lock = json.loads(raw)
        assert lock['schema'] == 'scrcpy-private-dylibs-v1'
        assert lock['platform'] == 'darwin' and lock['architecture'] == 'arm64'
        rows = lock['libraries']
        assert isinstance(rows, list) and rows
        names = [row['name'] for row in rows]
        assert len(names) == len(set(names))
        assert all(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_+.-]+\.dylib', name) for name in names)
        for row in rows:
            assert re.fullmatch(r'[a-f0-9]{64}', row['sha256'])
            assert type(row['bytes']) is int and row['bytes'] > 0
            assert isinstance(row['dependencies'], list) and set(row['dependencies']) <= set(names)
        assert isinstance(lock['client_dependencies'], list) and set(lock['client_dependencies']) <= set(names)
    except (ValueError, KeyError, TypeError, AssertionError) as error:
        raise ValueError('private runtime dependency lock invalid') from error
    return raw, lock


def verify_dependencies(runtime_root):
    root = Path(runtime_root)
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise ValueError('private runtime root invalid')
    raw, lock = dependency_lock()
    if regular(root / 'private-dependencies.json') != raw:
        raise ValueError('private runtime dependency lock mismatch')
    policy = json.loads(regular(Path(__file__).with_name('runtime-policy-sdk33.json')))
    if ((policy.get('schema'), policy.get('version')) != ('scrcpy-sdk33-pinned-v1', '3.3.4')
            or lock['client_sha256'] != policy['client_sha256']):
        raise ValueError('private runtime client identity mismatch')
    for filename, field in [('scrcpy', 'client_sha256'), ('scrcpy-server', 'server_sha256')]:
        if digest(regular(root / filename)) != policy[field]:
            raise ValueError('private runtime fixed client/server hash mismatch')
    lib = root / 'lib'
    if lib.is_symlink() or not lib.is_dir() or set(os.listdir(lib)) != {row['name'] for row in lock['libraries']}:
        raise ValueError('private runtime library set mismatch')
    for row in lock['libraries']:
        data = regular(lib / row['name'])
        if len(data) != row['bytes'] or digest(data) != row['sha256']:
            raise ValueError('private runtime library hash mismatch: ' + row['name'])
    return {'library_directory': str(lib), 'library_count': len(lock['libraries']),
            'dependencies_sha256': digest(raw)}


def host_platform():
    return sys.platform, platform.machine()


def runtime_environment(runtime_root, runtime_kind, environment=None):
    env = dict(os.environ if environment is None else environment)
    if runtime_kind != 'sdk33':
        raise ValueError('private runtime is only approved for sdk33')
    if host_platform() != ('darwin', 'arm64'):
        raise ValueError('private runtime host platform is not approved')
    verified = verify_dependencies(runtime_root)
    env = {key: value for key, value in env.items() if not key.startswith('DYLD_')}
    env['DYLD_LIBRARY_PATH'] = verified['library_directory']
    env['DYLD_FALLBACK_LIBRARY_PATH'] = ''
    return env


def startup_check(runtime_root):
    root = Path(runtime_root)
    env = runtime_environment(root, 'sdk33')
    try:
        result = subprocess.run([str(root / 'scrcpy'), '--version'], stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, timeout=5, check=False, env=env)
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError('private runtime startup failed') from error
    if result.returncode or not re.match(r'^scrcpy 3\.3\.4(?:\s|$)', result.stdout):
        raise ValueError('private runtime startup/version failed: ' + result.stderr[-1000:])
    verified = verify_dependencies(root)
    return {**verified, 'startup_verified': True, 'startup_version': '3.3.4',
            'startup_stdout': result.stdout[:4000], 'startup_stdout_sha256': digest(result.stdout.encode())}
