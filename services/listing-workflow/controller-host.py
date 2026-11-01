import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shlex
import subprocess
import sys
import time
from uuid import uuid4

COMMANDS = {'lock-acquire-new', 'lock-status', 'lock-refresh', 'lock-release-exact', 'preflight', 'foreground', 'snapshot-evidence', 'ui-evidence', 'text-input', 'media-push'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def store(path, value):
    temporary = path.with_name(path.name + '.pending')
    with temporary.open('w') as stream:
        json.dump(value, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def read_profile(home, profile):
    source = home / '.config/openclaw/douyin-phone-profiles.tsv'
    rows = source.read_text().splitlines()
    header = next(row.lstrip('#').split('\t') for row in rows if row.lstrip('#').startswith('profile\t'))
    matches = [dict(zip(header, row.split('\t'))) for row in rows if not row.startswith('#') and row.split('\t')[0] == profile]
    if len(matches) != 1:
        raise ValueError('PROFILE_NOT_UNIQUE')
    row = matches[0]
    return {'serial': row['serial'], 'model': row['model'], 'width': int(row['width']), 'height': int(row['height']), 'enabled': row.get('enabled', 'true') == 'true'}


def private_profile(root, alias, row):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', alias):
        raise ValueError('INVALID_PROFILE_ALIAS')
    path = root / 'profiles.tsv'
    data = '#profile\tserial\tmodel\twidth\theight\tenabled\n' + '\t'.join([alias, row['serial'], row['model'], str(row['width']), str(row['height']), 'true']) + '\n'
    with path.open('x') as stream:
        stream.write(data)
    path.chmod(0o600)
    return path


def stage_media(config, request):
    if config.get('albumMoveAttempted'): raise ValueError('ALBUM_PLAN_ALREADY_FIXED')
    name = request.get('name', '')
    if not re.fullmatch(r'IMG_\d{8}_\d{6}_\d{1,3}\.(?:jpg|png)', name):
        raise ValueError('INVALID_MEDIA_NAME')
    raw = base64.b64decode(request['bytesBase64'], validate=True)
    if sha(raw) != request['sha256']:
        raise ValueError('MEDIA_HASH_MISMATCH')
    if not 0 < len(raw) <= 20 * 1024 * 1024 or not (raw.startswith(b'\xff\xd8\xff') or raw.startswith(b'\x89PNG\r\n\x1a\n')):
        raise ValueError('INVALID_MEDIA_BYTES')
    policy = config.get('materialPolicy') or {}
    if sha(raw) not in policy.get('allowedDigests', []): raise ValueError('MATERIAL_NOT_AUTHORIZED')
    path = Path(config['remoteRoot']) / name
    if path.exists():
        raise ValueError('STAGED_MEDIA_ALREADY_EXISTS')
    with path.open('xb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    path.chmod(0o400)
    entry = {'path': str(path), 'name': name, 'sha256': sha(raw), 'size': len(raw), 'phonePath': '/sdcard/DCIM/Camera/' + name, 'phonePlanned': False}
    config['ownedMedia'].append(entry)
    return entry


def roots(request):
    root = Path(request.get('remoteRoot', ''))
    if not re.fullmatch(r'/private/tmp/pdd-native-[0-9a-f-]{36}', str(root)) or root.is_symlink():
        raise ValueError('INVALID_OWNED_ROOT')
    return root


def inspect(request):
    binding = request['binding']
    controller = Path(binding['controllerPath'])
    focus = controller.parent / 'text-input-focus.py'
    return {'controllerSha256': sha(controller.read_bytes()), 'focusSha256': sha(focus.read_bytes()), 'profile': read_profile(Path.home(), binding['baseProfile'])}


def verify_files(config):
    binding = config['binding']
    if sha(Path(binding['controllerPath']).read_bytes()) != binding['controllerSha256'] or sha((Path(binding['controllerPath']).parent / 'text-input-focus.py').read_bytes()) != binding['focusSha256']:
        raise ValueError('CONTROLLER_HASH_CHANGED')


def held(config):
    path = Path('/private/tmp/openclaw-phone/locks') / (config['binding']['serial'] + '.lock')
    if (path / 'owner').read_text().strip() != config['owner']:
        raise ValueError('CONTROLLER_OWNER_CHANGED')
    age = time.time() - int((path / 'acquired_at').read_text().strip())
    if age < 0 or age + 1000 >= 1800:
        raise ValueError('CONTROLLER_LEASE_UNSAFE')


def adb(config, args, check=True):
    deadline = config.get('deadline', 0)
    if deadline - time.monotonic() < 65: raise ValueError('REMOTE_ACTION_BUDGET_EXHAUSTED')
    directory = Path(config['binding']['controllerPath']).parent
    binary = str(directory / 'adb-managed-client.py') if (Path.home() / '.config/zenithjoy/adb-service.json').exists() else '/opt/homebrew/bin/adb'
    route = subprocess.run(['/opt/homebrew/bin/python3', str(directory / 'adb-existing-route.py'), config['binding']['serial'], binary], capture_output=True, text=True, timeout=20, check=True).stdout.strip()
    if not route.isdigit(): raise ValueError('ADB_ROUTE_UNVERIFIED')
    if deadline - time.monotonic() < 45: raise ValueError('REMOTE_ACTION_BUDGET_EXHAUSTED')
    env = dict(os.environ, ADB_SERVER_SOCKET='tcp:127.0.0.1:' + route)
    nonce = uuid4().hex
    marker = '__PDD_EXIT_' + nonce + '__:'
    safe_args = args
    if args and args[0] == 'shell':
        script = '(' + shlex.join(args[1:]) + '); _pdd_status=$?; printf "\\n' + marker + '%s\\n" "$_pdd_status"; exit 0'
        safe_args = ['shell', 'sh -c ' + shlex.quote(script)]
    trace = {'args': args, 'nonce': nonce, 'startedAt': time.time(), 'remoteExitConfirmed': False}
    config.setdefault('adbTrace', []).append(trace)
    def persist_trace():
        if config.get('remoteRoot') and Path(config['remoteRoot']).is_dir(): store(Path(config['remoteRoot']) / 'config.json', config)
    persist_trace()
    try:
        try:
            result = subprocess.run([binary, '-s', config['binding']['serial']] + safe_args, capture_output=True, timeout=40, env=env)
        except subprocess.TimeoutExpired as cause:
            trace['error'] = 'ADB_TIMEOUT'; persist_trace()
            error = ValueError('ADB_REMOTE_TERMINATION_UNCONFIRMED'); error.remoteUnknown = True
            raise error from cause
        trace['localReturncode'] = result.returncode
        proof = re.search(rb'\n' + marker.encode() + rb'([0-9]+)\n$', result.stdout) if args and args[0] == 'shell' else None
        if result.returncode != 0 or (args and args[0] == 'shell' and not proof):
            trace['error'] = 'ADB_TRANSPORT_OR_RECEIPT_UNKNOWN'; persist_trace()
            error = ValueError('ADB_REMOTE_TERMINATION_UNCONFIRMED'); error.remoteUnknown = True
            raise error
        if proof:
            result.returncode = int(proof.group(1))
            result.stdout = result.stdout[:proof.start()]
            trace['remoteExitConfirmed'] = True
        result.remoteExitConfirmed = trace['remoteExitConfirmed']
        trace.update(remoteReturncode=result.returncode, finishedAt=time.time(), stdoutSha256=sha(result.stdout))
        persist_trace()
        if check and result.returncode:
            raise ValueError('ADB_READ_OR_CLEANUP_FAILED:' + result.stderr.decode(errors='replace')[:300])
        return result
    except Exception as cause:
        if not trace['remoteExitConfirmed']: cause.remoteUnknown = True
        raise



def execute_controller(config, command, args, job_id, native_tap=False):
    verify_files(config)
    if (command in {'text-input','media-push'} and not native_tap) or (command not in COMMANDS and not (native_tap and command in {'tap', 'back'})):
        raise ValueError('FORBIDDEN_CONTROLLER_COMMAND')
    lock_command = command.startswith('lock-')
    if not lock_command:
        held(config)
    if command in {'lock-acquire-new', 'lock-refresh', 'lock-release-exact'} and args != [config['owner']]:
        raise ValueError('EXACT_OWNER_REQUIRED')
    if command == 'media-push':
        matches = [x for x in config['ownedMedia'] if args == [x['path'], '--name', x['name']]]
        if len(matches) != 1 or sha(Path(matches[0]['path']).read_bytes()) != matches[0]['sha256']:
            raise ValueError('UNOWNED_MEDIA_PUSH')
        item = matches[0]
        exists = adb(config, ['shell', 'test', '-e', item['phonePath']], check=False)
        raw = adb(config, ['shell', 'content', 'query', '--uri', 'content://media/external/images/media', '--projection', '_id:_data', '--where', "_display_name='" + item['name'] + "'"]).stdout.decode()
        if exists.returncode != 1 or raw.strip() != 'No result found.': raise ValueError('PHONE_MEDIA_ALREADY_EXISTS_OR_UNKNOWN')
        item['absenceProvedAt'] = time.time()
        item['phonePlanned'] = True
        store(Path(config['remoteRoot']) / 'config.json', config)
    prefix = [config['binding']['controllerPath'], '--profile', config['profile']]
    if command in {'text-input', 'media-push', 'snapshot-evidence', 'ui-evidence', 'tap'}:

        prefix += ['--lock-owner', config['owner']]
    if command in {'snapshot-evidence', 'ui-evidence'} and (len(args) != 1 or not re.fullmatch(r'native-[a-zA-Z0-9_-]+', args[0])):
        raise ValueError('INVALID_EVIDENCE_ID')
    job = Path(config['remoteRoot']) / ('job-' + job_id + '.json')
    env = dict(os.environ, DOUYIN_PHONE_REGISTRY=str(Path(config['remoteRoot']) / 'profiles.tsv'))
    remaining = min(240, config.get('deadline', time.monotonic() + 240) - time.monotonic())
    if remaining < 1: raise ValueError('REMOTE_ACTION_BUDGET_EXHAUSTED')
    process = subprocess.Popen(prefix + [command] + args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, start_new_session=True)
    store(job, {'status': 'running', 'pid': process.pid, 'owner': config['owner'], 'command': command, 'startedAt': time.time()})
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=remaining)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(process.pid, signal.SIGTERM)
        try:
            stdout, stderr = process.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate()
    result = {'status': 'finished', 'pid': process.pid, 'owner': config['owner'], 'command': command, 'exitCode': process.returncode, 'stdout': stdout.decode(errors='replace'), 'stderr': stderr.decode(errors='replace'), 'remoteUnknown': timed_out or (process.returncode != 0 and not lock_command)}
    store(job, result)
    if timed_out:
        result['error'] = 'REMOTE_COMMAND_TIMED_OUT'
    elif process.returncode:
        result['error'] = 'CONTROLLER_COMMAND_FAILED:' + result['stderr'][-1500:] + result['stdout'][-500:]
    return result


def read_evidence(config, path):
    path = Path(path)
    root = Path('/private/tmp/openclaw-phone/evidence') / config['profile']
    if path.parent != root or path.is_symlink() or not path.is_file() or path.suffix not in {'.png', '.jpg', '.xml', '.json', '.txt'} or path.stat().st_size > 24 * 1024 * 1024:
        raise ValueError('UNOWNED_EVIDENCE_PATH')
    raw = path.read_bytes()
    return {'path': str(path), 'bytesBase64': base64.b64encode(raw).decode(), 'sha256': sha(raw)}


def media_identity(config, item):
    where = "_display_name='" + item['name'] + "'"
    raw = adb(config, ['shell', 'content', 'query', '--uri', 'content://media/external/images/media', '--projection', '_id:_data', '--where', where]).stdout.decode()
    matches = re.findall(r'_id=(\d+), _data=(/[^\r\n]+)', raw)
    expected = item['phonePath'].replace('/sdcard/', '/storage/emulated/0/', 1)
    allowed = ['/sdcard/DCIM/Camera/' + item['name'], '/sdcard/DCIM/PDD_' + config.get('profile', '') + '/' + item['name']]
    if item['phonePath'] not in allowed: raise ValueError('UNOWNED_PHONE_PATH')
    if len(matches) != 1 or matches[0][1].strip() != expected:
        raise ValueError('PHONE_MEDIASTORE_IDENTITY_UNCONFIRMED')
    return matches[0][0]


def phone_readback(config):
    held(config)
    result = []
    for item in config['ownedMedia']:
        if not item['phonePlanned']:
            continue
        digest = adb(config, ['shell', 'sha256sum', item['phonePath']]).stdout.decode().split()[0]
        if digest != item['sha256']:
            raise ValueError('PHONE_MEDIA_HASH_MISMATCH')
        item['mediaId'] = media_identity(config, item)
        item['phoneVerified'] = True
        result.append(dict(item, phoneSha256=digest))
    store(Path(config['remoteRoot']) / 'config.json', config)
    return {'media': result}


def phone_cleanup(config):
    held(config)
    if config.get('expectNewForm') and not config.get('draft') and not config.get('emptyFormExitedVerified'): raise ValueError('EMPTY_FORM_CLEANUP_REQUIRED')
    if config.get('draft', {}).get('owned') and not config['draft'].get('exitedVerified'):
        raise ValueError('DRAFT_CLEANUP_REQUIRED')
    if any(x.get('phonePlanned') for x in config['ownedMedia']): cleanup_owned_media(config)
    for item in config['ownedMedia']:
        path = Path(item['path'])
        if path.exists():
            if sha(path.read_bytes()) != item['sha256']:
                raise ValueError('REFUSE_DELETE_CHANGED_HOST_MEDIA')
            path.unlink()
    for name in ['douyin-leadgen-shot-', 'douyin-leadgen-ui-']:
        path = '/sdcard/' + name + config['profile'] + ('.png' if 'shot' in name else '.xml')
        adb(config, ['shell', 'rm', '-f', '--', path])
        adb(config, ['shell', 'test', '!', '-e', path])
    return {'ok': True, 'phoneArtifactsRemaining': [], 'retainedHostAuditRoot': config['remoteRoot']}


def dispatch(request):
    action = request.get('action')
    if action == 'controller' and (request.get('command') not in COMMANDS or request.get('command') in {'text-input','media-push'}):
        raise ValueError('FORBIDDEN_CONTROLLER_COMMAND')
    if action == 'inspect':
        return inspect(request)
    root = roots(request)
    if action == 'initialize':
        actual = inspect(request)
        if actual['controllerSha256'] != request['binding']['controllerSha256'] or actual['focusSha256'] != request['binding']['focusSha256']:
            raise ValueError('CONTROLLER_BINDING_MISMATCH')
        expected = {k: request['binding'][k] for k in ['serial', 'model', 'width', 'height']}
        expected['enabled'] = True
        if actual['profile'] != expected: raise ValueError('PROFILE_CHANGED_BEFORE_INITIALIZE')
        root.mkdir(mode=0o700)
        private_profile(root, request['profile'], actual['profile'])
        config = {**request, 'ownedMedia': []}
        store(root / 'config.json', config)
        return {'ok': True}
    config = json.loads((root / 'config.json').read_text())
    config['deadline'] = time.monotonic() + min(285, max(1, request.get('operationBudgetMs', 285000) / 1000))
    if config['owner'] != request['owner'] or config['profile'] != request['profile'] or config['binding'] != request['binding'] or config.get('materialPolicy') != request.get('materialPolicy'):
        raise ValueError('SESSION_IDENTITY_CONFLICT')
    with (root / 'operation.guard').open('a') as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if action == 'controller':
            return execute_controller(config, request['command'], request.get('args', []), request['jobId'])
        verify_files(config)
        held(config)
        if action == 'stage-media':
            result = stage_media(config, request)
            store(root / 'config.json', config)
            return result
        if action == 'read-evidence':
            return read_evidence(config, request['path'])
        if action == 'phone-readback':
            return phone_readback(config)
        if action == 'phone-cleanup':
            return phone_cleanup(config)
        if action in {'gallery-state', 'gallery-menu', 'gallery-album', 'gallery-select', 'gallery-upload', 'gallery-back'}:
            return gallery_action(config, request)
        if action in {'picker-more', 'picker-permission', 'picker-select', 'picker-confirm'}:
            return picker_action(config, request)
        if action in {'observe', 'navigate', 'approve-draft', 'set-field', 'push-owned-media', 'organize-media', 'discard-draft', 'back', 'launch'}:
            return native_action(config, request)
        raise ValueError('FORBIDDEN_HOST_OPERATION')


if __name__ == '__main__':
    try:
        print(json.dumps(dispatch(json.load(sys.stdin)), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': str(error)}))
