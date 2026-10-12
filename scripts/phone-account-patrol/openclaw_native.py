#!/usr/bin/env python3
"""原生 OpenClaw infra 工具：只登记代码任务、只读复核，不调用模型或手机。"""
import argparse
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


def api(path, body=None):
    request = urllib.request.Request(bridge.API + path, data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
                                     headers={'Content-Type': 'application/json'})
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
                         'business_receipt': {k: result[k] for k in ['task_id', 'status', 'serial', 'phone', 'checked_at', 'states'] if k in result} if result else None})
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


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['enqueue', 'inspect', 'resolve-task'])
    parser.add_argument('--leader-task-id')
    parser.add_argument('--review-leader-task-id')
    parser.add_argument('--batch-task-id')
    parser.add_argument('--session-key')
    args = parser.parse_args(argv)
    try:
        deployment = bridge.load_deployment(STATE)
        if args.mode == 'resolve-task':
            value = {'leader_task_id': resolve_task(args.session_key, deployment)}
        elif args.mode == 'enqueue':
            value = enqueue(bridge.uuid(args.leader_task_id), deployment, STATE)
        else:
            value = inspect(bridge.uuid(args.review_leader_task_id), args.batch_task_id, deployment, STATE)
        print(json.dumps(value, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({'status': 'failed', 'actor': 'OpenClaw:infra', 'reason': 'missing_launch' if str(error) == 'missing_launch' else 'native_validation_failed',
                          'error_type': type(error).__name__}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main())
