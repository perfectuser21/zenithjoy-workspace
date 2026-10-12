#!/usr/bin/env python3
"""OpenClaw infra 领跑桥：AI 负责派发/复核，冻结 Python 负责手机巡查。"""
import argparse
import datetime as dt
import zoneinfo
import hashlib
import json
import os
import pathlib
import re
import shlex
import subprocess
import sys
import urllib.request

STATE = pathlib.Path.home() / '.local/share/phone-account-patrol'
API = 'http://localhost:5221/api/brain/'
PHONE_SOURCE_REVISION = '4f899cab6425341646e27c5fca20979b8ac42be7'
SOURCE_VERSION = '0.1.0'
EXPECTED_SHA256 = {
    'runner.py': '26c5e6dc065b42f8298e485aca2492f25eb83b8a9650409ca3dc33b51798b9ce',
    'collector.py': '501dd4af5358676473201ecbf8c3712db682e9a17128d52e3565021a3cb521f3',
    'dispatch.py': 'ea60ff9e538aa77f991d5f234d47cb392a2613ead560c0963d5949d53a1694de',
    'preflight.py': 'a2874821f56add3ab2e80e5ded7510d2df0b4f2bbf09b87fc63a755b59918ce0',
    'publish.mjs': '528daa587ceba84348723fbf24a7169645462a71a1378407910ed0d2b5daf6bf',
    'ocr.swift': '89431efae1526a56b9e5164cee7293f4ea877f6d4ca61f1b76b05f48d3291005',
    'SKILL.md': 'ee99dc331f8aec05c1071260dcfb06197c4add7d74b5160ea3084b5b8b5e6dde',
    'mirror.mjs': 'a628a9406528a24de126a9cafdc63c17a9f9f8e0d82d1b2dd41a94a3efc8ebb0',
}
UUID = r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}'


def uuid(value):
    if not isinstance(value, str) or not re.fullmatch(UUID, value):
        raise ValueError('任务或流程身份不是完整 UUID')
    return value


def task_from_script(value):
    path = pathlib.Path(value)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('入口必须是中央 script_run 的绝对脚本路径')
    match = re.fullmatch(r'script-(' + UUID + r')-a[1-9][0-9]*\.sh', path.name)
    if not match:
        raise ValueError('入口缺少中央 script_run 的真实任务身份')
    return match.group(1)


def api(path):
    with urllib.request.urlopen(API + path, timeout=30) as response:
        return json.load(response)


def save(state, name, value):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = state / (name + '.tmp')
    # 私有目录中原子替换，旧日志不会作为下一次运行的证据。
    fd = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
    target = state / name
    temporary.replace(target)
    return target


def load_deployment(state):
    pointer = json.loads((state / 'deployment-current.json').read_text())
    expected = state / 'releases' / PHONE_SOURCE_REVISION
    release = pathlib.Path(pointer.get('release', ''))
    if pointer.get('source_revision') != PHONE_SOURCE_REVISION or release != expected or release.is_symlink():
        raise ValueError('部署指针没有指向已验收的冻结手机代码')
    for key in ['single_workflow_id', 'batch_workflow_id', 'project_id', 'schedule_id']:
        uuid(pointer.get(key))
    manifest = json.loads((release / 'deployment.json').read_text())
    if pointer.get('sha256') != EXPECTED_SHA256 or manifest.get('sha256') != EXPECTED_SHA256:
        raise ValueError('部署文件清单不是已验收版本')
    for key in ['source_revision', 'single_workflow_id', 'batch_workflow_id', 'project_id', 'schedule_id']:
        if manifest.get(key) != pointer[key]:
            raise ValueError('部署指针与冻结 manifest 不一致')
    for name, digest in EXPECTED_SHA256.items():
        path = release / name
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('冻结代码指纹不一致：' + name)
    return pointer


def read_task(call, task_id):
    value = call('tasks/' + uuid(task_id))
    if isinstance(value, dict) and isinstance(value.get('task'), dict):
        value = value['task']
    if not isinstance(value, dict) or value.get('id') != task_id:
        raise ValueError('中央任务读回身份不一致')
    return value


def verify_children(receipt, task_id, deployment, call, *, current_phones=True):
    if not isinstance(receipt, dict) or receipt.get('task_id') != task_id or receipt.get('source_revision') != PHONE_SOURCE_REVISION:
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
                or task.get('source_id') != 'phone-account-patrol:' + task_id + ':' + serial
                or payload.get('workflow_id') != deployment['single_workflow_id']
                or payload.get('source_revision') != PHONE_SOURCE_REVISION or payload.get('phone_serial') != serial):
            raise ValueError('中央子任务与冻结巡查合同不一致')
        children.append(task)
    if current_phones:
        enabled = [p['serial'] for p in call('phone-registry')['phones'] if p.get('enabled')]
        if len(enabled) != len(set(enabled)) or seen_serials != set(enabled):
            raise ValueError('派发手机集合与当前启用清单不一致')
    return children


def run_gateway(task_id, mode, message):
    session_key = 'agent:infra:phone-patrol:' + task_id + ':' + mode
    command = ['/opt/homebrew/bin/openclaw', 'agent', '--agent', 'infra', '--session-key', session_key,
               '--message', json.dumps(message, ensure_ascii=False), '--timeout', '300', '--json']
    result = subprocess.run(command, capture_output=True, text=True, timeout=320)
    if result.returncode:
        # 不记录 stderr/stdout 中可能携带的凭据和系统提示。
        raise RuntimeError('gateway_exit_' + str(result.returncode))
    try:
        envelope = json.loads(result.stdout)
    except (ValueError, TypeError):
        raise ValueError('Gateway 没有返回真实 JSON 运行回执')
    if not isinstance(envelope, dict) or envelope.get('status') not in ['success', 'ok']:
        raise ValueError('Gateway 运行没有成功结束')
    run_id = envelope.get('runId')
    meta = (envelope.get('result') or {}).get('meta') or {}
    agent = meta.get('agentMeta') or {}
    terminal = agent.get('terminalReceipt') or {}
    session_id = agent.get('sessionId')
    if (not isinstance(run_id, str) or not run_id.strip() or meta.get('aborted') is not False
            or not isinstance(session_id, str) or not session_id.strip()
            or terminal.get('runId') != run_id or terminal.get('sessionId') != session_id
            or 'gateway_exec' not in terminal.get('successfulToolNames', [])):
        raise ValueError('Gateway 缺少同一运行的真实 MMV 工具终态凭证')
    return {'agent_id': 'infra', 'openclaw_run_id': run_id, 'session_key': session_key,
            'session_id': session_id, 'source_version': SOURCE_VERSION,
            'source_sha256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}


def restrictions():
    return ['必须使用 gateway_exec 的 MMV 实际工具执行指定命令，并检查退出码与 JSON 回执。',
            '不得直接操作手机，不得绕过原生设备锁；不登录、不切换账号、不发布、不发外部消息。',
            '不得修改生产配置、代码、部署指针或人工处理异常；失败如实报告。',
            '工具调用不可用时立即失败，禁止用文字回执代替执行。']


def launch(task_id, deployment, state, call=None):
    call = call or api
    uuid(task_id)
    task = read_task(call, task_id)
    if (task.get('task_type') != 'script_run' or task.get('status') != 'in_progress'
            or task.get('project_id') != deployment['project_id']
            or (task.get('payload') or {}).get('workflow_id') != deployment['batch_workflow_id']
            or (task.get('payload') or {}).get('phone_source_revision') != PHONE_SOURCE_REVISION
            or not re.fullmatch(r'[0-9a-f]{40}', (task.get('payload') or {}).get('source_revision', ''))):
        raise ValueError('入口不是正在执行的中央批次任务')
    command = '/usr/bin/python3 ' + shlex.quote(str(pathlib.Path(deployment['release']) / 'runner.py')) + ' batch --task-id ' + task_id
    message = {'任务': '派发四手机账号巡查，完成派发后立即返回，不等待手机巡查终态', 'mode': 'launch', 'task_id': task_id,
               'source_revision': PHONE_SOURCE_REVISION, 'command': command,
               '规则': restrictions() + ['可重试同一 task_id 的幂等批次命令；只由冻结代码登记手机子任务。'],
               '验收': '实际 batch-' + task_id + '.json 及中央每个孩子的身份、来源、手机与版本读回一致。'}
    commander = run_gateway(task_id, 'launch', message)
    receipt = json.loads((state / ('batch-' + task_id + '.json')).read_text())
    verify_children(receipt, task_id, deployment, call)
    # 每次调用都必须先有新的 Gateway 成功凭证。已有幂等批次回执可复用，但再次核验真实中央孩子。
    receipt = dict(receipt, commander=commander)
    save(state, 'commander-' + task_id + '.launch.json', receipt)
    save(state, 'openclaw-commander.latest.json', dict(receipt, verified=True))
    return receipt


def resolve_batch(batch_task_id, deployment, state, call=None, current=None):
    call = call or api
    if batch_task_id is not None:
        return uuid(batch_task_id)
    try:
        latest = json.loads((state / 'openclaw-commander.latest.json').read_text())
        if latest.get('verified') is not True or not (latest.get('commander') or {}).get('openclaw_run_id'):
            raise ValueError('missing_launch')
        task_id = uuid(latest.get('task_id'))
        batch = read_task(call, task_id)
        payload = batch.get('payload') or {}
        if payload.get('recurring_task_id') != deployment['schedule_id']:
            raise ValueError('missing_launch')
        raw = payload.get('recurring_slot', '')
        slot = dt.datetime.fromisoformat(raw[:-1] + '+00:00' if raw.endswith('Z') else raw)
        if slot.tzinfo is None:
            raise ValueError('missing_launch')
        local = slot.astimezone(zoneinfo.ZoneInfo('Asia/Shanghai'))
        today = (current or dt.datetime.now(dt.timezone.utc)).astimezone(local.tzinfo).date()
        if local.date() != today or (local.hour, local.minute, local.second, local.microsecond) != (22, 0, 0, 0):
            raise ValueError('missing_launch')
        return task_id
    except (OSError, KeyError, TypeError, ValueError):
        raise ValueError('missing_launch')


def inspection(batch_task_id, review_task_id, deployment, state, call=None, *, persist=True):
    """仅供 infra 通过 MMV 工具读中央真实状态；不登记、不重跑、不操作手机。"""
    call = call or api
    batch = read_task(call, batch_task_id)
    payload = batch.get('payload') or {}
    if (payload.get('workflow_id') != deployment['batch_workflow_id']
            or batch.get('project_id') != deployment['project_id']
            or payload.get('phone_source_revision') != PHONE_SOURCE_REVISION
            or not re.fullmatch(r'[0-9a-f]{40}', payload.get('source_revision', ''))):
        raise ValueError('指定对象不是正式巡查批次')
    # 父 stdout 含领跑回执；不能把任何普通 AI 文本解析成它。
    receipt = None
    for line in reversed((batch.get('result') or {}).get('script', {}).get('stdout', '').splitlines()):
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict) and value.get('task_id') == batch_task_id and 'children' in value:
            receipt = value
            break
    if receipt is None:
        raise ValueError('批次尚无派发结果，不能生成复核终态')
    children = verify_children(receipt, batch_task_id, deployment, call, current_phones=False)
    snapshot = {'status': 'reviewed', 'task_id': uuid(review_task_id), 'batch_task_id': batch_task_id,
                'source_revision': PHONE_SOURCE_REVISION, 'batch_status': batch['status'], 'actor': 'OpenClaw:infra', 'children': []}
    for task in children:
        result = None
        for line in reversed((task.get('result') or {}).get('script', {}).get('stdout', '').splitlines()):
            try:
                candidate = json.loads(line)
            except ValueError:
                continue
            if isinstance(candidate, dict) and candidate.get('task_id') == task['id']:
                result = candidate
                break
        snapshot['children'].append({'task_id': task['id'], 'serial': task['payload']['phone_serial'], 'status': task['status'],
                                     'business_status': result.get('status') if result else 'unknown',
                                     'business_receipt': {k: result[k] for k in ['task_id', 'status', 'serial', 'phone', 'checked_at', 'states'] if k in result} if result else None,
                                     'run_id': (task.get('result') or {}).get('script', {}).get('run_id') or task['payload'].get('script_run_id'),
                                     'exit_code': (task.get('result') or {}).get('script', {}).get('exit_code')})
    if persist:
        save(state, 'review-' + review_task_id + '.json', snapshot)
    return snapshot


def review(task_id, batch_task_id, deployment, state, call=None):
    call = call or api
    parent = read_task(call, task_id)
    if parent.get('status') != 'in_progress' or parent.get('task_type') != 'script_run':
        raise ValueError('复核入口不是正在执行的中央任务')
    uuid(batch_task_id)
    command = '/usr/bin/python3 ' + shlex.quote(str(pathlib.Path(__file__).resolve())) + ' inspect --batch-task-id ' + batch_task_id + ' --review-task-id ' + task_id
    metadata = run_gateway(task_id, 'review', {'任务': '只读复核指定巡查批次及各手机状态，指出失败/占用/未确认，禁止补跑',
                    'mode': 'review', 'task_id': task_id, 'batch_task_id': batch_task_id, 'command': command, '规则': restrictions(),
                    '验收': '通过 MMV 工具执行 inspect，真实中央读回快照落盘后返回分析；没有完成的孩子明确列为等待。'})
    observed = json.loads((state / ('review-' + task_id + '.json')).read_text())
    # 二次独立读取中央任务进行对账；不相信 AI 自述。状态变化期间失败并在下一次复核重试。
    expected = inspection(batch_task_id, task_id, deployment, state, call, persist=False)
    if observed != expected:
        raise ValueError('复核快照与中央真实状态不一致')
    receipt = dict(expected, commander=metadata)
    save(state, 'commander-' + task_id + '.review.json', receipt)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['launch', 'review', 'inspect'])
    parser.add_argument('--execution-script')
    parser.add_argument('--batch-task-id')
    parser.add_argument('--review-task-id')
    args = parser.parse_args(argv)
    task_id = None
    try:
        deployment = load_deployment(STATE)
        if args.mode == 'inspect':
            receipt = inspection(uuid(args.batch_task_id), uuid(args.review_task_id), deployment, STATE)
        else:
            task_id = task_from_script(args.execution_script or '')
            if args.mode == 'launch':
                if args.batch_task_id or args.review_task_id:
                    raise ValueError('派发入口不接受外部批次或复核身份')
                receipt = launch(task_id, deployment, STATE)
            else:
                receipt = review(task_id, resolve_batch(args.batch_task_id, deployment, STATE), deployment, STATE)
        print(json.dumps(receipt, ensure_ascii=False))
        return 0
    except Exception as error:
        timeout = isinstance(error, subprocess.TimeoutExpired)
        receipt = {'status': 'unknown' if timeout else 'failed', 'task_id': task_id, 'mode': args.mode,
                   'reason': 'gateway_timeout' if timeout else ('missing_launch' if str(error) == 'missing_launch' else 'commander_validation_or_execution_failed'),
                   'error_type': type(error).__name__, 'gateway_cancelled': False,
                   'facts': '不能确认领跑者成功；已有手机子任务仍以各自中央运行记录为准。'}
        if task_id:
            save(STATE, 'commander-' + task_id + '.' + args.mode + '.json', receipt)
        print(json.dumps(receipt, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main())
