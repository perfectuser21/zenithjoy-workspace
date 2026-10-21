#!/usr/bin/env python3
"""定时异地备份的任务账包装：先领单，真实验证，持久回执，再回写。"""
import argparse
import fcntl
import json
import os
import runpy
import signal
import shlex
import socket
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

ACTOR = 'zenithjoy-backup-verifier'
PROJECT_ID = '67bd1fc3-3027-4f13-83c8-c656e3408bfc'
EXECUTION_HOST = 'us-mac-m4'


def api(base, method, path, body=None):
    request = urllib.request.Request(base.rstrip('/') + '/api/brain' + path,
        data=None if body is None else json.dumps(body).encode(), headers={'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def completion_matches(brain_url, task_id, body):
    actual = api(brain_url, 'GET', '/tasks/' + task_id)
    expected = body['result']
    result = actual.get('result') or {}
    return (actual.get('id') == task_id and actual.get('status') == 'completed'
            and all(result.get(key) == expected[key] for key in ('run_id', 'actor', 'facts', 'evidence')))


def complete_task(brain_url, task_id, body):
    try:
        api(brain_url, 'PATCH', '/tasks/' + task_id, body)
    except (TimeoutError, socket.timeout):
        # The server may have committed before its response timed out. Never repeat work or PATCH.
        if not completion_matches(brain_url, task_id, body):
            raise


def receipt(store, value):
    directory = store / 'runs'
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    target = directory / (value['run_id'] + '.json')
    fd, name = tempfile.mkstemp(prefix='.receipt-', dir=directory)
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(value, output, ensure_ascii=False, indent=2)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, target)
        fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    return str(target)


def run_recorded(store, brain_url, verify, run_id=None):
    run_id = run_id or uuid.uuid4().hex
    # Block before claim: this external scheduler owns execution; tick must not race it.
    helper = Path(__file__).resolve().with_name('verify-hk-backup.py')
    command = shlex.join([sys.executable, str(helper), '--store', str(store), '--run-id', run_id])
    created = api(brain_url, 'POST', '/tasks', {
        'title': '核验香港业务库异地备份及隔离恢复 ' + run_id,
        'task_type': 'script_run', 'priority': 'P2', 'status': 'blocked',
        'domain': 'operations', 'mutation_intent': 'none', 'project_id': PROJECT_ID,
        'source_id': run_id, 'trigger_source': 'external-scheduler',
        'blocked_reason': 'external_runner_claim_pending',
        'description': '外部备份调度器自行执行：先认领，再读取香港两库备份，在独立无网络容器恢复并读表与行数。Brain不派发外层包装。',
        'payload': {'host': EXECUTION_HOST, 'cmd': command, 'timeout_sec': 3600,
                    'backup_run_id': run_id, 'managed_by': ACTOR,
                    'artifact_paths': [str(store / 'runs' / (run_id + '.json'))]}})
    task_id = (created.get('task') or created)['id']
    owner = ACTOR + ':' + run_id
    value = {'run_id': run_id, 'task_id': task_id, 'actor': ACTOR, 'started_at': time.time()}
    # 认领失败不能把可能已被其他执行者持有的任务改为失败。
    try:
        api(brain_url, 'POST', '/tasks/' + task_id + '/claim',
            {'claimer': owner, 'executor_kind': 'script', 'lease_seconds': 5400, 'on_lease_expire': 'fail'})
    except Exception as error:
        receipt(store, {**value, 'status': 'claim_failed', 'error': str(error)})
        raise
    try:
        api(brain_url, 'PATCH', '/tasks/' + task_id, {'status': 'in_progress'})
        result = verify()
        if result.get('status') != 'verified' or len(result.get('backups', [])) != 2:
            raise ValueError('missing actual verified backup outputs')
        value.update(status='completed', facts=result, finished_at=time.time())
    except Exception as error:
        value.update(status='failed', error=str(error), finished_at=time.time())
        evidence = receipt(store, value)
        api(brain_url, 'PATCH', '/tasks/' + task_id,
            {'status': 'failed', 'result': {**value, 'evidence': evidence}})
        raise
    evidence = receipt(store, value)
    complete_task(brain_url, task_id, {'status': 'completed', 'result': {**value,
        'evidence': evidence, 'handoff': {'done': ['两库异地哈希和隔离恢复已真实核验'],
        'not_done': [], 'artifacts': [evidence], 'next_steps': []}}})
    return {**value, 'evidence': evidence}


def run_verifier(store, run_id, *, script=None, timeout=3600):
    helper = Path(__file__).with_name('verify-hk-backup.py')
    cleanup = runpy.run_path(str(helper))
    cleanup['validate_run_id'](run_id)
    directory = store / 'runs'
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    stdout_path = directory / (run_id + '.stdout.log')
    stderr_path = directory / (run_id + '.stderr.log')
    process = None
    # Files, not inherited pipes: descendants cannot hold communicate() open.
    with stdout_path.open('wb') as stdout, stderr_path.open('wb') as stderr:
        try:
            args = [sys.executable, str(script or helper), '--store', str(store), '--run-id', run_id]
            process = subprocess.Popen(args, stdout=stdout, stderr=stderr, start_new_session=True)
            code = process.wait(timeout=timeout)
            if code:
                raise RuntimeError('backup verifier failed; logs: ' + str(stderr_path))
            return json.loads(stdout_path.read_text())
        finally:
            if process is not None:
                # The session/process group was created solely for this invocation.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=10)
            cleanup['cleanup_run'](run_id)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--store', type=Path, required=True)
    parser.add_argument('--brain-url', default='http://localhost:5221')
    args = parser.parse_args()
    os.umask(0o077)
    store = args.store.expanduser().resolve()
    store.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (store / '.schedule.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'status': 'already_running'}))
            return
        run_id = uuid.uuid4().hex
        def verify():
            return run_verifier(store, run_id)
        print(json.dumps(run_recorded(store, args.brain_url, verify, run_id), ensure_ascii=False))


if __name__ == '__main__':
    main()
