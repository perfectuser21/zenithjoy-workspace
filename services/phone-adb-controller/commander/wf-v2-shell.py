#!/usr/bin/env python3
"""外壳活动事实：固定UUID映射，保留每次原件，重入不重复终态事件。"""
from datetime import datetime, timezone
import hashlib
import importlib.util
from pathlib import Path
import shutil
import time

spec = importlib.util.spec_from_file_location('commander_io', Path(__file__).with_name('wf-v2-io.py'))
io = importlib.util.module_from_spec(spec)
spec.loader.exec_module(io)


def now():
    return datetime.now(timezone.utc).isoformat()


def bound_paths(envelope, key):
    expected = envelope['definition'].get('expected_path', [])
    if not expected:  # 旧测试/兼容辅助调用未绑定运行账；正式v2由Brain要求完整expected_path。
        return []
    bindings = [item for item in envelope.get('activity_bindings', []) if item.get('key') == key]
    if len(bindings) != 1:
        raise ValueError('missing or ambiguous frozen shell activity binding: ' + key)
    binding = bindings[0]
    paths = [item for item in expected if all(item.get(k) == binding.get(k) for k in
             ('reference_id', 'activity_id', 'activity_definition_version_id'))]
    step_ids = {step['step_id'] for step in binding['steps']}
    if not any(not item.get('step_id') for item in paths) or {item['step_id'] for item in paths if item.get('step_id')} != step_ids:
        raise ValueError('frozen shell steps do not cover expected path: ' + key)
    return paths


def replay(directory, key):
    path = directory / ('shell-' + key + '.json')
    if not path.exists():
        return
    state = io.read(path)
    if not state.get('terminal'):
        return
    for data in state['facts']:
        events = io.read(directory / 'events.json')
        if any(item['type'] == 'activity_completed' and item['data'].get('shell_fact_id') == data['shell_fact_id'] for item in events):
            continue
        io.emit(directory, 'activity_completed', data)


def execute(phone, key, callback):
    directory, envelope = phone.directory, phone.envelope
    paths = bound_paths(envelope, key)  # 先验证显式映射，再触发设备动作。
    state_path = directory / ('shell-' + key + '.json')
    state = io.read(state_path) if state_path.exists() else {'started_at': now(), 'terminal': False}
    if state.get('terminal'):
        replay(directory, key)
        if state.get('error'):
            raise ValueError(state['error'])
        return state.get('result')
    io.write(state_path, state)
    archive_root = directory / 'shell-evidence' / key
    archive_root.mkdir(parents=True, exist_ok=True)
    sequence = len(list(archive_root.iterdir())) + 1
    archive = archive_root / str(sequence)
    archive.mkdir()
    phone.control_receipts = []
    error, result = None, None
    try:
        result = callback()
        succeeded = key == 'preflight' or result.get('completed') is True
    except Exception as caught:
        error, succeeded = caught, False
    receipt = {'activity_key': key, 'run_id': envelope['run_id'], 'started_at': state['started_at'],
               'ended_at': now(), 'result': result, 'error': str(error) if error else None}
    io.write(archive / 'attempt.json', receipt)
    sources = list(phone.control_receipts) + list(directory.glob(key + '*.log'))
    sources += list(directory.glob(key + '*.json'))
    if (directory / 'root-identity.json').exists():
        sources.append(directory / 'root-identity.json')
    sources += list((directory / 'evidence').glob(envelope['run_id'] + '-' + key + '*'))
    files = [{'path': str(archive / 'attempt.json'), 'sha256': hashlib.sha256((archive / 'attempt.json').read_bytes()).hexdigest()}]
    for index, source in enumerate(sorted(set(sources))):
        target = archive / (str(index) + '-' + source.name)
        shutil.copyfile(source, target)
        files.append({'path': str(target), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
    # 同一cleanup活动含有界的清理重试；中间失败记事件，不能提前固化终态span。
    terminal = key == 'preflight' or succeeded or time.time() >= phone.cleanup_deadline
    evidence = {'source': 'commander-shell', 'activity_key': key, 'files': files, 'attempt': sequence}
    if terminal:
        facts = []
        for item in paths:
            data = {k: item[k] for k in ('reference_id', 'activity_id', 'step_id') if k in item}
            data.update(started_at=state['started_at'], ended_at=receipt['ended_at'], outcome='pass' if succeeded else 'fail', evidence=evidence,
                        shell_fact_id=f"{key}:{item['reference_id']}:{item.get('step_id', '')}")
            facts.append(data)
        io.write(state_path, dict(state, terminal=True, result=result, error=receipt['error'], facts=facts))
        replay(directory, key)
    elif paths:
        io.emit(directory, 'blocked', {'reason': receipt['error'] or (result or {}).get('failure') or 'cleanup incomplete',
                'activity_key': key, 'reference_id': paths[0]['reference_id'], 'activity_id': paths[0]['activity_id'],
                'execution_stopped': True, 'recovery': 'cleanup_only', 'evidence': evidence})
    if error:
        raise error
    return result
