#!/usr/bin/env python3
"""仅252原101的历史phone请求域归还证明；不证明OS任意后代停止。

原cleanup-attempt证明越过handler前置UNKNOWN检查；唯一原execution的
OLD_EXECUTION_TERMINATION_UNKNOWN位于await invokeNativeActivity之后。
原cleanup的finally先await close；原producer.close先sealed并await server.close，
最后确认active=0。固定原件及全部leaf账共同证明该历史域已关闭。
此结果不注册WeakMap能力、不解除通用native UNKNOWN、不授予采集恢复。
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
from datetime import datetime

HERE = Path(__file__).resolve().parent
SCOPE = {'source_commit': '252225f13a47ed36e95c248e916373c4c462fffd',
         'run_id': 'douyin_video_discovery-ys261104032759_101__a1',
         'owner': 'ys261104032759_101', 'profile': 'xiaolongxia',
         'serial': 'ANGYVB4311010223', 'task_id': '76b2c9aa-ee00-49b7-8fb5-5dad0ae110eb',
         'binding_id': '20176663-7260-473e-842f-bceb9ea0ccc4'}
TASK = {'id': '6a18b697-c009-4a5c-8133-ecb77f346a71', 'status': 'in_progress',
        'claimed_by': 'headed-resume-recovery', 'claimed_at': '2026-11-03T23:49:27.534Z',
        'project_id': '68ca6b4f-5e53-4ccf-a2aa-874e5c32bbe6'}
CONTRACT = json.loads((HERE / 'discovery-review-maintenance-contract.json').read_bytes())


def need(ok, reason):
    if not ok:
        raise ValueError('DISCOVERY_REVIEW_' + reason)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path, limit=32 * 1024 * 1024):
    path = Path(path)
    # Every ancestor must be a real directory. Frozen executable links are not
    # admitted here; the original runtime closure consists of regular files.
    for parent in path.parents:
        need(parent.is_dir() and not parent.is_symlink(), 'PARENT')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid()
             and not before.st_mode & 0o022 and before.st_size <= limit, 'FILE')
        raw = os.read(fd, limit + 1)
        after = os.fstat(fd)
        need(len(raw) == before.st_size and
             (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'FILE_DRIFT')
        return raw
    finally:
        os.close(fd)


def verify_task(task):
    need(isinstance(task, dict) and all(task.get(k) == v for k, v in TASK.items())
         and task.get('payload', {}).get('headed_manual') == 'true', 'TASK_CLAIM')
    return {k: task[k] for k in TASK}


def timestamp(value):
    return int(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)


def verify_leaf_log(raw):
    need(isinstance(raw, str) and raw.endswith('\n') and raw.strip(), 'LEAF_TRUNCATED')
    rows = [json.loads(line) for line in raw.splitlines()]
    need(len(rows) % 3 == 0, 'LEAF_PHASES')
    last = 0
    first = None
    for i in range(0, len(rows), 3):
        intent, started, exited = rows[i:i + 3]
        need([r.get('phase') for r in (intent, started, exited)] == ['intent', 'started', 'exit'], 'LEAF_PHASES')
        for key in ('sequence', 'argv_sha256', 'intent_at', 'boundary'):
            need(key in intent and all(r.get(key) == intent[key] for r in (started, exited)), 'LEAF_IDENTITY')
        need(type(intent['sequence']) is int and intent['sequence'] == i // 3 + 1
             and re.fullmatch(r'[a-f0-9]{64}', intent['argv_sha256'])
             and intent['boundary'] == 'darwin-sandbox-deny-process-fork-v1', 'LEAF_SEQUENCE')
        need(type(started.get('pid')) is int and started['pid'] > 1
             and exited.get('pid') == started['pid']
             and type(started.get('started_at')) is int
             and exited.get('started_at') == started['started_at']
             and type(exited.get('ended_at')) is int
             and type(intent['intent_at']) is int
             and last <= intent['intent_at'] <= started['started_at'] <= exited['ended_at'], 'LEAF_TIME')
        need(exited.get('request_returned') is True and exited.get('signal') is None
             and exited.get('tainted') is False and type(exited.get('code')) is int
             and (exited['code'] in (0, 1) or exited['code'] == 137 and exited.get('dump_crash_returned') is True), 'LEAF_UNRETURNED')
        last = exited['ended_at']
        first = intent['intent_at'] if first is None else first
    return {'leaves': len(rows) // 3, 'first_intent': first, 'last_exit': last}


def verify_original(run_root, *, runtime_root=None, scope_root=None):
    root = Path(run_root)
    raw = {}
    for name, expected in CONTRACT['original_files'].items():
        data = read(root / name)
        need(sha(data) == expected, 'ORIGINAL_HASH_' + name)
        raw[name] = data
    document = lambda name: json.loads(raw[name])
    frozen = document('run-definition.json')
    need(frozen['deployment']['source_commit'] == SCOPE['source_commit'], 'SOURCE')
    runtime = Path(runtime_root) if runtime_root else root / 'runtime'
    count = 0
    for name, expected in frozen['files'].items():
        if name.startswith('runtime/'):
            need(all(p not in ('', '.', '..') for p in name.split('/')), 'RUNTIME_PATH')
            need(sha(read(runtime / name[8:])) == expected, 'RUNTIME_HASH')
            count += 1
    need(count > 20, 'RUNTIME_CLOSURE')
    ack = document('run-bindings/a1.ack.json')['binding']
    need(ack['id'] == SCOPE['binding_id'] and ack['run_id'] == SCOPE['run_id'], 'BINDING')
    association = document('central-task-association.json')
    need(all(association[k] == SCOPE[k] for k in ('task_id', 'run_id', 'binding_id', 'source_commit'))
         and association['device_name'] == SCOPE['serial']
         and association['central_owner'] == SCOPE['task_id']
         and association['runtime_snapshot_sha256'] == frozen['snapshot_sha256'], 'CENTRAL_ASSOCIATION')
    acquired = [json.loads(x) for x in raw['central-lock-events.jsonl'].splitlines()]
    need(len(acquired) == 1 and acquired[0]['event'] == 'acquired'
         and acquired[0]['task_id'] == SCOPE['task_id'] and acquired[0]['device_name'] == SCOPE['serial'], 'CENTRAL_LEASE')
    attempt = document('cleanup-attempt.json')
    need(all(attempt[k] == SCOPE[k] for k in ('run_id', 'source_commit', 'profile', 'serial'))
         and attempt['run'] == SCOPE['owner'], 'CLEANUP_IDENTITY')
    events = [json.loads(x) for x in raw['activity-events.jsonl'].splitlines()]
    relevant = [e for e in events if e.get('activity') == 'cleanup']
    starts = [e for e in relevant if e.get('phase') == 'start']
    exits = [e for e in relevant if e.get('phase') == 'execution']
    need(len(starts) == len(exits) == 1 and starts[0]['attempt'] == 1
         and starts[0]['recovery'] is False and exits[0]['evidence'] ==
         {'status': 'failed', 'attempt': 1, 'error': 'OLD_EXECUTION_TERMINATION_UNKNOWN', 'execution_stopped': False}, 'POST_CLEANUP')
    need(timestamp(starts[0]['observed_at']) < timestamp(attempt['observed_at']) < timestamp(exits[0]['observed_at']), 'POST_CLEANUP_TIME')
    collect = document('activity-collect_videos.json')
    need(collect['status'] == 'completed' and collect['result']['cleanup_phone_scope']['protocol'] == 'discovery-cleanup-only-v1', 'COLLECT_SEALED')
    scope = Path(scope_root) if scope_root else root / 'discovery-phone-scopes'
    need(scope.is_dir() and not scope.is_symlink(), 'SCOPE_ROOT')
    expected = CONTRACT['leaf_files']
    need({p.name for p in scope.iterdir()} == {n.split('/')[0] for n in expected}, 'SCOPE_SET')
    found = set()
    for directory in scope.iterdir():
        need(directory.is_dir() and not directory.is_symlink(), 'SCOPE_DIR')
        for path in directory.iterdir():
            if path.name == 'bin':
                need(path.is_dir() and not path.is_symlink(), 'SCOPE_BIN')
            elif path.name == 'policy.json':
                read(path)  # Shape/ownership only; no policy content exported.
            else:
                found.add(str(path.relative_to(scope)))
    need(found == set(expected), 'LEAF_SET')
    summaries = {}
    for name, expected_sha in expected.items():
        data = read(scope / name)
        need(sha(data) == expected_sha, 'LEAF_HASH')
        summaries[name] = verify_leaf_log(data.decode())
    cleanup = next(v for k, v in summaries.items() if not k.startswith('collect/'))
    collection = next(v for k, v in summaries.items() if k.startswith('collect/'))
    need(collection['last_exit'] < timestamp(starts[0]['observed_at']) <= cleanup['first_intent']
         <= cleanup['last_exit'] <= timestamp(attempt['observed_at']) < timestamp(exits[0]['observed_at']), 'SCOPE_TIME')
    return {'protocol': 'discovery-review-maintenance-v1', 'scope': dict(SCOPE),
            'old_phone_domain_returned': True, 'execution_stopped': False,
            'original_files': CONTRACT['original_files'], 'leaf_files': expected,
            'runtime_files': count, 'leaves': sum(v['leaves'] for v in summaries.values()),
            'cleanup_post_finally_at': exits[0]['observed_at']}
