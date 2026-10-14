#!/usr/bin/env python3
"""commander-v2 确定性文件、部署握手与有序反馈；不执行业务。"""
import contextlib
from datetime import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import urllib.request
import urllib.error

PROTOCOL = 'commander-v2'
HERE = Path(__file__).resolve().parent
FILES = ['wf-launch.sh', 'wf-status.sh', 'wf-agent-run.sh', 'wf-agent-lib.py',
         'wf-agent-handoff.py', 'wf-v2.py', 'wf-v2-io.py', 'wf-v2-phone.py', 'wf-v2-shell.py',
         'wf-report.py', 'wf-method.py', 'wf-v2-actions.py', 'wf-v2-gateway.py', 'wf-v2-processes.py', 'workflow-contracts.json', 'AGENTS.md']


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True, allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    path = Path(path)
    tmp = path.with_name(path.name + '.tmp')
    with open(tmp, 'w', encoding='utf-8') as out:
        os.chmod(tmp, 0o600)
        json.dump(value, out, ensure_ascii=False)
        out.flush()
        os.fsync(out.fileno())
    os.replace(tmp, path)
    fd = os.open(str(path.parent), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


@contextlib.contextmanager
def lock(path, blocking=True, shared=False):
    with open(path, 'a') as guard:
        fcntl.flock(guard, (fcntl.LOCK_SH if shared else fcntl.LOCK_EX) | (0 if blocking else fcntl.LOCK_NB))
        yield


def components(directory):
    names = FILES + sorted(str(p.relative_to(directory)) for p in (directory / 'skills').glob('*/SKILL.md'))
    names += sorted(str(p.relative_to(directory)) for p in (directory / 'contracts').glob('*.json'))
    if 'skills/workflow-commander/SKILL.md' not in names:
        raise ValueError('workflow commander skill missing')
    return {name: hashlib.sha256((directory / name).read_bytes()).hexdigest() for name in names}


def manifest(directory, releases):
    files = components(directory)
    result = dict(protocol=PROTOCOL, files=files, runtime_snapshot_sha256=digest(files), releases=releases)
    write(directory / 'runtime-manifest.json', result)
    return result


def brain_read(path):
    import shlex
    cache = Path(os.environ.get('WF_INTERNAL_TOKEN_FILE', Path.home() / '.credentials/cecelia-internal.env'))
    mode = cache.stat()
    if stat.S_IMODE(mode.st_mode) != 0o600 or mode.st_uid != os.getuid():
        raise ValueError('internal credential cache permissions invalid')
    raw = cache.read_text().strip()
    if 'WF_INTERNAL_TOKEN_FILE' in os.environ:
        token = raw
    else:
        values = [line.partition('=')[2] for line in raw.splitlines() if line.partition('=')[0].strip() == 'CECELIA_INTERNAL_TOKEN']
        token = shlex.split(values[-1])[0] if values else ''
    if not token or '\n' in token or '\r' in token or not (path.startswith('/api/brain/releases/') or re.fullmatch(r'/api/brain/tasks/[a-f0-9-]{36}', path)):
        raise ValueError('invalid internal release query')
    req = urllib.request.Request(os.environ.get('WF_BRAIN_URL', 'http://localhost:5221').rstrip('/') + path,
                                 headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)


def method_module():
    spec = importlib.util.spec_from_file_location('commander_method', HERE / 'wf-method.py')
    method = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(method)
    return method


def ready(query):
    if 'method_selection' in query:
        return method_module().verify(query, ready, brain_read, HERE)
    if (HERE / '.deploying').exists():
        raise ValueError('deployment in progress')
    deployed = read(HERE / 'runtime-manifest.json')
    files = components(HERE)
    runtime = digest(files)
    if deployed.get('protocol') != PROTOCOL or deployed.get('files') != files or deployed.get('runtime_snapshot_sha256') != runtime:
        raise ValueError('deployment bundle drift')
    if HERE == Path.home() / '.openclaw' / 'commander':
        workspace = Path.home() / 'openclaw-root/workspaces-root/clawd-work-commander'
        for name, expected in files.items():
            if name == 'AGENTS.md' or name.startswith('skills/'):
                if hashlib.sha256((workspace / name).read_bytes()).hexdigest() != expected:
                    raise ValueError('loaded Commander workspace drift')
    definition = query['definition']
    release = deployed.get('releases', {}).get(definition['release_id'])
    workflow = None
    if isinstance(release, dict):
        # 同一target的一个release可绑定多个冻结workflow；新shape存在时绝不回退旧字段。
        if 'workflows' in release:
            workflows = release['workflows']
            workflow = workflows.get(query['workflow_key']) if isinstance(workflows, dict) else None
        elif release.get('workflow_key') == query['workflow_key']:
            workflow = release  # 历史单workflow部署映射兼容。
    snapshot = workflow.get('snapshot_sha256') if isinstance(workflow, dict) else None
    if not isinstance(snapshot, str) or not re.fullmatch(r'[a-f0-9]{64}', snapshot) or snapshot != definition['snapshot_sha256']:
        raise ValueError('frozen release workflow not deployed or snapshot mismatch')
    if definition.get('runtime_snapshot_sha256') and definition['runtime_snapshot_sha256'] != runtime:
        raise ValueError('frozen runtime mismatch')
    return dict(protocol=PROTOCOL, ready=True, release_id=definition['release_id'],
                snapshot_sha256=definition['snapshot_sha256'], runtime_snapshot_sha256=runtime)


def validate_fact(envelope, kind, data):
    if not isinstance(data, dict):
        raise ValueError('feedback data must be an object')
    if kind not in ('activity_started', 'activity_completed'):
        return
    paths = [p for p in envelope['definition'].get('expected_path', [])
             if p.get('reference_id') == data.get('reference_id') and p.get('step_id') == data.get('step_id')]
    if len(paths) != 1 or not isinstance(data.get('reference_id'), str):
        raise ValueError('activity reference/step must match one frozen expected_path')
    if 'activity_id' in data and data['activity_id'] != paths[0].get('activity_id'):
        raise ValueError('activity_id does not match frozen expected_path')
    definition = envelope['definition']
    identities = {'run_id': envelope['run_id'], 'identity_protocol': 2,
                  'workflow_id': definition.get('workflow_id'), 'attempt_key': definition.get('attempt_key'),
                  'workflow_definition_version_id': definition.get('workflow_definition_version_id'),
                  'activity_definition_version_id': paths[0].get('activity_definition_version_id')}
    for field, expected in identities.items():
        if field in data and (expected is None or type(data[field]) is not type(expected) or data[field] != expected):
            raise ValueError('activity identity does not match frozen envelope: ' + field)
    if 'run_binding_id' in data:
        raise ValueError('run_binding_id is server-only; omit this declaration')
    if isinstance(data.get('evidence'), dict) and 'runtime_snapshot_sha256' in data['evidence']:
        expected = definition.get('runtime_snapshot_sha256')
        if not expected or data['evidence']['runtime_snapshot_sha256'] != expected:
            raise ValueError('evidence runtime_snapshot_sha256 does not match frozen envelope')
    if data.get('outcome') not in ('pass', 'fail', 'skipped', 'unknown'):
        raise ValueError('outcome must be pass|fail|skipped|unknown; activity_completed is event type; completed is delivery.status')
    def timestamp(field):
        value = data.get(field)
        if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)', value):
            raise ValueError(field + ' must be an ISO timestamp with timezone')
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.timestamp()
    started = timestamp('started_at')
    if kind == 'activity_completed':
        if timestamp('ended_at') < started:
            raise ValueError('ended_at precedes started_at')
    elif data.get('ended_at') is not None:
        raise ValueError('activity_started cannot claim ended_at')
    if not isinstance(data.get('evidence'), dict) or (kind == 'activity_completed' and not data['evidence']):
        raise ValueError('evidence must be an object; completed fact requires evidence')
    if data['outcome'] == 'skipped' and (not isinstance(data['evidence'].get('skip_reason'), str) or not data['evidence']['skip_reason'].strip()):
        raise ValueError('skipped requires non-empty evidence.skip_reason')
    if 'model' in data and (not isinstance(data['model'], str) or not data['model'].strip() or len(data['model']) > 200):
        raise ValueError('model must be a non-empty bounded string')


def emit(directory, kind, data):
    if len(canonical(data)) > 200000:
        raise ValueError('feedback data too large')
    envelope = read(directory / 'envelope.json')
    validate_fact(envelope, kind, data)  # 必须先拒绝，再分配持久seq；不能自动改写执行事实。
    with lock(directory / '.events.lock'):
        path = directory / 'events.json'
        events = read(path) if path.exists() else []
        if any(item['type'] == 'delivery' for item in events):
            raise ValueError('terminal feedback already persisted')
        event = {key: envelope[key] for key in ('protocol', 'run_id', 'attempt', 'owner_epoch')}
        event.update(seq=len(events) + 1, type=kind, data=data)
        events.append(event)
        write(path, events)
    return event


def feedback_status(directory):
    events = read(directory / 'events.json') if (directory / 'events.json').exists() else []
    checkpoint = read(directory / 'feedback-ack.json') if (directory / 'feedback-ack.json').exists() else {}
    ack = checkpoint.get('seq', 0)
    if type(ack) is not int or not 0 <= ack <= len(events):
        raise ValueError('invalid feedback ack checkpoint')
    result = read(directory / 'feedback-replay.json') if (directory / 'feedback-replay.json').exists() else {}
    result.update(ack_seq=ack, pending=len(events) - ack, replayed=ack == len(events), rejected=checkpoint.get('rejected', []))
    return result


def replay(directory):
    # 运输失败只返回持久pending，不抛入worker业务异常处理、不改delivery。
    result = {'replayed': False, 'ack_seq': 0, 'pending': None, 'failed_seq': None, 'error': None, 'rejected': []}
    try:
        with lock(directory / '.replay.lock'):
            result = _replay(directory)
            write(directory / 'feedback-replay.json', result)
    except Exception:
        # 此边界只包运输/回执；包括Node摘要子进程失效，均不得触发业务failed_delivery。
        try:
            result = feedback_status(directory)
        except Exception:
            pass
        result.update(replayed=False, error={'code': 'feedback_local_state_error'})
        try:
            write(directory / 'feedback-replay.json', result)
        except OSError:
            pass  # 介质不可写时CLI仍返回明确错误，不宣称已持久。
    return result


def _replay(directory):
    # 凭据仅引用0600缓存路径，永不写信封、请求日志或回执；网络错误不丢出站记录。
    path = directory / 'events.json'
    if not path.exists():
        return {'replayed': True, 'ack_seq': 0, 'pending': 0, 'failed_seq': None, 'error': None, 'rejected': []}
    events = read(path)
    ack_path = directory / 'feedback-ack.json'
    checkpoint = read(ack_path) if ack_path.exists() else {}
    ack, rejected = checkpoint.get('seq', 0), checkpoint.get('rejected', [])
    if type(ack) is not int or not 0 <= ack <= len(events) or [e['seq'] for e in events] != list(range(1, len(events) + 1)):
        raise ValueError('invalid feedback sequence checkpoint')
    def result(code=None, http_status=None):
        return {'replayed': ack == len(events), 'ack_seq': ack, 'pending': len(events) - ack, 'rejected': rejected,
                'failed_seq': ack + 1 if ack < len(events) else None,
                'error': dict(code=code, **({'http_status': http_status} if http_status else {})) if code else None}
    if ack == len(events):
        return result()
    envelope = read(directory / 'envelope.json')
    base = os.environ.get('WF_BRAIN_URL', 'http://localhost:5221').rstrip('/')
    url = base + '/api/brain/workflow-commander/tasks/' + envelope['task_id'] + '/events'
    headers = {'Content-Type': 'application/json'}
    token_path = os.environ.get('WF_INTERNAL_TOKEN_FILE')
    cache = Path(token_path) if token_path else Path.home() / '.credentials/cecelia-internal.env'
    try:
        mode = cache.stat()
        if stat.S_IMODE(mode.st_mode) != 0o600 or mode.st_uid != os.getuid():
            return result('credential_cache_invalid')
        content = cache.read_text().strip()
        if token_path:
            token = content
        else:
            import shlex
            values = [line.partition('=')[2] for line in content.splitlines()
                      if line.partition('=')[0].strip() == 'CECELIA_INTERNAL_TOKEN']
            token = shlex.split(values[-1])[0] if values else ''
        if not token or '\n' in token or '\r' in token:
            return result('credential_cache_invalid')
    except (OSError, ValueError, IndexError):
        return result('credential_cache_unavailable')
    headers['Authorization'] = 'Bearer ' + token
    for event in events:
        if event['seq'] <= ack:
            continue
        try:
            req = urllib.request.Request(url, data=canonical(event), headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=5) as response:
                if response.status < 200 or response.status >= 300:
                    return result('http_error', response.status)
                raw = response.read(65537)
                if len(raw) > 65536:
                    return result('ack_response_invalid')
                body = json.loads(raw)
                if not isinstance(body, dict) or type(body.get('seq')) is not int or body['seq'] != event['seq'] or not (body.get('accepted') is True or body.get('duplicate') is True):
                    return result('ack_response_invalid')
                if 'rejected' in body:
                    denial = body['rejected']
                    if (not isinstance(denial, dict) or set(denial) != {'code', 'seq', 'event_sha256', 'fields'}
                            or denial['code'] != 'invalid_activity_fact' or type(denial['seq']) is not int or denial['seq'] != event['seq']
                            or event['type'] not in ('activity_started', 'activity_completed')
                            or not isinstance(denial['fields'], list) or not denial['fields']
                            or any(field not in ('outcome', 'started_at', 'ended_at', 'evidence') for field in denial['fields'])
                            or denial['event_sha256'] != method_module().digest(event)):
                        return result('ack_response_invalid')
                    rejected = [*rejected, denial]
            # ACK与拒收结论同次原子持久；崩溃不能只留ACK而丢失拒收事实。
            write(ack_path, {'seq': event['seq'], 'rejected': rejected})
            ack = event['seq']
        except urllib.error.HTTPError as error:
            return result('http_error', error.code)
        except OSError:
            return result('network_error')
        except (ValueError, TypeError):
            return result('ack_response_invalid')
    return result()


def admitted(descriptor):
    try:
        fd = int(descriptor)
        actual, expected = os.fstat(fd), (HERE / '.admission.lock').stat()
        if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
            return False
        fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        return True
    except (ValueError, OSError):
        return False


def legacy(script, args):
    with open(HERE / '.admission.lock', 'a') as guard:
        fcntl.flock(guard, fcntl.LOCK_SH)
        if (HERE / '.deploying').exists():
            print('Commander deployment in progress; legacy admission denied', file=sys.stderr)
            return 4
        env = dict(os.environ, WF_LEGACY_ADMISSION_FD=str(guard.fileno()))
        # 同一fd传给launch的直接runner；不会发生父等待起跑而子等待同一把锁。
        os.set_inheritable(guard.fileno(), True)
        os.execvpe('bash', ['bash', script, *args], env)


if __name__ == '__main__':
    if sys.argv[1] == 'admitted':
        sys.exit(0 if admitted(sys.argv[2]) else 1)
    elif sys.argv[1] == 'legacy':
        sys.exit(legacy(sys.argv[2], sys.argv[3:]))
    elif sys.argv[1] == 'verify':
        deployed = read(HERE / 'runtime-manifest.json')
        files = components(HERE)
        if deployed['files'] != files or deployed['runtime_snapshot_sha256'] != digest(files):
            sys.exit('deployment bundle drift')
        print(json.dumps({'protocol': PROTOCOL, 'runtime_snapshot_sha256': digest(files)}))
    elif sys.argv[1] == 'manifest':
        print(json.dumps(manifest(Path(sys.argv[2]), json.loads(sys.argv[3]))))
