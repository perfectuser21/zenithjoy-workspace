#!/usr/bin/env python3
"""维护epoch持有真实serial.guard；不发信号，不调用ADB/UI，只精确释放本人旧锁。"""
import fcntl
import base64
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
STAGE = 'guard_setup'


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
    value = load_local('qualification-maintenance-device.py').collect_device(scope['serial'])
    value['observer_sha256'] = hashlib.sha256((HERE / 'qualification-maintenance-device.py').read_bytes()).hexdigest()
    return value


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


def read_domain(held, request, identity):
    global STAGE
    STAGE = 'domain_authority'
    need(set(request) == {'op', 'scope', 'epoch'} and request['op'] == 'domain')
    scope, epoch = request['scope'], request['epoch']
    need(scope['serial'] == held['serial'] and scope['run_tag'] == held['owner'] and scope['uid'] == os.getuid())
    need(set(epoch) == {'maintenance_task_id', 'intent_id', 'candidate_sha', 'guard_pid',
                        'guard_start_identity', 'guard_script_path', 'guard_script_sha256'})
    need(all(re.fullmatch(r'[a-f0-9-]{36}', epoch[k]) for k in ('maintenance_task_id', 'intent_id')))
    need(re.fullmatch(r'[a-f0-9]{40}', epoch['candidate_sha']) and epoch['candidate_sha'] == HERE.parent.name
         and epoch['guard_pid'] == identity['pid'] == os.getpid()
         and epoch['guard_start_identity'] == identity['start_identity']
         and epoch['guard_script_path'] == str(HERE / 'qualification-maintenance-host.py')
         and epoch['guard_script_sha256'] == identity['script_sha256'])
    file = HERE / 'qualification-maintenance-domain.mjs'
    STAGE = 'domain_source'
    regular(file)
    source = file.read_text()
    need(len(source) <= 1024 * 1024)
    matches = re.findall(r"^export const DOMAIN_COLLECTOR_BASE64='([A-Za-z0-9+/=]+)';$", source, re.M)
    need(len(matches) == 1)
    code = base64.b64decode(matches[0], validate=True)
    need(len(code) <= 65536)
    namespace = {'__collector_sha256__': hashlib.sha256(code).hexdigest()}
    # 仅同一实际候选内经源字节准入的固定literal；请求不能传code/verified。
    exec(compile(code, str(file), 'exec'), namespace)
    STAGE = 'domain_collect'
    return namespace['collect_domain'](scope, epoch)


def run():
    global STAGE
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
        identity['script_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        emit({'status': 'guard_held', 'local_owner': local_owner(), 'pid': os.getpid(),
              'uid': identity['uid'], 'start_identity': identity['start_identity'],
              'script_sha256': identity['script_sha256'],
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
                STAGE = 'status'
                need(set(request) == {'op'})
                emit({'status': 'guard_held', 'local_owner': local_owner()})
            elif request['op'] == 'device':
                STAGE = 'device'
                emit(read_device(scope, request))
            elif request['op'] == 'original':
                STAGE = 'original'
                emit(read_original(scope, request))
            elif request['op'] == 'domain':
                emit(read_domain(scope, request, identity))
            elif request['op'] == 'release_exact':
                STAGE = 'release_exact'
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
    except Exception as error:
        frames, trace = [], error.__traceback__
        allowed = {'qualification-maintenance-host.py', 'qualification-maintenance-domain.mjs',
                   'qualification-maintenance-processes.py', 'qualification-maintenance-device.py', 'adb-process-observation.py'}
        while trace:
            name = Path(trace.tb_frame.f_code.co_filename).name
            if name in allowed:
                frames.append({'file': name, 'line': trace.tb_lineno})
            trace = trace.tb_next
        kind = type(error).__name__
        if kind not in ('ValueError', 'KeyError', 'TypeError', 'OSError', 'PermissionError', 'FileNotFoundError',
                        'JSONDecodeError', 'UnicodeDecodeError', 'TimeoutExpired', 'CalledProcessError'):
            kind = 'Exception'
        emit({'status': 'blocked', 'code': 'MAINTENANCE_GUARD_UNPROVEN', 'stage': STAGE,
              'exception_type': kind, 'frames': frames[-6:]})
        sys.exit(1)
