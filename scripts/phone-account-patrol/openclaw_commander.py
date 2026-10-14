#!/usr/bin/env python3
"""原生 infra 巡查的共享真实性验证库；不启动 Agent 或手机。"""
import hashlib
import datetime as dt
import shlex
import zoneinfo
import json
import os
import pathlib
import re
import tempfile

STATE = pathlib.Path.home() / '.local/share/phone-account-patrol'
CONTROL_RELEASES = pathlib.Path.home() / '.local/share/infra-workflow-commander/releases'
API = 'http://localhost:5221/api/brain/'
PHONE_SOURCE_REVISION = '864154c57e88e8085d2add741a79103a28891a44'
MAINTENANCE_WORKFLOW_ID = 'e4d2030f-129f-4668-95dd-4a6d880493a8'
EXPECTED_SHA256 = {
    'runner.py': '026e94011162a4e42e7e07edf4c5b04f28796067dae3161e5ce185c4bd53e16e',
    'collector.py': '501dd4af5358676473201ecbf8c3712db682e9a17128d52e3565021a3cb521f3',
    'dispatch.py': 'ea60ff9e538aa77f991d5f234d47cb392a2613ead560c0963d5949d53a1694de',
    'preflight.py': 'c89d4dcc6ec3523af9423d4daa8995a0ae5e3243da49058bb9d823729dc7d9e7',
    'publish.mjs': '528daa587ceba84348723fbf24a7169645462a71a1378407910ed0d2b5daf6bf',
    'ocr.swift': '89431efae1526a56b9e5164cee7293f4ea877f6d4ca61f1b76b05f48d3291005',
    'SKILL.md': 'ee99dc331f8aec05c1071260dcfb06197c4add7d74b5160ea3084b5b8b5e6dde',
    'mirror.mjs': 'a628a9406528a24de126a9cafdc63c17a9f9f8e0d82d1b2dd41a94a3efc8ebb0',
}
LEGACY_PHONE_REVISION = '4f899cab6425341646e27c5fca20979b8ac42be7'
LEGACY_CONTROL_REVISION = '22d20ba53b7d33f595be0984b790fe77921c0917'
LEGACY_CONTROL_SHA256 = '988f3f65522dbc9a0f33cf3161ca58e08981b6713e185972eb5d499dce58b596'
LEGACY_EXPECTED_SHA256 = {
    'runner.py': '26c5e6dc065b42f8298e485aca2492f25eb83b8a9650409ca3dc33b51798b9ce',
    'collector.py': '501dd4af5358676473201ecbf8c3712db682e9a17128d52e3565021a3cb521f3',
    'dispatch.py': 'ea60ff9e538aa77f991d5f234d47cb392a2613ead560c0963d5949d53a1694de',
    'preflight.py': 'a2874821f56add3ab2e80e5ded7510d2df0b4f2bbf09b87fc63a755b59918ce0',
    'publish.mjs': '528daa587ceba84348723fbf24a7169645462a71a1378407910ed0d2b5daf6bf',
    'ocr.swift': '89431efae1526a56b9e5164cee7293f4ea877f6d4ca61f1b76b05f48d3291005',
    'SKILL.md': 'ee99dc331f8aec05c1071260dcfb06197c4add7d74b5160ea3084b5b8b5e6dde',
    'mirror.mjs': 'a628a9406528a24de126a9cafdc63c17a9f9f8e0d82d1b2dd41a94a3efc8ebb0',
}
ACCEPTED_RELEASES = {PHONE_SOURCE_REVISION: EXPECTED_SHA256, LEGACY_PHONE_REVISION: LEGACY_EXPECTED_SHA256}
UUID = r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}'


def uuid(value):
    if not isinstance(value, str) or not re.fullmatch(UUID, value):
        raise ValueError('任务或流程身份不是完整 UUID')
    return value


def save(state, name, value):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary_name = tempfile.mkstemp(prefix=name + '.', suffix='.tmp', dir=str(state))
    temporary = pathlib.Path(temporary_name)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream, ensure_ascii=False, indent=2)
        target = state / name
        temporary.replace(target)
        return target
    finally:
        if temporary.exists():
            temporary.unlink()


def verify_deployment(state, pointer, revision):
    hashes = ACCEPTED_RELEASES.get(revision)
    if hashes is None:raise ValueError('未验收的手机源码版本')
    expected = state / 'releases' / revision
    release = pathlib.Path(pointer.get('release', ''))
    if pointer.get('source_revision') != revision or release != expected or release.is_symlink():
        raise ValueError('部署指针没有指向已验收的冻结手机代码')
    for key in ['single_workflow_id', 'batch_workflow_id', 'project_id', 'schedule_id']:
        uuid(pointer.get(key))
    if (release / 'deployment.json').is_symlink():raise ValueError('冻结manifest不可是符号链接')
    manifest = json.loads((release / 'deployment.json').read_text())
    if pointer.get('sha256') != hashes or manifest.get('sha256') != hashes:
        raise ValueError('部署文件清单不是已验收版本')
    for key in ['source_revision', 'single_workflow_id', 'batch_workflow_id', 'project_id', 'schedule_id']:
        if manifest.get(key) != pointer[key]:
            raise ValueError('部署指针与冻结 manifest 不一致')
    for name, digest in hashes.items():
        path = release / name
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('冻结代码指纹不一致：' + name)
    return pointer


def load_deployment(state):
    return verify_deployment(state, json.loads((state / 'deployment-current.json').read_text()), PHONE_SOURCE_REVISION)


def load_historical_deployment(state, revision, current):
    if revision not in ACCEPTED_RELEASES:raise ValueError('未验收的历史手机版本')
    release = state / 'releases' / revision
    if release.is_symlink():raise ValueError('历史release不可是符号链接')
    manifest = json.loads((release / 'deployment.json').read_text())
    result = verify_deployment(state, dict(manifest, release=str(release)), revision)
    if any(result[k] != current[k] for k in ['single_workflow_id', 'batch_workflow_id', 'project_id', 'schedule_id']):
        raise ValueError('历史release的流程或计划身份不一致')
    return result


def phone_revision(task, deployment):
    p = task.get('payload') or {}
    if p.get('recovery_demand') or (task.get('task_type') == 'qiumi_task' and p.get('workflow_id') == deployment['batch_workflow_id']):
        revision = p.get('phone_source_revision')
    elif task.get('task_type') == 'script_run' and p.get('workflow_id') in [deployment['single_workflow_id'], deployment['batch_workflow_id']]:
        revision = p.get('source_revision')
    else:return None
    if not isinstance(revision, str) or revision not in ACCEPTED_RELEASES:raise ValueError('巡查记录含未知手机版本')
    return revision


def recovery_deployments(state, current, tasks):
    revisions = {phone_revision(t, current) for t in tasks} - {None, current['source_revision']}
    return [current] + [load_historical_deployment(state, revision, current) for revision in sorted(revisions)]


def read_task(call, task_id):
    value = call('tasks/' + uuid(task_id))
    if isinstance(value, dict) and isinstance(value.get('task'), dict):
        value = value['task']
    if not isinstance(value, dict) or value.get('id') != task_id:
        raise ValueError('中央任务读回身份不一致')
    return value


def verify_children(receipt, task_id, deployment, call, *, current_phones=True):
    if not isinstance(receipt, dict) or receipt.get('task_id') != task_id or receipt.get('source_revision') != deployment['source_revision']:
        raise ValueError('批次回执身份或版本不一致')
    if receipt.get('status') != 'queued' or not isinstance(receipt.get('children'), list) or not receipt['children']:
        raise ValueError('批次缺少真实非空派发回执')
    seen_ids, seen_serials, children = set(), set(), []
    for child in receipt['children']:
        if not isinstance(child, dict):
            raise ValueError('子任务回执非法')
        child_id = uuid(child.get('task_id'))
        serial = child.get('serial')
        if not isinstance(serial, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', serial):
            raise ValueError('手机标识非法')
        if child_id == task_id or child_id in seen_ids or serial in seen_serials:
            raise ValueError('手机或子任务重复')
        seen_ids.add(child_id)
        seen_serials.add(serial)
        task = read_task(call, child_id)
        payload = task.get('payload') or {}
        if (task.get('parent_task_id') != task_id or task.get('task_type') != 'script_run'
                or task.get('project_id') != deployment['project_id']
                or not re.fullmatch(UUID, payload.get('routing_receipt_id') or '')
                or payload.get('workflow_id') != deployment['single_workflow_id']
                or payload.get('source_revision') != deployment['source_revision'] or payload.get('phone_serial') != serial):
            raise ValueError('中央子任务与冻结巡查合同不一致')
        children.append(task)
    if current_phones:
        enabled = [p['serial'] for p in call('phone-registry')['phones'] if p.get('enabled')]
        if len(enabled) != len(set(enabled)) or seen_serials != set(enabled):
            raise ValueError('派发手机集合与当前启用清单不一致')
    return children

# 持久恢复需求以中央任务为真身；这里不执行手机、也不创建定时器。
ACTIVE = {'queued', 'in_progress'}
CLOSED = {'completed', 'completed_no_pr', 'cancelled', 'canceled', 'archived', 'failed'}
SCOPE_KEYS = ['origin_task_id', 'origin_batch_task_id', 'original_schedule_id', 'original_slot', 'phone_serial', 'phone_source_revision']


def timestamp(value):
    value = value or ''
    parsed = dt.datetime.fromisoformat(value[:-1] + '+00:00' if value.endswith('Z') else value)
    if parsed.tzinfo is None:
        raise ValueError('核验时间缺少时区')
    return parsed


def task_rows(call, project_id):
    result, seen, offset = [], set(), 0
    while True:
        page = call('tasks?project_id=' + uuid(project_id) + '&limit=200&offset=' + str(offset))
        rows = page if isinstance(page, list) else page.get('tasks', page.get('data'))
        if not isinstance(rows, list):
            raise ValueError('中央任务清单不完整')
        for summary in rows:
            if summary['id'] in seen:
                raise ValueError('中央分页重复，不能据此重复派发')
            seen.add(uuid(summary['id']));result.append(summary if all(key in summary for key in ['payload', 'project_id', 'status', 'task_type']) else read_task(call, summary['id']))
        if len(rows) < 200:
            return result
        offset += len(rows)


def business_receipt(task):
    for line in reversed(((task.get('result') or {}).get('script') or {}).get('stdout', '').splitlines()):
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict) and value.get('task_id') == task['id']:
            return value
    return None


def trusted_phone(task, serial, deployment, by_id, wrapper_path):
    p = task.get('payload') or {}
    try:argv = shlex.split(p.get('cmd') or '')
    except ValueError:return False
    frozen = ['/usr/bin/python3', str(pathlib.Path(deployment['release']) / 'runner.py'), 'phone', '--serial', serial, '--execution-script', '$0']
    parent = by_id.get(task.get('parent_task_id'), {})
    def formal(batch):
        bp = batch.get('payload') or {}
        try:
            local = timestamp(bp.get('recurring_slot')).astimezone(zoneinfo.ZoneInfo('Asia/Shanghai'))
            command = shlex.split(bp.get('cmd') or '')
        except (ValueError, TypeError):return False
        return (batch.get('task_type') == 'script_run' and batch.get('project_id') == deployment['project_id']
                and bp.get('workflow_id') == deployment['batch_workflow_id'] and bp.get('source_revision') == deployment['source_revision']
                and bp.get('recurring_task_id') == deployment['schedule_id'] and bp.get('runtime_requires_llm') is False
                and (local.hour, local.minute, local.second, local.microsecond) == (22, 0, 0, 0)
                and command == ['/usr/bin/python3', str(pathlib.Path(deployment['release']) / 'runner.py'), 'batch', '--execution-script', '$0'])
    if argv == frozen:
        if formal(parent):return True
        origin = p.get('recovery_origin_task_id')
        return (origin == parent.get('id') and parent.get('task_type') == 'script_run' and (parent.get('payload') or {}).get('phone_serial') == serial
                and (parent.get('payload') or {}).get('source_revision') == deployment['source_revision'] and formal(by_id.get(parent.get('parent_task_id'), {})))
    if (len(argv) != 9 or argv[0] != '/usr/bin/python3' or argv[2:] != ['recovery-phone', '--demand-task-id', p.get('recovery_demand_id'), '--serial', serial, '--execution-script', '$0']):return False
    path = pathlib.Path(argv[1])
    if not wrapper_path or path.name != 'openclaw_native.py' or not path.is_absolute() or path.is_symlink():return False
    current = pathlib.Path(wrapper_path)
    if current.parent.parent != CONTROL_RELEASES:return False
    allowed = (path == current and re.fullmatch(r'[0-9a-f]{40}', p.get('control_source_revision') or '')
               and current.parent.name == p['control_source_revision'])
    allowed = allowed or (path.parent.parent == current.parent.parent and path.parent.name == LEGACY_CONTROL_REVISION
              and p.get('control_source_revision') == LEGACY_CONTROL_REVISION and p.get('control_sha256') == LEGACY_CONTROL_SHA256)
    try:
        return (allowed and hashlib.sha256(path.read_bytes()).hexdigest() == p.get('control_sha256') and parent.get('payload', {}).get('recovery_demand') is True
                and demand_scope(parent, deployment) == p.get('original_scope'))
    except (OSError, ValueError):return False


def phone_completion(task, serial, deployment, after, by_id=None, current=None, wrapper_path=None):
    payload = task.get('payload') or {};script = (task.get('result') or {}).get('script') or {};receipt = business_receipt(task)
    if (task.get('status') != 'completed' or task.get('task_type') != 'script_run' or task.get('project_id') != deployment['project_id']
            or payload.get('workflow_id') != deployment['single_workflow_id'] or payload.get('source_revision') != deployment['source_revision']
            or payload.get('phone_serial') != serial or payload.get('host') != 'mmv' or payload.get('runtime_requires_llm') is not False
            or type(script.get('exit_code')) is not int or script['exit_code'] != 0
            or not re.fullmatch('script-' + re.escape(task['id']) + '-a[1-9][0-9]*', script.get('run_id') or '')
            or not receipt or receipt.get('status') != 'completed' or receipt.get('serial') != serial or receipt.get('source_revision') != deployment['source_revision']
            or receipt.get('workflow_id') != deployment['single_workflow_id'] or not trusted_phone(task, serial, deployment, by_id or {}, wrapper_path)):
        return None
    names = ['抖音', '小红书', '微信', '快手', '今日头条', '知乎', '微博', 'B站', '视频号']
    states = receipt.get('states') or {}
    evidence = receipt.get('evidence')
    if (any(states.get(name) not in ['已登录', '未登录', '未安装', '待确认'] for name in names)
            or not isinstance(evidence, list) or len(evidence) < 4 or any(not isinstance(e, str) or not e.strip() for e in evidence)
            or any(not any(pathlib.PurePosixPath(e).name == task['id'] + suffix for e in evidence)
                   for suffix in ['.observation.json', '.publish.json', '.mirror.json'])):return None
    try:
        checked = timestamp(receipt.get('checked_at'))
        if checked < max(timestamp(after), timestamp(task.get('created_at'))) or checked > (current or dt.datetime.now(dt.timezone.utc)) + dt.timedelta(seconds=30):return None
    except (ValueError, TypeError):return None
    return {'satisfied_by_task_id': task['id'], 'satisfied_by_run_id': script['run_id'], 'checked_at': receipt['checked_at']}


def demand_scope(demand, deployment):
    p = demand.get('payload') or {}
    if (demand.get('task_type') != 'project' or demand.get('project_id') != deployment['project_id'] or p.get('recovery_demand') is not True
            or p.get('workflow_id') != MAINTENANCE_WORKFLOW_ID or p.get('phone_source_revision') != deployment['source_revision']
            or p.get('maintenance_owner') != '主理人' or p.get('commander') != 'OpenClaw:infra'):
        raise ValueError('恢复需求的固定身份不一致')
    for key in SCOPE_KEYS[:3]:uuid(p.get(key))
    timestamp(p.get('original_slot'))
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', p.get('phone_serial') or ''):
        raise ValueError('恢复需求设备标识非法')
    return {key: p[key] for key in SCOPE_KEYS}


def patch_recovery(call, demand, progress, status=None):
    body = {'result': {'recovery': progress}}
    if status:
        body['status'] = status
        if status == 'completed_no_pr':
            body['result']['handoff'] = {'schema_version': 1, 'task_id': demand['id'], 'actor': 'OpenClaw:infra',
                'summary': '手机巡查需求凭真实运行证据结清；原失败历史保留', 'facts': [progress],
                'evidence': [progress['satisfied_by_task_id'], progress['satisfied_by_run_id']],
                'title': demand.get('title') or '手机持续巡查需求', 'verdict': 'completed',
                'done': ['凭规范Run、退出码0及完整巡查证据结清原需求，失败历史保留'], 'not_done': [],
                'artifacts': {'pr_urls': [], 'sprint_dir': None, 'branch': None, 'docs': ['scripts/phone-account-patrol/RUNBOOK.md']},
                'data_sources': ['Brain tasks/' + progress['satisfied_by_task_id'], 'Brain task_runs/' + progress['satisfied_by_run_id']],
                'decision_refs': [], 'initiative_id': demand.get('initiative_id'), 'journey_id': demand.get('journey_id'),
                'created_at': progress['last_checked_at'], 'next_steps': [{'kind': 'note', 'title': '需求已满足，无下一步'}]}
    call('tasks/' + demand['id'], body, 'PATCH')
    fresh = read_task(call, demand['id'])
    if (fresh.get('payload') != demand.get('payload') or (fresh.get('result') or {}).get('recovery') != progress
            or status and fresh.get('status') != status):
        raise ValueError('需求进度没有真正写入中央 result')
    if status == 'completed_no_pr':
        handoff = (fresh.get('result') or {}).get('handoff') or {}
        if handoff.get('synthesized') is True or handoff.get('next_steps') != body['result']['handoff']['next_steps']:
            raise ValueError('中央完成handoff未保留真实交接，禁止宣称结清')
    return fresh


def ensure_task(call, deployment, body, matches):
    found = [t for t in task_rows(call, deployment['project_id']) if matches(t)]
    if len(found) > 1:
        raise ValueError('中央同一需求或generation存在重复，停止派发')
    if found:
        return found[0]
    try:
        created = call('tasks', body)
        created = created.get('task', created)
        task = read_task(call, created.get('id'))
        if not matches(task):raise ValueError('新任务来源读回不一致')
        return task
    except Exception:
        # 服务端可能已提交而HTTP回执丢失；重新查真实身份，不能盲重POST。
        found = [t for t in task_rows(call, deployment['project_id']) if matches(t)]
        if len(found) == 1:return found[0]
        raise


def formal_phones(tasks, schedule, deployment):
    activated = timestamp((schedule.get('template') or {}).get('activated_at') or schedule.get('created_at'))
    command = '/usr/bin/python3 ' + shlex.quote(str(pathlib.Path(deployment['release']) / 'runner.py')) + ' batch --execution-script "$0"'
    by_id = {t['id']: t for t in tasks};by_parent = {};phones = []
    for t in tasks:by_parent.setdefault(t.get('parent_task_id'), []).append(t)
    for batch in tasks:
        if phone_revision(batch, deployment) not in [None, deployment['source_revision']]:continue
        p = batch.get('payload') or {}
        if p.get('recurring_task_id') != deployment['schedule_id'] or p.get('workflow_id') != deployment['batch_workflow_id']:
            continue
        if batch.get('task_type') == 'qiumi_task':
            route = p.get('qiumi_route')
            if (batch.get('project_id') != deployment['project_id'] or p.get('qiumi_department') != 'infra'
                    or not isinstance(route, dict) or route.get('source') != 'explicit'
                    or p.get('phone_source_revision') != deployment['source_revision'] or p.get('runtime_requires_llm') is not True
                    or not re.fullmatch(r'[0-9a-f]{40}', p.get('source_revision') or '')):
                raise ValueError('正式infra编排记录身份不一致')
            continue
        slot = timestamp(p.get('recurring_slot'));local = slot.astimezone(zoneinfo.ZoneInfo('Asia/Shanghai'))
        if timestamp(batch['created_at']) < activated or (local.hour, local.minute, local.second, local.microsecond) != (22, 0, 0, 0):continue
        if batch.get('task_type') != 'script_run' or p.get('source_revision') != deployment['source_revision'] or p.get('cmd') != command or p.get('runtime_requires_llm') is not False:
            raise ValueError('正式批次固定源身份不一致')
        parent = by_id.get(batch.get('parent_task_id'))
        if batch.get('parent_task_id') and (not parent or parent.get('task_type') != 'qiumi_task' or (parent.get('payload') or {}).get('qiumi_department') != 'infra'):
            raise ValueError('现代正式批次领跑者身份不一致')
        # 老正式纯代码批次允许无qiumi父；未登记完批次仍由原monitor如实记等待/失败。
        for task in by_parent.get(batch['id'], []):
            tp = task.get('payload') or {}
            if task.get('parent_task_id') != batch['id'] or tp.get('workflow_id') != deployment['single_workflow_id']:continue
            verify_children({'status': 'queued', 'task_id': batch['id'], 'source_revision': deployment['source_revision'],
                             'children': [{'task_id': task['id'], 'serial': tp.get('phone_serial')}]}, batch['id'], deployment,
                            lambda path: by_id[path.split('/')[1]], current_phones=False)
            phones.append((batch, task))
    return phones


def failed_runs(task):
    script = (task.get('result') or {}).get('script') or {};candidates = [script]
    candidates += (task.get('payload') or {}).get('script_attempts', [])
    candidates += (task.get('result') or {}).get('script_attempts', [])
    return {x['run_id'] for x in candidates if isinstance(x, dict) and type(x.get('exit_code')) is int and x['exit_code'] != 0
            and re.fullmatch('script-' + re.escape(task['id']) + '-a[1-9][0-9]*', x.get('run_id') or '')}


def recovery_snapshots(tasks):
    return [{'demand_task_id': t['id'], 'status': t['status'], 'phone_serial': t['payload'].get('phone_serial'),
             'origin_task_id': t['payload'].get('origin_task_id'), 'recovery': (t.get('result') or {}).get('recovery', {})}
            for t in tasks if (t.get('payload') or {}).get('recovery_demand')]


def recover(call, deployment, current, wrapper_path, control_hash, control_revision):
    tasks = task_rows(call, deployment['project_id'])
    for task in tasks:phone_revision(task, deployment)
    schedules = call('recurring-tasks')
    schedules = schedules if isinstance(schedules, list) else schedules.get('recurring_tasks', schedules.get('data'))
    matches = [s for s in schedules if s['id'] == deployment['schedule_id']]
    if len(matches) != 1:raise ValueError('正式巡查计划没有唯一读回')
    schedule = matches[0];covered = []
    for batch, origin in formal_phones(tasks, schedule, deployment):
        serial = origin['payload']['phone_serial']
        existing = [t for t in tasks if (t.get('payload') or {}).get('recovery_demand') and t['payload'].get('origin_task_id') == origin['id']]
        if existing:continue
        by_id = {t['id']: t for t in tasks}
        proof = next((p for t in tasks if (t.get('payload') or {}).get('phone_serial') == serial
                      for p in [phone_completion(t, serial, deployment, origin['created_at'], by_id, current, wrapper_path)] if p), None)
        if proof:
            covered.append(dict(proof, origin_task_id=origin['id'], original_slot=batch['payload']['recurring_slot']));continue
        scope = {'origin_task_id': origin['id'], 'origin_batch_task_id': batch['id'], 'original_schedule_id': deployment['schedule_id'],
                 'original_slot': batch['payload']['recurring_slot'], 'phone_serial': serial, 'phone_source_revision': deployment['source_revision']}
        body = {'title': '手机巡查待恢复 · ' + serial + ' · ' + scope['original_slot'], 'task_type': 'project', 'status': 'blocked',
                'blocked_reason': 'waiting_phone_recovery', 'parent_task_id': origin['id'], 'project_id': deployment['project_id'],
                'source_id': 'phone-account-patrol:recovery-demand:' + origin['id'], 'payload': {**scope, 'recovery_demand': True,
                'workflow_id': MAINTENANCE_WORKFLOW_ID, 'maintenance_owner': '主理人', 'commander': 'OpenClaw:infra',
                'runtime_requires_llm': False, 'headed_manual': True}}
        ensure_task(call, deployment, body, lambda t, origin=origin: (t.get('payload') or {}).get('recovery_demand') is True and t['payload'].get('origin_task_id') == origin['id'])
    tasks = task_rows(call, deployment['project_id']);phones = call('phone-registry')['phones']
    for candidate in [t for t in tasks if (t.get('payload') or {}).get('recovery_demand') and phone_revision(t, deployment) == deployment['source_revision']]:
        demand = read_task(call, candidate['id']);scope = demand_scope(demand, deployment)
        if demand['status'] in CLOSED:continue
        if demand['status'] != 'blocked' or demand.get('blocked_until') is not None:raise ValueError('需求必须持久blocked，禁止自动派发或TTL解锁')
        origin = read_task(call, scope['origin_task_id']);batch = read_task(call, scope['origin_batch_task_id'])
        if (origin.get('parent_task_id') != batch['id'] or origin['payload'].get('phone_serial') != scope['phone_serial']
                or phone_revision(origin, deployment) != deployment['source_revision'] or phone_revision(batch, deployment) != deployment['source_revision']
                or batch['payload'].get('recurring_task_id') != scope['original_schedule_id'] or batch['payload'].get('recurring_slot') != scope['original_slot']):
            raise ValueError('需求原始范围已变化')
        tasks = task_rows(call, deployment['project_id']);by_id = {t['id']: t for t in tasks}
        attempts = [t for t in tasks if t.get('task_type') == 'script_run' and (t.get('payload') or {}).get('recovery_demand_id') == demand['id']]
        for attempt in attempts:
            p = attempt['payload']
            if (attempt.get('parent_task_id') != demand['id'] or p.get('original_scope') != scope or p.get('source_revision') != deployment['source_revision']
                    or p.get('phone_serial') != scope['phone_serial'] or p.get('workflow_id') != deployment['single_workflow_id']
                    or type(p.get('recovery_generation')) is not int or p['recovery_generation'] < 1):raise ValueError('补查尝试固定身份不一致')
        progress = dict((demand.get('result') or {}).get('recovery') or {})
        progress.update(actor='OpenClaw:infra', last_checked_at=current.isoformat(), old_failure_history_preserved=True)
        proofs = [(t, phone_completion(t, scope['phone_serial'], deployment, origin['created_at'], by_id, current, wrapper_path)) for t in tasks]
        proofs = [(t, p) for t, p in proofs if p]
        if proofs:
            task, _ = min(proofs, key=lambda item: timestamp(item[1]['checked_at']))
            proof = phone_completion(read_task(call, task['id']), scope['phone_serial'], deployment, origin['created_at'], by_id, current, wrapper_path)
            if not proof:raise ValueError('真实完成证据在读回期间改变')
            source_parent = by_id.get(task.get('parent_task_id'), {})
            progress.update(proof, phase='completed', satisfaction_kind='recovery_attempt' if task in attempts else 'subsequent_phone_success',
                            satisfied_by_slot=(task.get('payload') or {}).get('original_slot') or (source_parent.get('payload') or {}).get('recurring_slot'))
            patch_recovery(call, demand, progress, 'completed_no_pr');continue
        failures = set(progress.get('failed_runs', [])) | failed_runs(origin)
        for attempt in attempts:failures |= failed_runs(attempt)
        progress.update(failed_runs=sorted(failures), failure_count=len(failures), attempts=[{'task_id': t['id'], 'generation': t['payload']['recovery_generation'],
                        'status': t['status'], 'run_id': ((t.get('result') or {}).get('script') or {}).get('run_id'),
                        'exit_code': ((t.get('result') or {}).get('script') or {}).get('exit_code')} for t in attempts])
        registered = [p for p in phones if p.get('serial') == scope['phone_serial']]
        permanent = len(registered) != 1 or registered[0].get('host') != 'xian-m4'
        historical_error = any(t['status'] == 'blocked' or (business_receipt(t) or {}).get('reason') == 'recovery_identity_mismatch' for t in attempts)
        if permanent or historical_error or len(failures) >= 3:
            attention = ensure_task(call, deployment, {'title': '手机持续巡查需主理人处理 · ' + scope['phone_serial'] + ' · ' + demand['id'], 'task_type': 'project', 'status': 'blocked',
                'blocked_reason': 'manual_phone_recovery_attention', 'project_id': deployment['project_id'], 'parent_task_id': demand['id'],
                'source_id': 'phone-account-patrol:recovery-attention:' + demand['id'], 'payload': {'recovery_attention': True,
                'recovery_demand_id': demand['id'], 'headed_manual': True, 'maintenance_owner': '主理人', 'commander': 'OpenClaw:infra', 'runtime_requires_llm': False}},
                lambda t: (t.get('payload') or {}).get('recovery_attention') is True and t['payload'].get('recovery_demand_id') == demand['id'])
            progress['attention_task_id'] = attention['id']
        generation = max((t['payload']['recovery_generation'] for t in attempts), default=0)
        active = [t for t in tasks if t.get('task_type') == 'script_run' and (t.get('payload') or {}).get('phone_serial') == scope['phone_serial'] and t['status'] in ACTIVE]
        if permanent:progress['phase'] = 'needs_maintenance'
        elif not schedule.get('is_active'):progress['phase'] = 'schedule_paused'
        elif not registered[0].get('enabled'):progress['phase'] = 'device_disabled'
        elif active:progress['phase'] = 'waiting_device'
        else:
            latest = max(attempts, key=lambda t: t['payload']['recovery_generation']) if attempts else None
            if latest and progress.get('observed_generation') != generation:
                minutes = [15, 30, 60][min(generation - 1, 2)]
                finished = timestamp(latest.get('completed_at') or latest.get('updated_at') or current.isoformat())
                progress.update(observed_generation=generation, next_attempt_at=(finished + dt.timedelta(minutes=minutes)).isoformat())
            if progress.get('next_attempt_at') and timestamp(progress['next_attempt_at']) > current:progress['phase'] = 'backoff'
            else:
                generation += 1
                command = '/usr/bin/python3 ' + shlex.quote(str(wrapper_path)) + ' recovery-phone --demand-task-id ' + demand['id'] + ' --serial ' + shlex.quote(scope['phone_serial']) + ' --execution-script "$0"'
                body = {'title': '手机持续补查 · ' + scope['phone_serial'] + ' · ' + demand['id'] + ' · ' + str(generation), 'task_type': 'script_run', 'priority': 'P2',
                    'project_id': deployment['project_id'], 'parent_task_id': demand['id'], 'source_id': 'phone-account-patrol:recovery-attempt:' + demand['id'] + ':' + str(generation),
                    'payload': {'host': 'mmv', 'cmd': command, 'timeout_sec': 1500, 'workflow_id': deployment['single_workflow_id'],
                    'source_revision': deployment['source_revision'], 'phone_serial': scope['phone_serial'], 'runtime_requires_llm': False, 'multi_task': True, 'depends_on': [],
                    'recovery_demand_id': demand['id'], 'recovery_generation': generation, 'original_scope': scope, 'control_sha256': control_hash, 'control_source_revision': control_revision,
                    'original_schedule_id': scope['original_schedule_id'], 'original_slot': scope['original_slot']}}
                attempt = ensure_task(call, deployment, body, lambda t, generation=generation: (t.get('payload') or {}).get('recovery_demand_id') == demand['id']
                                      and t['payload'].get('recovery_generation') == generation and t.get('task_type') == 'script_run')
                progress.update(phase='waiting_attempt', generation=generation, active_attempt_task_id=attempt['id'])
        patch_recovery(call, demand, progress)
    return {'demands': recovery_snapshots([t for t in task_rows(call, deployment['project_id'])
            if (t.get('payload') or {}).get('recovery_demand') and phone_revision(t, deployment) == deployment['source_revision']]), 'covered_originals': covered}
