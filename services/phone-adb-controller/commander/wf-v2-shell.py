#!/usr/bin/env python3
"""外壳活动事实：固定UUID映射，保留每次原件，重入不重复终态事件。"""
from datetime import datetime, timezone
import hashlib
import importlib.util
from pathlib import Path

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


def source_files(phone, key):
    directory = phone.directory
    sources = list(phone.control_receipts) + list(directory.glob(key + '*.log'))
    sources += [p for p in directory.glob(key + '*.json') if p.name != key + '.json']
    sources += list((directory / 'evidence').glob(phone.envelope['run_id'] + '-' + key + '*'))
    if (directory / 'root-identity.json').exists():
        sources.append(directory / 'root-identity.json')
    return [{'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(set(sources))]


def commit_receipt(phone, key, result):
    # 阶段完成标记与同次尝试身份/原始时间/原件hash原子落盘；没有后续双写窗口。
    state = io.read(phone.directory / ('shell-' + key + '.json'))
    meta = {'run_id': phone.envelope['run_id'], 'activity_key': key, 'attempt': state['attempt'],
            'started_at': state['started_at'], 'ended_at': now(), 'files': source_files(phone, key)}
    receipt = dict(result, _shell=meta)
    io.write(phone.directory / (key + '.json'), receipt)
    return receipt


def finish(phone, key, state, result, error, meta):
    directory, envelope = phone.directory, phone.envelope
    paths = bound_paths(envelope, key)
    sequence = meta['attempt']
    archive = directory / 'shell-evidence' / key / str(sequence)
    archive.mkdir(parents=True, exist_ok=True)
    receipt = {'activity_key': key, 'run_id': envelope['run_id'], 'started_at': meta['started_at'],
               'ended_at': meta['ended_at'], 'result': result, 'error': error}
    attempt_path = archive / 'attempt.json'
    if attempt_path.exists() and io.read(attempt_path) != receipt:
        raise ValueError('immutable shell attempt receipt conflict')
    if not attempt_path.exists():
        io.write(attempt_path, receipt)
    files = [{'path': str(attempt_path), 'sha256': hashlib.sha256(attempt_path.read_bytes()).hexdigest()}]
    for index, source in enumerate(meta['files']):
        target = archive / (str(index) + '-' + Path(source['path']).name)
        raw = target.read_bytes() if target.exists() else Path(source['path']).read_bytes()
        if hashlib.sha256(raw).hexdigest() != source['sha256']:
            raise ValueError('shell original evidence hash mismatch')
        if not target.exists():
            target.write_bytes(raw)
        files.append({'path': str(target), 'sha256': source['sha256']})
    succeeded = not error and (key == 'preflight' or (result or {}).get('completed') is True)
    ended = datetime.fromisoformat(meta['ended_at']).timestamp()
    terminal = key == 'preflight' or succeeded or ended >= phone.cleanup_deadline
    evidence = {'source': 'commander-shell', 'activity_key': key, 'files': files, 'attempt': sequence}
    facts = []
    if terminal:
        for item in paths:
            data = {k: item[k] for k in ('reference_id', 'activity_id', 'step_id') if k in item}
            data.update(started_at=meta['started_at'], ended_at=meta['ended_at'], outcome='pass' if succeeded else 'fail', evidence=evidence,
                        shell_fact_id=f"{key}:{item['reference_id']}:{item.get('step_id', '')}")
            facts.append(data)
    else:
        # pending清理仍是一项未结束活动，失败尝试只记事件并保留原件。
        identity = f'{key}:{sequence}'
        if paths and not any(x['data'].get('shell_attempt_id') == identity for x in io.read(directory / 'events.json')):
            io.emit(directory, 'blocked', {'reason': error or (result or {}).get('failure') or 'cleanup incomplete',
                    'activity_key': key, 'reference_id': paths[0]['reference_id'], 'activity_id': paths[0]['activity_id'],
                    'execution_stopped': True, 'recovery': 'cleanup_only', 'evidence': evidence, 'shell_attempt_id': identity})
    io.write(directory / ('shell-' + key + '.json'), dict(state, terminal=terminal, result=result,
             error=error, facts=facts, last_finished_attempt=sequence))
    replay(directory, key)
    return result


def recover(phone, key):
    state_path = phone.directory / ('shell-' + key + '.json')
    receipt_path = phone.directory / (key + '.json')
    if not state_path.exists():
        if receipt_path.exists():
            raise ValueError('phase receipt lacks durable shell attempt identity: ' + key)
        return
    state = io.read(state_path)
    if state.get('terminal'):
        replay(phone.directory, key)
        return state.get('result')
    if not receipt_path.exists():
        return
    receipt = io.read(receipt_path)
    meta = receipt.get('_shell', {})
    if not meta or meta.get('run_id') != phone.envelope['run_id'] or meta.get('activity_key') != key:
        raise ValueError('phase receipt lacks matching original shell evidence: ' + key)
    if meta['attempt'] == state.get('last_finished_attempt'):
        return state.get('result')
    if meta['attempt'] != state.get('attempt') or meta['started_at'] != state['started_at']:
        raise ValueError('phase receipt shell attempt conflict: ' + key)
    return finish(phone, key, state, receipt, None, meta)


def execute(phone, key, callback):
    directory, envelope = phone.directory, phone.envelope
    bound_paths(envelope, key)  # 显式映射通过后才可触发设备动作。
    recover(phone, key)
    state_path = directory / ('shell-' + key + '.json')
    state = io.read(state_path) if state_path.exists() else {'started_at': now(), 'terminal': False}
    if state.get('terminal'):
        if state.get('error'):
            raise ValueError(state['error'])
        return state.get('result')
    archive_root = directory / 'shell-evidence' / key
    archive_root.mkdir(parents=True, exist_ok=True)
    sequence = max([int(p.name) for p in archive_root.iterdir()] + [state.get('attempt', 0)]) + 1
    state['attempt'] = sequence
    io.write(state_path, state)
    phone.control_receipts = []
    error, result = None, None
    try:
        result = callback()
    except Exception as caught:
        error = caught
    receipt_path = directory / (key + '.json')
    if not error and receipt_path.exists() and io.read(receipt_path).get('_shell', {}).get('attempt') == sequence:
        return recover(phone, key)
    # callback异常没有成功标记；原错误与此刻真实结束时间同样持久，不编成功。
    meta = {'attempt': sequence, 'started_at': state['started_at'], 'ended_at': now(), 'files': source_files(phone, key)}
    result = finish(phone, key, state, result, str(error) if error else None, meta)
    if error:
        raise error
    return result
