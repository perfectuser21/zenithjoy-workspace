#!/usr/bin/env python3
"""commander-v2 确定性文件、部署握手与有序反馈；不执行业务。"""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import urllib.request

PROTOCOL = 'commander-v2'
HERE = Path(__file__).resolve().parent
FILES = ['wf-launch.sh', 'wf-status.sh', 'wf-agent-run.sh', 'wf-agent-lib.py',
         'wf-agent-handoff.py', 'wf-v2.py', 'wf-v2-io.py', 'wf-v2-phone.py',
         'wf-report.py', 'workflow-contracts.json', 'AGENTS.md']


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()


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


def ready(query):
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
    if not release or release.get('workflow_key') != query['workflow_key'] or release.get('snapshot_sha256') != definition['snapshot_sha256']:
        raise ValueError('frozen release not deployed')
    if definition.get('runtime_snapshot_sha256') and definition['runtime_snapshot_sha256'] != runtime:
        raise ValueError('frozen runtime mismatch')
    return dict(protocol=PROTOCOL, ready=True, release_id=definition['release_id'],
                snapshot_sha256=definition['snapshot_sha256'], runtime_snapshot_sha256=runtime)


def emit(directory, kind, data):
    if len(canonical(data)) > 200000:
        raise ValueError('feedback data too large')
    envelope = read(directory / 'envelope.json')
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


def replay(directory):
    # 凭据仅引用0600缓存路径，永不写信封、请求日志或回执；网络错误不丢出站记录。
    with lock(directory / '.replay.lock'):
        path = directory / 'events.json'
        if not path.exists():
            return
        events = read(path)
        ack_path = directory / 'feedback-ack.json'
        ack = read(ack_path).get('seq', 0) if ack_path.exists() else 0
        envelope = read(directory / 'envelope.json')
        base = os.environ.get('WF_BRAIN_URL', 'http://localhost:5221').rstrip('/')
        url = base + '/api/brain/workflow-commander/tasks/' + envelope['task_id'] + '/events'
        headers = {'Content-Type': 'application/json'}
        token_path = os.environ.get('WF_INTERNAL_TOKEN_FILE')
        cache = Path(token_path) if token_path else Path.home() / '.credentials/cecelia-internal.env'
        try:
            mode = cache.stat()
            if stat.S_IMODE(mode.st_mode) != 0o600 or mode.st_uid != os.getuid():
                return
            content = cache.read_text().strip()
            if token_path:
                token = content
            else:
                import shlex
                values = [line.partition('=')[2] for line in content.splitlines()
                          if line.partition('=')[0].strip() == 'CECELIA_INTERNAL_TOKEN']
                token = shlex.split(values[-1])[0] if values else ''
            if not token or '\n' in token or '\r' in token:
                return
        except (OSError, ValueError, IndexError):
            return
        headers['Authorization'] = 'Bearer ' + token
        for event in events:
            if event['seq'] <= ack:
                continue
            try:
                req = urllib.request.Request(url, data=canonical(event), headers=headers, method='POST')
                with urllib.request.urlopen(req, timeout=5) as response:
                    if response.status < 200 or response.status >= 300:
                        return
                write(ack_path, {'seq': event['seq']})
            except (OSError, ValueError):
                return


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
