#!/usr/bin/env python3
"""ADB前台服务：默认单实例不变；显式受审实例须维护启动授权。"""
import argparse
from contextlib import contextmanager, ExitStack
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import pwd
import re
import signal
import socket
import stat
import subprocess
import sys
import time
import types

HERE = Path(__file__).resolve().parent
route_path = HERE / 'adb-existing-route.py'
route = types.ModuleType('adb_existing_route')
route.__file__ = str(route_path)
exec(compile(route_path.read_bytes(), str(route_path), 'exec'), route.__dict__)
POLICY = {'schema_version': 1, 'host_id': 'xian-m4', 'transport': 'usb',
          'endpoint': 'tcp:127.0.0.1:5037', 'forbidden_ports': [5041, 5042],
          'adb_bin': '/opt/homebrew/bin/adb'}
LABEL = 'com.zenithjoy.adb-host'


def require(value, code):
    if not value:
        raise ValueError('ADB_SERVICE_' + code)


def load_policy(path):
    require(os.path.isabs(path), 'CONFIG_PATH')
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        raise ValueError('ADB_SERVICE_CONFIG_PERMISSIONS') from error
    with os.fdopen(fd, encoding='utf8') as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
                and stat.S_IMODE(info.st_mode) == 0o600, 'CONFIG_PERMISSIONS')
        original = json.load(source)
        previous = os.environ.get('ZJ_ADB_HOST_CONFIG')
        try:
            os.environ['ZJ_ADB_HOST_CONFIG'] = path
            policy = route.read_host_policy()
        finally:
            if previous is None:
                os.environ.pop('ZJ_ADB_HOST_CONFIG', None)
            else:
                os.environ['ZJ_ADB_HOST_CONFIG'] = previous
        after = os.lstat(path)
        require((info.st_dev, info.st_ino) == (after.st_dev, after.st_ino)
                and {**original, 'port': policy['port']} == policy, 'CONFIG_CHANGED')
    return policy


def validate_host(policy, hostname=None, uid=None):
    hostname = socket.gethostname() if hostname is None else hostname
    uid = os.geteuid() if uid is None else uid
    require(uid != 0, 'ROOT_FORBIDDEN')
    # 与runtime-host.mjs相同的规范机器名规则；不信环境里的宿主声明。
    name = hostname.lower().split('.')[0]
    if policy.get('schema_version') == 2:
        row = route.instance_module().registry()[0]
        expected = [r for r in row['instances'] if r['instance_id'] == policy.get('instance_id') and r['kind'] == 'managed']
        require(len(expected) == 1 and {k: v for k, v in policy.items() if k != 'port'} == expected[0]['policy']
                and policy.get('endpoint') == 'tcp:127.0.0.1:' + str(policy.get('port')), 'INSTANCE_POLICY')
        require(name in ('r10-7', 'aad17-2') and policy['host_id'] == 'mmv', 'HOST_IDENTITY')
        return
    require('m4-xian' in name, 'HOST_IDENTITY')
    require(all(policy.get(k) == v for k, v in POLICY.items())
            and policy.get('port', 5037) == 5037, 'POLICY_MISMATCH')


def clean_environment(environment):
    return {k: v for k, v in environment.items()
            if not k.startswith(('ADB_', 'ANDROID_ADB_'))
            and k not in ('ANDROID_SERIAL', 'ANDROID_VENDOR_KEYS')}


def instance_environment(environment):
    # daemon及version仅需系统运行环境；Brain token仅单独进入固定verifier child。
    return route.instance_module().adb_environment(environment)


def foreground_command(policy):
    # adb服务端listen语法不接受hostname；不加-a时仍仅默认loopback监听。
    if policy.get('schema_version') == 2:
        require(policy.get('endpoint') == 'tcp:127.0.0.1:' + str(policy.get('port')), 'INSTANCE_ENDPOINT')
        route.instance_module().verify_binary(policy)
        return [policy['adb_realpath'], '-L', 'tcp:' + str(policy['port']), 'server', 'nodaemon']
    return [policy['adb_bin'], '-L', 'tcp:5037', 'server', 'nodaemon']


def check_client(policy, environment, runner=subprocess.run):
    if policy.get('schema_version') == 2:
        environment = instance_environment(environment)
        route.instance_module().verify_binary(policy)
    binary = policy['adb_realpath'] if policy.get('schema_version') == 2 else policy['adb_bin']
    result = runner([binary, 'version'], env=environment,
                    capture_output=True, text=True, timeout=3)
    require(result.returncode == 0 and re.search(
        r'^Android Debug Bridge version 1\.0\.41\r?$', result.stdout, re.M), 'CLIENT_PROTOCOL')


def ensure_absent(policy, probe=route.smart_request):
    if policy.get('schema_version') == 2:
        require(policy.get('endpoint') == 'tcp:127.0.0.1:' + str(policy.get('port')), 'INSTANCE_ENDPOINT')
    deadline = time.monotonic() + 2
    for port in [policy['port'], *policy['forbidden_ports']]:
        # 所有响应（包括错误协议）都意味着已有服务，绝不通过adb抢占。
        require(probe(port, 'host:version', deadline) is None, 'EXISTING_SERVER')


@contextmanager
def service_lock(path, shared=False):
    try:
        fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    except OSError as error:
        raise ValueError('ADB_SERVICE_LOCK_INVALID') from error
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1, 'LOCK_INVALID')
        try:
            fcntl.flock(fd, (fcntl.LOCK_SH if shared else fcntl.LOCK_EX) | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError('ADB_SERVICE_LOCKED') from error
        yield fd
    finally:
        os.close(fd)


@contextmanager
def instance_service_locks(directory, policy):
    require(re.fullmatch('[a-z][a-z0-9-]{2,63}', policy.get('instance_id', ''))
            and type(policy.get('port')) is int and 1 <= policy['port'] <= 65535, 'INSTANCE_LOCK_SCOPE')
    with ExitStack() as locks:
        # 原默认EX与所有新实例SH互斥；只允许受审实例之间共享global gate。
        locks.enter_context(service_lock(str(directory / 'adb-host.lock'), shared=True))
        own = locks.enter_context(service_lock(str(directory / ('adb-host.instance-' + policy['instance_id'] + '.lock'))))
        locks.enter_context(service_lock(str(directory / ('adb-host.port-' + str(policy['port']) + '.lock'))))
        yield own


def status(policy, inspector=route.inspect_managed_host):
    return inspector(policy)


def stop_child(child, signum):
    if child.poll() is None:
        child.send_signal(signum)
    try:
        child.wait(timeout=10)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError('ADB_SERVICE_STOP_UNCONFIRMED') from error
    require(child.poll() is not None, 'STOP_UNCONFIRMED')


def run_service(policy, config, maintenance_receipt=None):
    validate_host(policy)
    user = pwd.getpwuid(os.geteuid())
    require(os.environ.get('HOME') == user.pw_dir, 'HOME_MISMATCH')
    environment = instance_environment(os.environ) if policy.get('schema_version') == 2 else clean_environment(os.environ)
    lock_directory = Path(user.pw_dir) / '.config/zenithjoy'
    private_directory(lock_directory)
    # 锁按宿主/用户固定，不能用另一个config目录逃过同一supervisor互斥。
    lock_path = str(lock_directory / 'adb-host.lock')
    multi = policy.get('schema_version') == 2
    owned_locks = instance_service_locks(lock_directory, policy) if multi else service_lock(lock_path)
    with owned_locks as lock_fd:
        def authorize():
            if multi:
                require(load_policy(config) == policy, 'INSTANCE_CONFIG_CHANGED')
                return route.instance_module().authorize_start(policy, config, maintenance_receipt)
        first_authority = json.loads(json.dumps(authorize()))
        ensure_absent(policy)
        check_client(policy, environment)
        # 再核一次，避免version检查期间新服务出现；不向既有server发任何停止命令。
        ensure_absent(policy)
        final_authority = authorize()
        resume = multi and any(isinstance(a, dict) and a.get('protocol') == 'device-epoch-fence-startup-verification/v2' for a in (first_authority, final_authority))
        daemon_environment = environment
        if resume:
            require(first_authority == final_authority, 'RESUME_AUTHORITY_CHANGED')
            daemon_environment = route.instance_module().authenticated_environment(policy, config, final_authority, environment)
        child = subprocess.Popen(foreground_command(policy), env=daemon_environment, close_fds=True)
        old_handlers = {}
        forwarded = []
        def forward(signum, _frame):
            if resume:
                # The main wait owns reap. Nested wait in this handler would
                # deadlock on Popen's non-reentrant waitpid lock.
                if child.poll() is None:
                    child.send_signal(signum)
                    forwarded.append((child.pid, signum))
            else:
                stop_child(child, signum)
        try:
            os.ftruncate(lock_fd, 0)
            os.write(lock_fd, (json.dumps({'supervisor_pid': os.getpid(), 'child_pid': child.pid}) + '\n').encode())
            os.fsync(lock_fd)
            for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
                old_handlers[sig] = signal.signal(sig, forward)
            result = child.wait()
            require(result == 0 or resume and forwarded and forwarded[-1] == (child.pid, -result), 'CHILD_EXIT_FAILED')
        finally:
            try:
                if child.poll() is None:
                    stop_child(child, signal.SIGTERM)
            finally:
                for sig, handler in old_handlers.items():
                    signal.signal(sig, handler)
        # 保留PID记录供只读核验，不把文件删除当成已停止证据。
        require(child.poll() is not None, 'STOP_UNCONFIRMED')
        if resume:
            # Exact own endpoint only. No adb command, connect or global stop.
            ensure_absent(policy)


def launchd_definition(python, service, home, username):
    return {'Label': LABEL, 'UserName': username,
            'ProgramArguments': [python, service, 'run', '--config', str(Path(home) / '.config/zenithjoy/adb-service.json')],
            'EnvironmentVariables': {'HOME': home, 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
            'KeepAlive': True, 'ThrottleInterval': 30, 'RunAtLoad': True,
            'StandardOutPath': str(Path(home) / '.config/zenithjoy/adb-host.stdout.log'),
            'StandardErrorPath': str(Path(home) / '.config/zenithjoy/adb-host.stderr.log')}


def private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
            and stat.S_IMODE(info.st_mode) == 0o700, 'STAGING_DIRECTORY')


def write_once(path, data, mode):
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, mode)
    except FileExistsError:
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
                and stat.S_IMODE(info.st_mode) == mode and path.read_bytes() == data, 'STAGED_CONFLICT')
        return
    with os.fdopen(fd, 'wb') as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())


def stage(manifest_path):
    validate_host({**POLICY, 'port': 5037})
    user = pwd.getpwuid(os.geteuid())
    require(user.pw_name == 'jinnuoshengyuan' and os.environ.get('HOME') == user.pw_dir, 'USER_HOME_MISMATCH')
    manifest = json.loads(Path(manifest_path).read_text())
    require(manifest.get('source_repo') == 'perfectuser21/zenithjoy-workspace'
            and re.fullmatch(r'[a-f0-9]{40}', manifest.get('source_commit', '')), 'MANIFEST_SOURCE')
    # 只验证正式manifest认领的全部安装代码，不信脚本所在路径本身。
    for name in ('adb-host-service.py', 'adb-existing-route.py', 'install-adb-host-service.sh'):
        relative = 'services/phone-adb-controller/' + name
        rows = [row for row in manifest.get('files', []) if row.get('path') == relative]
        require(len(rows) == 1 and rows[0].get('content_sha256') == hashlib.sha256((HERE / name).read_bytes()).hexdigest(), 'MANIFEST_BYTES')
    base = Path(user.pw_dir) / '.config/zenithjoy'
    private_directory(base)
    staging = base / 'staging'
    private_directory(staging)
    policy_bytes = (json.dumps(POLICY, sort_keys=True) + '\n').encode()
    # 已有active配置不属于stage写入范围；不兼容内容必须交维护流程处理。
    active = base / 'adb-service.json'
    if active.exists() or active.is_symlink():
        require({k: v for k, v in load_policy(str(active)).items() if k != 'port'} == POLICY, 'ACTIVE_POLICY_CONFLICT')
    plist = plistlib.dumps(launchd_definition(str(Path(sys.executable).resolve()), str(HERE / 'adb-host-service.py'), user.pw_dir, user.pw_name))
    installed_plist = Path('/Library/LaunchDaemons') / (LABEL + '.plist')
    if installed_plist.exists() or installed_plist.is_symlink():
        info = installed_plist.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0
                and stat.S_IMODE(info.st_mode) == 0o644
                and installed_plist.read_bytes() == plist, 'INSTALLED_PLIST_CONFLICT')
    staged_policy = base / 'adb-service.staged.json'
    staged_plist = staging / (LABEL + '.plist')
    write_once(staged_policy, policy_bytes, 0o600)
    write_once(staged_plist, plist, 0o644)
    subprocess.run(['/usr/bin/plutil', '-lint', str(staged_plist)], check=True, capture_output=True, timeout=5)
    print(json.dumps({'staged_policy': str(staged_policy), 'policy_sha256': hashlib.sha256(policy_bytes).hexdigest(),
                      'staged_plist': str(staged_plist), 'plist_sha256': hashlib.sha256(plist).hexdigest(),
                      'source_commit': manifest['source_commit'], 'activated': False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['run', 'status'])
    parser.add_argument('--config', required=True)
    parser.add_argument('--maintenance-receipt')
    args = parser.parse_args()
    policy = load_policy(args.config)
    validate_host(policy)
    if args.command == 'status':
        print(json.dumps(status(policy)))
    else:
        run_service(policy, args.config, args.maintenance_receipt)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error)
        print(message if message.startswith(('ADB_SERVICE_', 'ADB_HOST_', 'ADB_ROUTE_', 'ADB_INSTANCE_')) else 'ADB_SERVICE_FAILED', file=sys.stderr)
        sys.exit(2)
