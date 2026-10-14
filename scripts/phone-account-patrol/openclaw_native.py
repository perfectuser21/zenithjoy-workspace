#!/usr/bin/env python3
"""原生 infra 调度、只读复核与持续恢复；手机动作只交给冻结runner。"""
import argparse
import fcntl
import hashlib
import os
import subprocess
import datetime as dt
import importlib.util
import json
import pathlib
import re
import shlex
import sys
import urllib.request
import zoneinfo

SPEC = importlib.util.spec_from_file_location('patrol_native_bridge', pathlib.Path(__file__).with_name('openclaw_commander.py'))
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)
STATE = bridge.STATE


def safe_error_text(value, limit=2000, _depth=0):
    text = value.decode('utf-8', errors='replace') if isinstance(value, bytes) else str(value or '')
    if _depth > 6:
        return '[TRUNCATED]'
    if len(text) > 1000000:
        return '[LOG OMITTED: exceeds diagnostic safety limit]'
    if text.lstrip().startswith(('{', '[')) and len(text) <= 100000:
        try:
            structured = json.loads(text)
        except RecursionError:
            return '[LOG OMITTED: diagnostic nesting exceeds safety limit]'
        except ValueError:
            pass
        else:
            text = json.dumps(safe_error_value(structured, _depth + 1), ensure_ascii=False)
    # Structured output can be surrounded by plain console lines or prefixes.
    decoder = json.JSONDecoder()
    pieces, cursor = [], 0
    for attempt, marker in enumerate(re.finditer(r'[\{\[]', text)):
        if marker.start() < cursor:
            continue
        if attempt >= 128:
            pieces.append('[REMAINING LOG OMITTED]'); cursor = len(text); break
        try:
            value, end = decoder.raw_decode(text, marker.start())
        except (ValueError, RecursionError):
            continue
        if isinstance(value, (dict, list)):
            pieces.extend([text[cursor:marker.start()], json.dumps(safe_error_value(value, _depth + 1), ensure_ascii=False)])
            cursor = end
    if pieces:
        text = ''.join(pieces) + text[cursor:]
    for key, secret in os.environ.items():
        if re.search(r'token|password|secret|api.?key', key, re.I) and len(secret) >= 4:
            text = text.replace(secret, '[REDACTED]')
    text = re.sub(r'(?i)("[^"\n]{0,100}(?:password|token|secret|api[_-]?key|authorization)[^"\n]{0,100}"\s*:\s*)"(?:\\.|[^"\\])*"', r'\1"[REDACTED]"', text)
    text = re.sub(r'''(?i)(["']?[\w-]{0,80}(?:password|token|secret|api[_-]?key|authorization)[\w-]{0,80}["']?\s*[:=]\s*)"(?:\\.|[^"\\])*"''', r'\1"[REDACTED]"', text)
    text = re.sub(r'''(?i)(["']?[\w-]{0,80}(?:password|token|secret|api[_-]?key|authorization)[\w-]{0,80}["']?\s*[:=]\s*)'(?:\\.|[^'\\])*' ''', r"\1'[REDACTED]'", text, flags=re.X)
    text = re.sub(r'(?im)^(\s*(?:authorization|proxy-authorization)\s*:\s*)[^\r\n]+', r'\1[REDACTED]', text)
    text = re.sub(r'(?i)((?:Bearer|Basic)\s+)[^\s"\']+', r'\1[REDACTED]', text)
    text = re.sub(r'''(?i)(["']?(?:password|token|secret|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^\s"'&,}]+''', r'\1[REDACTED]', text)
    text = re.sub(r'(https?://)[^/\s@]+@', r'\1[REDACTED]@', text)
    text = re.sub(r'(https?://[^\s?]+\?)[^\s"\']+', r'\1[REDACTED]', text)
    return text[:limit]


def safe_error_value(value, _depth=0):
    if _depth > 6:
        return '[TRUNCATED]'
    if isinstance(value, dict):
        return {k: '[REDACTED]' if re.search(r'password|token|secret|api.?key|authorization', k, re.I) else safe_error_value(v, _depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        return [safe_error_value(v, _depth + 1) for v in value[:20]]
    return safe_error_text(value, _depth=_depth + 1) if isinstance(value, str) else value


def safe_failure(value):
    # Only transport the public error contract, never arbitrary nested data.
    failure = {k: safe_error_text(value[k], 1000 if k == 'message' else 2000) for k in
               ['stage', 'code', 'message', 'host', 'stderr', 'stdout', 'error_type'] if isinstance(value.get(k), str)}
    failure['exit_code'] = value.get('exit_code') if type(value.get('exit_code')) is int else None
    failure['timeout_sec'] = value.get('timeout_sec') if type(value.get('timeout_sec')) in (int, float) else None
    failure['truncated'] = value.get('truncated') is True
    failure['evidence'] = [safe_error_text(v, 500) for v in value.get('evidence', [])[:10] if isinstance(v, str)] if isinstance(value.get('evidence'), list) else []
    return failure


def api(path, body=None, method=None):
    request = urllib.request.Request(bridge.API + path, data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
                                     headers={'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def leader(task_id, deployment, call, workflow, *, active=False):
    task = bridge.read_task(call, bridge.uuid(task_id))
    payload = task.get('payload') or {}
    if (task.get('task_type') != 'qiumi_task' or task.get('project_id') != deployment['project_id']
            or payload.get('qiumi_department') != 'infra' or payload.get('workflow_id') != workflow
            or payload.get('phone_source_revision') != bridge.PHONE_SOURCE_REVISION
            or not re.fullmatch(r'[0-9a-f]{40}', payload.get('source_revision', ''))
            or (active and task.get('status') != 'in_progress')):
        raise ValueError('领跑者不是归属和源码一致的真实 infra 中央任务')
    route = payload.get('qiumi_route')
    if not isinstance(route, dict) or route.get('source') != 'explicit':
        raise ValueError('领跑者没有明确 infra 路由')
    return task


def batch_command(deployment):
    return '/usr/bin/python3 ' + shlex.quote(str(pathlib.Path(deployment['release']) / 'runner.py')) + ' batch --execution-script "$0"'


def verify_batch(task_id, parent, deployment, call):
    batch = bridge.read_task(call, bridge.uuid(task_id))
    p = batch.get('payload') or {}
    pp = parent.get('payload') or {}
    if (batch.get('task_type') != 'script_run' or batch.get('parent_task_id') != parent['id']
            or batch.get('project_id') != deployment['project_id'] or p.get('workflow_id') != deployment['batch_workflow_id']
            or p.get('source_revision') != bridge.PHONE_SOURCE_REVISION or p.get('runtime_requires_llm') is not False
            or p.get('cmd') != batch_command(deployment) or not re.fullmatch(bridge.UUID, p.get('routing_receipt_id') or '')
            or p.get('recurring_task_id') != pp.get('recurring_task_id') or p.get('recurring_slot') != pp.get('recurring_slot')):
        raise ValueError('代码批次的真实来源、父任务或冻结合同不一致')
    return batch


def enqueue(task_id, deployment, state, call=None):
    call = call or api
    parent = leader(task_id, deployment, call, deployment['batch_workflow_id'], active=True)
    p = parent['payload']
    periodic = {}
    if 'recurring_task_id' in p or 'recurring_slot' in p:
        bridge.uuid(p.get('recurring_task_id'))
        raw = p.get('recurring_slot') or ''
        slot = dt.datetime.fromisoformat(raw[:-1] + '+00:00' if raw.endswith('Z') else raw)
        if slot.tzinfo is None:
            raise ValueError('领跑者定时身份不完整')
        periodic = {k: p[k] for k in ['recurring_task_id', 'recurring_slot']}
    body = {'title': '四手机账号巡查代码批次 · ' + task_id, 'description': 'OpenClaw infra 领跑登记；冻结代码执行，手机结果以各自运行记录为准。',
            'task_type': 'script_run', 'priority': 'P2', 'project_id': deployment['project_id'], 'parent_task_id': task_id, 'sequence_no': 1,
            'source_id': 'OpenClaw:infra:' + task_id + ':batch',
            'payload': {'host': 'mmv', 'cmd': batch_command(deployment), 'timeout_sec': 180,
                        'workflow_id': deployment['batch_workflow_id'], 'source_revision': bridge.PHONE_SOURCE_REVISION,
                        'runtime_requires_llm': False, 'multi_task': True, 'depends_on': [], **periodic}}
    created = call('tasks', body)
    if isinstance(created.get('task'), dict):
        created = created['task']
    batch = verify_batch(created.get('id'), parent, deployment, call)
    receipt = {'status': 'queued', 'actor': 'OpenClaw:infra', 'leader_task_id': task_id, 'batch_task_id': batch['id'],
               'source_revision': bridge.PHONE_SOURCE_REVISION, 'leader_source_revision': p['source_revision'], 'verified': True,
               'facts': '只登记纯代码批次；未执行手机，手机任务由中央后续派发。'}
    bridge.save(state, 'native-launch-' + task_id + '.json', receipt)
    bridge.save(state, 'native-openclaw.latest.json', receipt)
    return receipt


def stdout_receipt(task):
    for line in reversed((task.get('result') or {}).get('script', {}).get('stdout', '').splitlines()):
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict) and value.get('task_id') == task['id']:
            return value
    return None


def inspect(review_id, batch_id, deployment, state, call=None, current=None):
    call = call or api
    leader(review_id, deployment, call, bridge.MAINTENANCE_WORKFLOW_ID, active=True)
    automatic = batch_id is None
    latest = None
    if automatic:
        latest = json.loads((state / 'native-openclaw.latest.json').read_text())
        if latest.get('verified') is not True or latest.get('source_revision') != bridge.PHONE_SOURCE_REVISION:
            raise ValueError('missing_launch')
        batch_id = bridge.uuid(latest.get('batch_task_id'))
    batch = bridge.read_task(call, bridge.uuid(batch_id))
    parent = leader(batch.get('parent_task_id'), deployment, call, deployment['batch_workflow_id'])
    batch = verify_batch(batch_id, parent, deployment, call)
    if automatic:
        p = parent['payload']
        if (latest.get('leader_task_id') != parent['id'] or latest.get('leader_source_revision') != p.get('source_revision')
                or p.get('recurring_task_id') != deployment['schedule_id']):
            raise ValueError('missing_launch')
        raw = p.get('recurring_slot') or ''
        slot = dt.datetime.fromisoformat(raw[:-1] + '+00:00' if raw.endswith('Z') else raw)
        if slot.tzinfo is None:
            raise ValueError('missing_launch')
        local = slot.astimezone(zoneinfo.ZoneInfo('Asia/Shanghai'))
        today = (current or dt.datetime.now(dt.timezone.utc)).astimezone(local.tzinfo).date()
        if local.date() != today or (local.hour, local.minute, local.second, local.microsecond) != (22, 0, 0, 0):
            raise ValueError('missing_launch')
    receipt = stdout_receipt(batch)
    tasks = bridge.verify_children(receipt, batch_id, deployment, call, current_phones=False) if receipt else []
    children = []
    for task in tasks:
        script = (task.get('result') or {}).get('script') or {}
        result = stdout_receipt(task)
        children.append({'task_id': task['id'], 'serial': task['payload']['phone_serial'], 'status': task['status'],
                         'run_id': script.get('run_id') or task['payload'].get('script_run_id'), 'exit_code': script.get('exit_code'),
                         'business_status': result.get('status') if result else 'unknown',
                         'business_receipt': {k: (safe_failure(result[k]) if k == 'failure' else result[k]) for k in ['task_id', 'run_id', 'status', 'serial', 'phone', 'checked_at', 'states', 'failure'] if k in result} if result else None})
    batch_script = (batch.get('result') or {}).get('script') or {}
    batch_exit = batch_script.get('exit_code')
    nonzero_exit = lambda value: type(value) is int and value != 0
    valid_run = lambda task_id, run_id: isinstance(run_id, str) and re.fullmatch('script-' + re.escape(task_id) + '-a[1-9][0-9]*', run_id) is not None
    if (batch['status'] in ['failed', 'cancelled', 'blocked'] or nonzero_exit(batch_exit)
            or any(c['status'] in ['failed', 'cancelled', 'blocked'] or c['business_status'] == 'failed' or nonzero_exit(c['exit_code']) for c in children)):
        status = 'failed'
    elif batch['status'] != 'completed' or any(c['status'] != 'completed' for c in children):
        status = 'waiting'
    elif (not children or type(batch_exit) is not int or batch_exit != 0 or not valid_run(batch_id, batch_script.get('run_id'))
            or any(c['business_status'] not in ['completed', 'deferred'] or type(c['exit_code']) is not int or c['exit_code'] != 0
                   or not valid_run(c['task_id'], c['run_id']) for c in children)
            or any(((t.get('result') or {}).get('script') or {}).get('run_id') != c['run_id'] for c, t in zip(children, tasks))):
        status = 'unknown'
    elif any(c['business_status'] == 'deferred' for c in children):
        status = 'deferred'
    else:
        status = 'completed'
    snapshot = {'status': status, 'actor': 'OpenClaw:infra', 'task_id': review_id, 'batch_task_id': batch_id,
                'leader_task_id': parent['id'], 'source_revision': bridge.PHONE_SOURCE_REVISION,
                'batch_status': batch['status'], 'batch_run_id': (batch.get('result') or {}).get('script', {}).get('run_id') or batch['payload'].get('script_run_id'),
                'batch_exit_code': (batch.get('result') or {}).get('script', {}).get('exit_code'), 'children': children}
    snapshot['recovery_demands'] = bridge.recovery_snapshots(bridge.task_rows(call, deployment['project_id']))
    bridge.save(state, 'native-review-' + review_id + '.json', snapshot)
    return snapshot


def resolve_task(session_key, deployment, call=None):
    call = call or api
    match = re.fullmatch(r'agent:infra:([A-Za-z0-9_-]{1,150})', session_key or '')
    if not match:
        raise ValueError('不是本轮官方 infra sessionKey')
    found, seen, offset = [], set(), 0
    while True:
        page = call('tasks?project_id=' + deployment['project_id'] + '&task_type=qiumi_task&status=in_progress&limit=200&offset=' + str(offset))
        rows = page if isinstance(page, list) else page.get('tasks', page.get('data'))
        if not isinstance(rows, list):
            raise ValueError('任务清单读回不完整')
        for summary in rows:
            if summary['id'] in seen:
                raise ValueError('中央任务分页重复')
            seen.add(summary['id'])
            task = bridge.read_task(call, summary['id'])
            p = task.get('payload') or {}
            if (task.get('status') == 'in_progress' and task.get('task_type') == 'qiumi_task'
                    and task.get('project_id') == deployment['project_id'] and p.get('qiumi_department') == 'infra'
                    and p.get('run_id') == match.group(1)):
                leader(task['id'], deployment, call, p.get('workflow_id'), active=True)
                if p.get('workflow_id') not in [deployment['batch_workflow_id'], bridge.MAINTENANCE_WORKFLOW_ID]:
                    raise ValueError('session 不是巡查或维护领跑者')
                found.append(task['id'])
        if len(rows) < 200:
            break
        offset += len(rows)
    if len(found) != 1:
        raise ValueError('session 没有唯一真实运行中的 infra 任务')
    return found[0]


def execution_task(script):
    path = pathlib.Path(script or '')
    match = re.fullmatch('script-(' + bridge.UUID + ')-a[1-9][0-9]*\\.sh', path.name)
    if not path.is_absolute() or '..' in path.parts or not match:
        raise ValueError('入口没有真实中央 script_run 身份')
    return match.group(1)


def maintain(task_id, deployment, state, call=None, current=None, run=None):
    call = call or api;run = run or subprocess.run;current = current or dt.datetime.now(dt.timezone.utc)
    path = pathlib.Path(__file__).resolve()
    parent = bridge.read_task(call, task_id);p = parent.get('payload') or {}
    if (parent.get('task_type') != 'script_run' or parent.get('status') != 'in_progress' or parent.get('project_id') != deployment['project_id']
            or p.get('workflow_id') != bridge.MAINTENANCE_WORKFLOW_ID or p.get('runtime_requires_llm') is not False
            or not re.fullmatch(r'[0-9a-f]{40}', p.get('source_revision', ''))
            or (re.fullmatch(r'[0-9a-f]{40}', path.parent.name) and p['source_revision'] != path.parent.name)):
        raise ValueError('持续维护不是正式中央维护代码任务')
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / 'native-maintenance.lock').open('a') as lock:
        os.fchmod(lock.fileno(), 0o600)
        try:fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:return {'status': 'busy', 'maintenance_task_id': task_id, 'legacy_health': None, 'recovery': {'demands': []}}
        command = ['/usr/bin/python3', str(pathlib.Path(deployment['release']) / 'runner.py'), 'monitor']
        try:legacy = run(command, capture_output=True, text=True, timeout=450)
        except (subprocess.TimeoutExpired, OSError):legacy = subprocess.CompletedProcess(command, -1, '', '')
        legacy_failed = bool(legacy.returncode)
        health = None
        for line in reversed(legacy.stdout.splitlines()):
            try:health = json.loads(line)
            except ValueError:continue
            if isinstance(health, dict) and health.get('maintenance_owner') == '主理人' and 'status' in health:break
            health = None
        if health is None or legacy_failed:
            health = {'status': 'unknown', 'reason': 'legacy_monitor_failed', 'exit_code': legacy.returncode};legacy_failed = True
        path = pathlib.Path(__file__).resolve();digest = hashlib.sha256(path.read_bytes()).hexdigest()
        deployments = bridge.recovery_deployments(state, deployment, bridge.task_rows(call, deployment['project_id']))
        results = [bridge.recover(call, frozen, current, path, digest, p['source_revision']) for frozen in deployments]
        recovery = {key: [entry for result in results for entry in result[key]] for key in ['demands', 'covered_originals']}
        value = {'status': 'partial_failure' if legacy_failed else 'observed', 'actor': 'OpenClaw:infra', 'maintenance_task_id': task_id, 'legacy_health': health, 'recovery': recovery}
        bridge.save(state, 'native-maintenance-' + task_id + '.json', value)
        return value


def recovery_phone(script, demand_id, serial, deployment, call=None, run=None):
    call = call or api;run = run or subprocess.run;task_id = execution_task(script)
    demand = bridge.read_task(call, demand_id)
    revision = bridge.phone_revision(demand, deployment)
    if revision != deployment['source_revision']:
        deployment = bridge.load_historical_deployment(STATE, revision, deployment)
    scope = bridge.demand_scope(demand, deployment)
    receipt = {'task_id': task_id, 'serial': serial, 'source_revision': deployment['source_revision'], 'actor': 'phone-account-patrol-recovery'}
    if demand['status'] in bridge.CLOSED:return dict(receipt, status='stopped', reason='demand_closed'), 0
    task = bridge.read_task(call, task_id);p = task.get('payload') or {}
    digest = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
    control_path = pathlib.Path(__file__).resolve()
    expected = ['/usr/bin/python3', str(pathlib.Path(__file__).resolve()), 'recovery-phone', '--demand-task-id', demand_id, '--serial', serial, '--execution-script', '$0']
    if (shlex.split(p.get('cmd') or '') != expected or p.get('host') != 'mmv' or p.get('recovery_demand_id') != demand_id
            or type(p.get('recovery_generation')) is not int or p['recovery_generation'] < 1 or p.get('recurring_task_id') is not None
            or p.get('original_schedule_id') != scope['original_schedule_id'] or p.get('original_slot') != scope['original_slot']
            or demand['status'] != 'blocked' or task.get('parent_task_id') != demand_id or task.get('status') != 'in_progress'
            or task.get('task_type') != 'script_run' or task.get('project_id') != deployment['project_id']
            or p.get('original_scope') != scope or p.get('phone_serial') != serial or serial != scope['phone_serial']
            or p.get('source_revision') != deployment['source_revision'] or p.get('workflow_id') != deployment['single_workflow_id']
            or p.get('control_sha256') != digest or not re.fullmatch(r'[0-9a-f]{40}', p.get('control_source_revision') or '')
            or (re.fullmatch(r'[0-9a-f]{40}', control_path.parent.name) and p['control_source_revision'] != control_path.parent.name)
            or p.get('runtime_requires_llm') is not False):
        raise ValueError('recovery_identity_mismatch')
    phones = [x for x in call('phone-registry')['phones'] if x.get('serial') == serial]
    if len(phones) != 1 or phones[0].get('host') != 'xian-m4':raise ValueError('recovery_identity_mismatch')
    if not phones[0].get('enabled'):return dict(receipt, status='stopped', reason='device_disabled'), 0
    rows = bridge.task_rows(call, deployment['project_id'])
    if any(t['id'] != task_id and t.get('task_type') == 'script_run' and (t.get('payload') or {}).get('phone_serial') == serial
           and t['status'] in bridge.ACTIVE for t in rows):return dict(receipt, status='deferred', reason='device_has_other_task'), 0
    # 尽可能贴近真实手机入口再次读取取消；不抢设备锁，冻结控制器负责最后的原生锁仲裁。
    fresh = bridge.read_task(call, demand_id)
    if fresh['status'] in bridge.CLOSED:return dict(receipt, status='stopped', reason='demand_closed'), 0
    if fresh['status'] != 'blocked' or bridge.demand_scope(fresh, deployment) != scope:raise ValueError('recovery_identity_mismatch')
    phones = [x for x in call('phone-registry')['phones'] if x.get('serial') == serial]
    if len(phones) != 1 or phones[0].get('host') != 'xian-m4':raise ValueError('recovery_identity_mismatch')
    if not phones[0].get('enabled'):return dict(receipt, status='stopped', reason='device_disabled'), 0
    receipt.update(run_id=pathlib.Path(script).stem, workflow_id=deployment['single_workflow_id'])
    try:
        output = run(['/usr/bin/python3', str(pathlib.Path(deployment['release']) / 'runner.py'), 'phone', '--serial', serial, '--execution-script', script],
                     capture_output=True, text=True, timeout=1150)
    except subprocess.TimeoutExpired as error:
        return dict(receipt, status='failed', failure={'stage': 'phone_subprocess', 'code': 'phone_subprocess_timeout',
            'message': '单手机执行超时', 'exit_code': None, 'timeout_sec': 1150,
            'stdout': safe_error_text(error.output), 'stderr': safe_error_text(error.stderr), 'evidence': []}), 1
    if output.returncode:
        for line in reversed(output.stdout.splitlines()):
            try: value = json.loads(line)
            except ValueError: continue
            if (isinstance(value, dict) and value.get('status') == 'failed' and value.get('task_id') == task_id
                    and value.get('serial') == serial and value.get('workflow_id') == deployment['single_workflow_id']
                    and value.get('source_revision') == deployment['source_revision'] and value.get('run_id') == receipt['run_id']
                    and isinstance(value.get('failure'), dict)):
                return dict(receipt, status='failed', failure=safe_failure(value['failure'])), output.returncode
        return dict(receipt, status='failed', reason='frozen_phone_failed', failure={
            'stage': 'phone_subprocess', 'code': 'phone_subprocess_failed', 'message': '单手机子进程失败，详见原始错误',
            'exit_code': output.returncode, 'stdout': safe_error_text(output.stdout), 'stderr': safe_error_text(output.stderr), 'evidence': []}), output.returncode
    for line in reversed(output.stdout.splitlines()):
        try:value = json.loads(line)
        except ValueError:continue
        if isinstance(value, dict) and value.get('task_id') == task_id and value.get('serial') == serial and value.get('source_revision') == deployment['source_revision']:
            return value, 0
    raise ValueError('冻结手机运行没有同身份回执')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['enqueue', 'inspect', 'resolve-task', 'maintain', 'recovery-phone'])
    parser.add_argument('--leader-task-id')
    parser.add_argument('--review-leader-task-id')
    parser.add_argument('--batch-task-id')
    parser.add_argument('--session-key')
    parser.add_argument('--execution-script')
    parser.add_argument('--demand-task-id')
    parser.add_argument('--serial')
    args = parser.parse_args(argv)
    execution_id = None
    try:
        if args.mode in ['maintain', 'recovery-phone']:execution_id = execution_task(args.execution_script)
        deployment = bridge.load_deployment(STATE)
        if args.mode == 'maintain':
            value = maintain(execution_id, deployment, STATE)
        elif args.mode == 'recovery-phone':
            value, code = recovery_phone(args.execution_script, bridge.uuid(args.demand_task_id), args.serial, deployment)
            print(json.dumps(value, ensure_ascii=False));return code
        elif args.mode == 'resolve-task':
            value = {'leader_task_id': resolve_task(args.session_key, deployment)}
        elif args.mode == 'enqueue':
            value = enqueue(bridge.uuid(args.leader_task_id), deployment, STATE)
        else:
            value = inspect(bridge.uuid(args.review_leader_task_id), args.batch_task_id, deployment, STATE)
        print(json.dumps(value, ensure_ascii=False))
        return 1 if value.get('status') == 'partial_failure' else 0
    except Exception as error:
        print(json.dumps({'status': 'failed', 'actor': 'OpenClaw:infra', 'reason': 'recovery_identity_mismatch' if args.mode == 'recovery-phone' and isinstance(error, ValueError) else ('missing_launch' if str(error) == 'missing_launch' else 'native_validation_failed'),
                          'error_type': type(error).__name__, 'task_id': execution_id,
                          'serial': args.serial if args.mode == 'recovery-phone' else None}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main())
