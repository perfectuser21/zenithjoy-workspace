#!/usr/bin/env python3
"""已正式安装后的M4 ADB维护：plan只读；apply须已有四个中央/本地维护锁。"""
import argparse
from contextlib import ExitStack, redirect_stdout
import datetime
import ctypes
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import pwd
import re
import shlex
import signal
import socket
import stat
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
REPO = 'perfectuser21/zenithjoy-workspace'
SERIALS = ('ANGYVB4402004137', 'ANGYVB4227006983', 'ANGYVB4311010223', 'e6c7ef34')
PORTS = (5037, 5041, 5042)
REQUIRED_FILES = ('adb-host-maintenance.py', 'adb-existing-route.py', 'adb-managed-client.py',
                  'adb-host-service.py', 'install-adb-host-service.sh', 'phone-lock-helper.py')
LOCK_ROOT = Path('/private/tmp/openclaw-phone/locks')
SERVICE_LABEL = 'com.zenithjoy.adb-host'


def need(value, code):
    if not value:
        raise ValueError('ADB_MAINTENANCE_' + code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def plan_digest(plan):
    return digest({k: v for k, v in plan.items() if k != 'plan_sha256'})


def validate_plan(plan, expected, task, source):
    need(plan.get('plan_sha256') == expected == plan_digest(plan), 'PLAN_HASH')
    need(plan.get('task') == task and plan.get('source_commit') == source, 'PLAN_BINDING')


def read_private(path):
    need(Path(path).is_absolute(), 'INPUT_PATH')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as handle:
        info = os.fstat(handle.fileno())
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
             and stat.S_IMODE(info.st_mode) == 0o600, 'INPUT_PERMISSIONS')
        return json.load(handle)


def verify_manifest(path, root):
    root = Path(root).resolve()
    manifest = json.loads(Path(path).read_text())
    need(manifest.get('source_repo') == REPO and isinstance(manifest.get('source_commit'), str)
         and re.fullmatch('[a-f0-9]{40}', manifest['source_commit']), 'MANIFEST_SOURCE')
    need(isinstance(manifest.get('files'), list), 'MANIFEST_FILES')
    for name in REQUIRED_FILES:
        rows = [x for x in manifest['files'] if x.get('path') == 'services/phone-adb-controller/' + name]
        need(len(rows) == 1, 'MANIFEST_FILES')
        row = rows[0]
        relative = row.get('deployed_path')
        need(isinstance(relative, str) and relative == name, 'MANIFEST_PATH')
        installed = root / relative
        need(not installed.is_symlink() and installed.resolve().parent == root and installed.is_file(), 'MANIFEST_PATH')
        need(hashlib.sha256(installed.read_bytes()).hexdigest() == row.get('content_sha256'), 'MANIFEST_BYTES')
    return manifest


def load_module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def command(args, *, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True, timeout=15,
                          env={k: v for k, v in os.environ.items() if k in ('HOME', 'PATH', 'LANG', 'TMPDIR', 'SSH_AUTH_SOCK')})


def check_tasks(tasks, task_id, actor):
    rows = [row for row in tasks if row.get('id') == task_id]
    need(len(rows) == 1 and rows[0].get('status') == 'in_progress'
         and rows[0].get('claimed_by') == actor, 'TASK_OWNER')
    helper = load_module('phone-lock-helper')
    for row in tasks:
        if row.get('id') == task_id:
            continue
        serials, profiles = helper.device_values(row.get('payload', {}))
        need(not serials.intersection(x.lower() for x in SERIALS), 'ACTIVE_DEVICE_TASK')
        if row.get('task_type') in ('qiumi_task', 'workflow_run', 'device_job'):
            need(bool(serials), 'ACTIVE_DEVICE_TASK')
    return rows[0]


def check_central(document, task, now=None):
    now = time.time() if now is None else now
    need(isinstance(document, dict) and document.get('success') is True
         and isinstance(document.get('locks'), list), 'CENTRAL_LOCK_RESPONSE')
    for serial in SERIALS:
        rows = [r for r in document['locks'] if isinstance(r, dict) and r.get('device_name') == serial]
        need(len(rows) == 1, 'CENTRAL_LOCK_MISSING_OR_DUPLICATE')
        row = rows[0]
        try:
            parsed = datetime.datetime.fromisoformat(row['expires_at'].replace('Z', '+00:00'))
            need(parsed.tzinfo is not None, 'CENTRAL_LOCK_EXPIRY')
            expiry = parsed.timestamp()
        except (KeyError, TypeError, ValueError):
            raise ValueError('ADB_MAINTENANCE_CENTRAL_LOCK_EXPIRY')
        need(row.get('locked_by') == task and row.get('expired') is False
             and expiry > now + 180, 'CENTRAL_LOCK_OWNER_OR_EXPIRY')


def check_local(root, owner, now=None):
    now = time.time() if now is None else now
    need(isinstance(owner, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}', owner), 'LOCAL_OWNER')
    root_info = Path(root).lstat()
    need(stat.S_ISDIR(root_info.st_mode) and root_info.st_uid == os.geteuid()
         and not root_info.st_mode & 0o022, 'LOCAL_LOCK_ROOT')
    for serial in SERIALS:
        directory = Path(root) / (serial + '.lock')
        need(directory.is_dir() and not directory.is_symlink(), 'LOCAL_LOCK_MISSING')
        for name in ('owner', 'acquired_at'):
            f = directory / name
            need(f.is_file() and not f.is_symlink() and f.stat().st_uid == os.geteuid(), 'LOCAL_LOCK_FILE')
        text = (directory / 'owner').read_text()
        need(text in (owner, owner + '\n'), 'LOCAL_LOCK_OWNER')
        try:
            age = now - int((directory / 'acquired_at').read_text().strip())
        except ValueError:
            raise ValueError('ADB_MAINTENANCE_LOCAL_LOCK_TIME')
        need(0 <= age < 1500, 'LOCAL_LOCK_EXPIRY')


def read_authority(task, actor, owner):
    helper = load_module('phone-lock-helper')
    previous = os.environ.pop('DOUYIN_LOCK_SSH_BIN', None)
    try:
        tasks = helper.task_list()
    finally:
        if previous is not None:
            os.environ['DOUYIN_LOCK_SSH_BIN'] = previous
    row = check_tasks(tasks, task, actor)
    # 与既有task_list相同的只读SSH通道；不读/复制token，不做acquire/heartbeat。
    response = command(['/usr/bin/ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'mmv',
                        "curl --fail --silent --show-error --connect-timeout 3 --max-time 8 'http://localhost:5221/api/brain/device-locks'"])
    check_central(json.loads(response.stdout), task)
    check_local(LOCK_ROOT, owner)
    for serial in SERIALS:
        need(helper.owner_matches(str(LOCK_ROOT / (serial + '.lock') / 'owner'), owner), 'LOCAL_LOCK_OWNER')
    return {k: row.get(k) for k in ('id', 'claimed_by', 'claimed_at')}


def known_adb(executable, uid, expected_uid, argv, port, canonical=None):
    canonical = str(Path('/opt/homebrew/bin/adb').resolve()) if canonical is None else canonical
    if executable != canonical or uid != expected_uid:
        return False
    try:
        args = shlex.split(argv)
    except ValueError:
        return False
    return (len(args) == 7 and Path(args[0]).name == 'adb' and args[1] == '-L'
            and args[2] in ('tcp:localhost:' + str(port), 'tcp:127.0.0.1:' + str(port), 'tcp:' + str(port))
            and args[3:6] == ['fork-server', 'server', '--reply-fd'] and args[6].isdigit())



def process_executable(pid, loader=ctypes.CDLL):
    # Darwin ps comm可能只有adb basename；必须从内核读取真实执行文件，不猜路径。
    need(sys.platform == 'darwin', 'PROCESS_EXECUTABLE_PLATFORM')
    library = loader('/usr/lib/libproc.dylib', use_errno=True)
    function = library.proc_pidpath
    function.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
    function.restype = ctypes.c_int
    buffer = ctypes.create_string_buffer(4096)
    size = function(pid, buffer, len(buffer))
    need(0 < size < len(buffer), 'PROCESS_EXECUTABLE_UNAVAILABLE')
    path = os.fsdecode(buffer.value)
    need(os.path.isabs(path) and Path(path).is_file(), 'PROCESS_EXECUTABLE_INVALID')
    return str(Path(path).resolve())


def process_identity(pid):
    fields = {}
    for key in ('uid', 'lstart', 'args'):
        result = command(['/bin/ps', '-ww', '-p', str(pid), '-o', key + '='], check=False)
        if result.returncode == 1 and not result.stdout.strip():
            return None
        need(result.returncode == 0 and result.stdout.strip(), 'PROCESS_INSPECTION')
        fields[key] = result.stdout.strip()
    executable = process_executable(pid)
    after = command(['/bin/ps', '-ww', '-p', str(pid), '-o', 'lstart='], check=False)
    need(after.returncode == 0 and after.stdout.strip() == fields['lstart'], 'PROCESS_CHANGED')
    return {'pid': pid, 'uid': int(fields['uid']), 'lstart': fields['lstart'],
            'executable': executable,
            'argv_sha256': hashlib.sha256(fields['args'].encode()).hexdigest(), '_argv': fields['args']}


def public_identity(value):
    return None if value is None else {k: v for k, v in value.items() if not k.startswith('_')}


def listeners():
    rows = {}
    for port in PORTS:
        result = command(['/usr/sbin/lsof', '-nP', '-a', '-iTCP:' + str(port), '-sTCP:LISTEN', '-Fp'], check=False)
        need(result.returncode in (0, 1) and not result.stderr.strip(), 'LISTENERS_UNREADABLE')
        pids = sorted({int(line[1:]) for line in result.stdout.splitlines() if re.fullmatch(r'p[0-9]+', line)})
        need(not result.stdout.strip() or pids, 'LISTENERS_INVALID')
        identities = []
        for pid in pids:
            identity = process_identity(pid)
            need(identity is not None and known_adb(identity['executable'], identity['uid'], os.geteuid(), identity['_argv'], port), 'UNKNOWN_SERVER')
            identities.append(public_identity(identity))
        rows[str(port)] = identities
    return rows


def file_state(path):
    path = Path(path)
    if not path.exists() and not path.is_symlink():
        return None
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'FILE_UNKNOWN')
    return {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'uid': info.st_uid,
            'mode': stat.S_IMODE(info.st_mode), 'inode': info.st_ino, 'device': info.st_dev}


def label_specs(home, uid):
    return [(f'gui/{uid}/com.zenithjoy.phonewallpush', str(home / 'Library/LaunchAgents/com.zenithjoy.phonewallpush.plist')),
            (f'gui/{uid}/com.zj.wall-push', str(home / 'Library/LaunchAgents/com.zj.wall-push.plist')),
            (f'gui/{uid}/com.zenithjoy.devicejobclaimer', str(home / 'Library/LaunchAgents/com.zenithjoy.devicejobclaimer.plist')),
            ('system/com.zenithjoy.phonerecovery', '/Library/LaunchDaemons/com.zenithjoy.phonerecovery.plist')]


def launchctl(args, system=False, check=True):
    return command((['/usr/bin/sudo', '-n'] if system else []) + ['/bin/launchctl', *args], check=check)


def label_state(target, plist):
    result = launchctl(['print', target], system=target.startswith('system/'), check=False)
    absent = result.returncode != 0 and 'Could not find service' in result.stderr
    need(result.returncode == 0 or absent, 'LABEL_UNREADABLE')
    file = file_state(plist)
    if file:
        data = plistlib.loads(Path(plist).read_bytes())
        need(data.get('Label') == target.split('/')[-1], 'LABEL_PLIST_IDENTITY')
        if target.startswith('system/'):
            need(file['uid'] == 0 and file['mode'] == 0o644 and data.get('UserName') == 'jinnuoshengyuan', 'LABEL_PLIST_OWNER')
        else:
            need(file['uid'] == os.geteuid(), 'LABEL_PLIST_OWNER')
    need(absent or file is not None, 'LOADED_WITHOUT_PLIST')
    return {'target': target, 'plist': plist, 'file': file, 'loaded': not absent,
            'runtime_sha256': hashlib.sha256(result.stdout.encode()).hexdigest() if not absent else None}


def machine():
    user = pwd.getpwuid(os.geteuid())
    need(os.geteuid() != 0 and user.pw_name == 'jinnuoshengyuan' and os.environ.get('HOME') == user.pw_dir
         and 'm4-xian' in socket.gethostname().lower().split('.')[0], 'HOST_USER_HOME')
    return {'hostname': socket.gethostname(), 'uid': os.geteuid(), 'user': user.pw_name, 'home': user.pw_dir}


def snapshot(host):
    home = Path(host['home'])
    service_target = 'system/' + SERVICE_LABEL
    service_plist = '/Library/LaunchDaemons/' + SERVICE_LABEL + '.plist'
    service = label_state(service_target, service_plist)
    need(not service['loaded'], 'SERVICE_ALREADY_ACTIVE')
    active = file_state(home / '.config/zenithjoy/adb-service.json')
    need(active is None, 'POLICY_ALREADY_ACTIVE')
    return {'servers': listeners(), 'consumers': [label_state(*args) for args in label_specs(home, host['uid'])],
            'service': service, 'active_policy': active}


def make_plan(manifest_path, task, actor, owner):
    host = machine()
    manifest_path = Path(manifest_path).resolve()
    need(manifest_path.parent == HERE and manifest_path.name == 'deployment-manifest.json', 'INSTALLED_ROOT')
    manifest = verify_manifest(manifest_path, HERE)
    authority = read_authority(task, actor, owner)
    need(authority.get('claimed_at'), 'TASK_CLAIM_TIME')
    plan = {'schema_version': 1, 'task': task, 'actor': actor, 'local_owner': owner, 'host': host,
            'source_repo': REPO, 'source_commit': manifest['source_commit'], 'manifest': str(manifest_path),
            'manifest_sha256': hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
            'authority': authority, 'snapshot': snapshot(host)}
    plan['plan_sha256'] = plan_digest(plan)
    return plan


class Journal:
    def __init__(self, path, binding):
        self.path = Path(path)
        try:
            fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except FileExistsError as error:
            raise ValueError('ADB_MAINTENANCE_JOURNAL_EXISTS') from error
        self.binding = binding
        with os.fdopen(fd, 'w') as out:
            out.write(json.dumps({'phase': 'reserved', **binding}) + '\n')
            out.flush()
            os.fsync(out.fileno())
        directory = os.open(self.path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    def event(self, phase, **values):
        fd = os.open(self.path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
        with os.fdopen(fd, 'a') as out:
            out.write(json.dumps({'phase': phase, **self.binding, **values}) + '\n')
            out.flush()
            os.fsync(out.fileno())


def terminate_exact(expected, inspect=process_identity, send=os.kill, sleep=time.sleep):
    current = public_identity(inspect(expected['pid']))
    if current is None:
        return
    need(current == expected, 'PROCESS_CHANGED')
    send(expected['pid'], signal.SIGTERM)
    for _ in range(50):
        current = public_identity(inspect(expected['pid']))
        if current is None:
            return
        need(current == expected, 'PROCESS_CHANGED_AFTER_TERM')
        sleep(.1)
    raise RuntimeError('ADB_MAINTENANCE_PROCESS_STOP_UNPROVEN')


def install_root_plist(staged, target, expected):
    need(file_state(target) == expected, 'ROOT_PLIST_CAS')
    if expected is not None:
        need(Path(target).read_bytes() == Path(staged).read_bytes(), 'ROOT_PLIST_CONFLICT')
        return
    temp = target + '.maintenance-stage'
    need(file_state(temp) is None, 'ROOT_STAGE_EXISTS')
    command(['/usr/bin/sudo', '-n', '/usr/bin/install', '-o', 'root', '-g', 'wheel', '-m', '644', staged, temp])
    need(file_state(target) is None, 'ROOT_PLIST_CAS')
    # 原子create-if-absent，绝不mv覆盖并发出现的plist。
    command(['/usr/bin/sudo', '-n', '/bin/ln', temp, target])
    command(['/usr/bin/sudo', '-n', '/bin/rm', temp])
    value = file_state(target)
    need(value and value['uid'] == 0 and value['mode'] == 0o644
         and value['sha256'] == hashlib.sha256(Path(staged).read_bytes()).hexdigest(), 'ROOT_INSTALL_READBACK')


def preflight_sudo(plan, base):
    # 仅权限查询，无服务变更；停止consumer前明确核所有将用到的sudo命令。
    command(['/usr/bin/sudo', '-n', '/usr/bin/true'])
    target = plan['snapshot']['service']['plist']
    staged = str(base / 'staging' / (SERVICE_LABEL + '.plist'))
    temporary = target + '.maintenance-stage'
    actions = [
        ['/usr/bin/install', '-o', 'root', '-g', 'wheel', '-m', '644', staged, temporary],
        ['/bin/ln', temporary, target], ['/bin/rm', temporary],
        ['/bin/launchctl', 'bootstrap', 'system', target]]
    for consumer in plan['snapshot']['consumers']:
        if consumer['target'].startswith('system/') and consumer['loaded']:
            actions.extend([['/bin/launchctl', 'bootout', consumer['target']],
                            ['/bin/launchctl', 'bootstrap', 'system', consumer['plist']]])
    for argv in actions:
        command(['/usr/bin/sudo', '-n', '-l', '--', *argv])


def apply_plan(plan, expected_hash, task, source):
    validate_plan(plan, expected_hash, task, source)
    need(plan.get('schema_version') == 1 and plan.get('source_repo') == REPO, 'PLAN_SCHEMA')
    host = machine()
    need(host == plan['host'], 'HOST_CAS')
    manifest_path = Path(plan['manifest'])
    need(manifest_path.parent == HERE and manifest_path.name == 'deployment-manifest.json', 'INSTALLED_ROOT')
    manifest = verify_manifest(manifest_path, HERE)
    need(manifest['source_commit'] == source and hashlib.sha256(manifest_path.read_bytes()).hexdigest() == plan['manifest_sha256'], 'SOURCE_CAS')
    service = load_module('adb-host-service')
    base = Path(host['home']) / '.config/zenithjoy'
    service.private_directory(base)
    with ExitStack() as stack:
        stack.enter_context(service.service_lock(str(base / 'adb-maintenance.lock')))
        # 不获取/释放业务锁：只保持各设备既有guard，防apply期间owner被其他controller更改。
        for serial in SERIALS:
            stack.enter_context(service.service_lock(str(LOCK_ROOT / (serial + '.guard'))))
        def authority():
            need(read_authority(task, plan['actor'], plan['local_owner']) == plan['authority'], 'TASK_CLAIM_CHANGED')
        authority()
        need(snapshot(host) == plan['snapshot'], 'SNAPSHOT_CAS')
        preflight_sudo(plan, base)
        journal = Journal(base / 'adb-maintenance.journal.jsonl', {'task': task, 'source': source, 'plan_sha256': expected_hash})
        try:
            with redirect_stdout(io.StringIO()):
                service.stage(str(manifest_path))
            staged_policy = base / 'adb-service.staged.json'
            staged_plist = base / 'staging' / (SERVICE_LABEL + '.plist')
            journal.event('staged', policy_sha256=hashlib.sha256(staged_policy.read_bytes()).hexdigest(),
                          plist_sha256=hashlib.sha256(staged_plist.read_bytes()).hexdigest())
            authority()
            for consumer in plan['snapshot']['consumers']:
                need(label_state(consumer['target'], consumer['plist']) == consumer, 'CONSUMER_CAS')
                if consumer['loaded']:
                    launchctl(['bootout', consumer['target']], system=consumer['target'].startswith('system/'))
                if consumer['target'].endswith('/com.zj.wall-push'):
                    launchctl(['disable', consumer['target']])
            journal.event('consumers_paused')
            authority()
            for identities in plan['snapshot']['servers'].values():
                for identity in identities:
                    terminate_exact(identity)
            # 停旧进程后仍有新服务或未知listener时绝不启动新服务。
            need(not any(listeners().values()), 'SERVERS_REMAIN')
            service.ensure_absent({**service.POLICY, 'port': 5037})
            authority()
            need(file_state(base / 'adb-service.json') == plan['snapshot']['active_policy'], 'ACTIVE_POLICY_CAS')
            # 原子create-if-absent，不覆盖任何既有active policy。
            policy_bytes = staged_policy.read_bytes()
            need(json.loads(policy_bytes) == service.POLICY, 'STAGED_POLICY_CHANGED')
            # 独立inode，不让可写staged文件成为active policy的旁路别名。
            fd = os.open(base / 'adb-service.json', os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'wb') as out:
                out.write(policy_bytes)
                out.flush()
                os.fsync(out.fileno())
            active_dir = os.open(base, os.O_RDONLY)
            try:
                os.fsync(active_dir)
            finally:
                os.close(active_dir)
            journal.event('active_policy_created')
            install_root_plist(str(staged_plist), plan['snapshot']['service']['plist'], plan['snapshot']['service']['file'])
            authority()
            launchctl(['bootstrap', 'system', plan['snapshot']['service']['plist']], system=True)
            journal.event('service_bootstrapped')
            deadline = time.monotonic() + 10
            while True:
                try:
                    measured = service.status({**service.POLICY, 'port': 5037})
                    break
                except Exception:
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(.2)
            journal.event('raw_verified', measured=measured)
            authority()
            for consumer in plan['snapshot']['consumers']:
                if not consumer['loaded'] or consumer['target'].endswith('/com.zj.wall-push'):
                    continue
                need(file_state(consumer['plist']) == consumer['file'], 'CONSUMER_PLIST_CAS')
                domain = consumer['target'].rsplit('/', 1)[0]
                launchctl(['bootstrap', domain, consumer['plist']], system=domain == 'system')
                need(label_state(consumer['target'], consumer['plist'])['loaded'], 'CONSUMER_RESTORE_UNPROVEN')
            authority()
            service.status({**service.POLICY, 'port': 5037})
            journal.event('completed')
            return {'status': 'completed', 'task': task, 'source_commit': source, 'journal': str(journal.path),
                    'devices': measured['devices'], 'local_and_central_locks_released': False}
        except BaseException as error:
            journal.event('failed', error_type=type(error).__name__, error_code=str(error) if str(error).startswith('ADB_') else 'OPERATION_FAILED')
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    plan = sub.add_parser('plan')
    plan.add_argument('--manifest', required=True)
    plan.add_argument('--task', required=True)
    plan.add_argument('--actor', required=True)
    plan.add_argument('--local-owner', required=True)
    apply = sub.add_parser('apply')
    apply.add_argument('--plan', required=True)
    apply.add_argument('--plan-sha256', required=True)
    apply.add_argument('--task', required=True)
    apply.add_argument('--source', required=True)
    args = parser.parse_args()
    if args.command == 'plan':
        print(json.dumps(make_plan(args.manifest, args.task, args.actor, args.local_owner), sort_keys=True))
    else:
        print(json.dumps(apply_plan(read_private(args.plan), args.plan_sha256, args.task, args.source)))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error)
        print(message if message.startswith('ADB_') else 'ADB_MAINTENANCE_FAILED', file=sys.stderr)
        sys.exit(2)
