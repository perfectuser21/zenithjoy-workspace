#!/usr/bin/env python3
"""维护epoch持有真实serial.guard；不发信号，不调用ADB/UI，只精确释放本人旧锁。"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import select
import stat
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent


def need(value):
    if not value:
        raise ValueError('MAINTENANCE_GUARD_UNPROVEN')


def emit(value):
    print(json.dumps(value), flush=True)


def regular(path):
    value = os.lstat(path)
    need(stat.S_ISREG(value.st_mode) and value.st_uid == os.getuid())
    return value


def load_local(name):
    need(name in ('qualification-maintenance-processes.py', 'qualification-maintenance-device.py'))
    spec = importlib.util.spec_from_file_location('maintenance_local', HERE / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_device(scope, request):
    need(request == {'op': 'device'})
    return load_local('qualification-maintenance-device.py').collect_device(scope['serial'])


def read_original(held, request):
    need(set(request) == {'op', 'scope'} and request['op'] == 'original')
    scope = request['scope']
    need(scope['serial'] == held['serial'] and scope['run_tag'] == held['owner']
         and scope['consumer_source'] == '353b910f11ce3852b2ef69c8ead5c37e97850b4a')
    code = """import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {readMaintenanceOriginal} from './qualification-maintenance-original.mjs';
const value=Buffer.from(JSON.stringify(readMaintenanceOriginal(JSON.parse(readFileSync(0,'utf8')))));
console.log(JSON.stringify({status:'observed',encoding:'gzip-base64',sha256:createHash('sha256').update(value).digest('hex'),
bytes:value.length,data:gzipSync(value).toString('base64')}));"""
    env = {k: v for k, v in os.environ.items() if k not in ('NODE_OPTIONS', 'NODE_PATH')}
    result = subprocess.run(['/opt/homebrew/bin/node', '--input-type=module', '-e', code],
                            cwd=HERE, env=env, input=json.dumps(scope), text=True,
                            capture_output=True, timeout=30)
    need(result.returncode == 0 and len(result.stdout) <= 8 * 1024 * 1024)
    return json.loads(result.stdout)


def run():
    scope = json.loads(sys.stdin.readline(65537))
    need(set(scope) == {'serial', 'profile', 'owner', 'deadline_seconds'})
    need(all(isinstance(scope[k], str) and re.fullmatch(r'[A-Za-z0-9_-]{1,120}', scope[k])
             for k in ('serial', 'profile', 'owner')))
    need(type(scope['deadline_seconds']) is int and 1 <= scope['deadline_seconds'] <= 300)
    # 默认正式路径；既有controller同一个测试根变量用于真实隔离fixture。
    root = Path(os.environ.get('DOUYIN_PHONE_TMP_ROOT', '/private/tmp/openclaw-phone'))
    need(root.is_absolute())
    guard = root / 'locks' / (scope['serial'] + '.guard')
    lock = root / 'locks' / (scope['serial'] + '.lock')
    metadata = regular(guard)
    fd = os.open(guard, os.O_RDWR | os.O_NOFOLLOW)
    try:
        actual = os.fstat(fd)
        need((actual.st_dev, actual.st_ino) == (metadata.st_dev, metadata.st_ino))
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def local_owner():
            if not os.path.lexists(lock):
                return 'free'
            need(stat.S_ISDIR(os.lstat(lock).st_mode))
            owner = lock / 'owner'
            regular(owner)
            return 'original_owner' if owner.read_bytes() == (scope['owner'] + '\n').encode() else 'foreign_owner'
        processes = load_local('qualification-maintenance-processes.py')
        identity = processes.kernel(os.getpid())
        need(identity and identity['uid'] == os.getuid() and not identity['terminal'])
        emit({'status': 'guard_held', 'local_owner': local_owner(), 'pid': os.getpid(),
              'uid': identity['uid'], 'start_identity': identity['start_identity'],
              'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'guard_device': actual.st_dev, 'guard_inode': actual.st_ino})
        deadline = time.monotonic() + scope['deadline_seconds']
        attempted = False
        while time.monotonic() < deadline:
            remaining = deadline - time.monotonic()
            if not select.select([sys.stdin], [], [], remaining)[0]:
                return
            line = sys.stdin.readline(65537)
            if not line:
                return  # 协调者死去只放开guard，不触碰原owner/quarantine。
            request = json.loads(line)
            if request['op'] == 'status':
                need(set(request) == {'op'})
                emit({'status': 'guard_held', 'local_owner': local_owner()})
            elif request['op'] == 'device':
                emit(read_device(scope, request))
            elif request['op'] == 'original':
                emit(read_original(scope, request))
            elif request['op'] == 'release_exact':
                need(set(request) == {'op'})
                if attempted or local_owner() != 'original_owner':
                    emit({'status': 'blocked'})
                    continue
                marker = lock / 'standalone_review_required'
                regular(marker)
                need(marker.read_bytes() == (scope['owner'] + '\n').encode())
                attempted = True
                env = dict(os.environ, DOUYIN_LOCK_GUARDED=scope['serial'] + ':lock-release-exact',
                           DOUYIN_LOCK_GUARD_FD=str(fd))
                result = subprocess.run(['/bin/zsh', str(HERE / 'douyin-phone-adb'), '--profile',
                                         scope['profile'], 'lock-release-exact', scope['owner']],
                                        env=env, pass_fds=(fd,), capture_output=True, timeout=min(20, remaining))
                emit({'status': 'released' if result.returncode == 0 and local_owner() == 'free' else 'unknown',
                      'exit_code': result.returncode})
            else:
                raise ValueError('MAINTENANCE_GUARD_UNPROVEN')
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        run()
    except Exception:
        emit({'status': 'blocked', 'code': 'MAINTENANCE_GUARD_UNPROVEN'})
        sys.exit(1)
