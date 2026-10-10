#!/usr/bin/env python3
"""中央 script_run 的代码入口；没有本机定时器，也不调用大模型。"""
import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import shlex
import subprocess
import sys
import urllib.parse
import urllib.request
import zoneinfo

ROOT = pathlib.Path(__file__).resolve().parent
STATE = pathlib.Path.home() / '.local/share/phone-account-patrol'
API = 'http://localhost:5221/api/brain/'
PLATFORMS = ['抖音', '小红书', '微信', '快手', '今日头条', '知乎', '微博', 'B站']
ALL_PLATFORMS = PLATFORMS + ['视频号']
SSH = ['/usr/bin/ssh', '-o', 'BatchMode=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2']


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def api(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def rows(value):
    if isinstance(value, list):
        return value
    for key in ['tasks', 'recurring_tasks', 'data']:
        if isinstance(value.get(key), list):
            return value[key]
    raise ValueError('API 未返回完整记录列表')


def task_from_script(path):
    match = re.fullmatch(r'script-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})-a([1-9][0-9]*)\.sh', pathlib.Path(path).name)
    if not match:
        raise ValueError('入口缺少中央 script_run 的真实任务身份')
    return match.group(1)


def save(name, value):
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = STATE / name
    temporary = target.with_suffix(target.suffix + '.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        os.chmod(temporary, 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
    temporary.replace(target)
    return str(target)


def manifest():
    value = json.loads((ROOT / 'deployment.json').read_text())
    for name, digest in value['sha256'].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest:
            raise ValueError('部署文件版本不一致：' + name)
    return value


def enqueue_batch(call, task_id, root, workflow_id, revision, project_id=None):
    phones = call('phone-registry')['phones']
    children = []
    for phone in phones:
        if not phone.get('enabled'):
            continue
        serial = phone['serial']
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', serial):
            raise ValueError('设备登记标识非法')
        command = '/usr/bin/python3 ' + shlex.quote(str(root / 'runner.py')) + ' phone --serial ' + shlex.quote(serial) + ' --execution-script "$0"'
        # source_id 是服务端登记幂等键，不依赖不受支持的列表过滤或本机缓存。
        child = call('tasks', {'title': '账号巡查 · ' + phone.get('nickname', serial) + ' · ' + task_id,
                              'description': '单手机八平台＋视频号；只检查当前账号，不切换账号。维护负责人：主理人。',
                              'source_id': 'phone-account-patrol:' + task_id + ':' + serial,
                              'task_type': 'script_run', 'priority': 'P2', 'project_id': project_id, 'parent_task_id': task_id, 'sequence_no': len(children) + 1,
                              'payload': {'host': 'mmv', 'cmd': command, 'timeout_sec': 1200, 'workflow_id': workflow_id,
                                          'phone_serial': serial, 'source_revision': revision, 'runtime_requires_llm': False, 'multi_task': True, 'depends_on': [],
                                          'artifact_paths': [str(STATE / ('phone-' + serial + '.latest.json'))]}})
        children.append({'phone': phone.get('nickname', serial), 'serial': serial, 'task_id': child['id']})
    if not children:
        raise ValueError('设备清单没有已启用的手机')
    return {'status': 'queued', 'task_id': task_id, 'children': children, 'actor': 'phone-account-patrol', 'source_revision': revision,
            'facts': '批次已登记手机子任务；手机巡查结果以各子运行记录为准'}


def validate_observation(observation, serial):
    if observation.get('serial') != serial:
        raise ValueError('巡查结果设备标识不匹配')
    results = observation.get('results', {})
    if any(p not in results or results[p].get('state') not in ['已登录', '未登录', '未安装', '待确认', '占用未查', '离线未查', '检测失败'] for p in ALL_PLATFORMS):
        raise ValueError('巡查结果不完整或状态非法')


def outcome(results):
    states = {r['state'] for r in results.values()}
    if states.intersection({'检测失败', '离线未查'}):
        return 'failed', 1
    if '占用未查' in states:
        return 'deferred', 0
    return 'completed', 0


def ssh(host, command, *, input=None, timeout=60):
    if host not in ['xian-m4', 'xian-m1', 'us-vps']:
        raise ValueError('设备宿主尚无验收过的连接配置')
    extra = ['-o', 'ProxyJump=none', '-o', 'ProxyCommand=none'] if host.startswith('xian-') else []
    result = subprocess.run(SSH + extra + [host, command], input=input, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('远端步骤失败：' + host + '，退出码 ' + str(result.returncode))
    return result.stdout


def phone_run(serial, task_id, deployment):
    phones = api('phone-registry')['phones']
    selected = [p for p in phones if p['serial'] == serial and p.get('enabled')]
    if len(selected) != 1:
        raise ValueError('设备未登记、未启用或标识重复')
    phone = selected[0]
    if phone['host'] != 'xian-m4':
        raise ValueError('当前部署仅验收 M4；设备迁移后应重新部署验收')
    runid = 'central-' + task_id
    remote = deployment['remote_release']
    # 检查同版本依赖、ADB和OCR；不进入应用、不获取或抢占设备锁。
    check = json.loads(ssh(phone['host'], '/opt/homebrew/bin/python3 ' + shlex.quote(remote + '/preflight.py') + ' --serial ' + shlex.quote(serial)))
    save('phone-' + serial + '.preflight.json', check)
    if not check.get('ok'):
        raise RuntimeError('设备运行前自检失败；详见 preflight 证据')
    command = '/opt/homebrew/bin/python3 ' + shlex.quote(remote + '/dispatch.py') + ' ' + shlex.quote(serial) + ' ' + shlex.quote(phone['profile']) + ' ' + shlex.quote(runid)
    output = ssh(phone['host'], command, timeout=650)
    candidates = [json.loads(line) for line in output.splitlines() if line.startswith('{') and '"results"' in line]
    if not candidates:
        raise RuntimeError('巡查没有返回有效结果')
    observation = candidates[-1]
    validate_observation(observation, serial)
    observation_path = save(task_id + '.observation.json', observation)
    incoming = {'task_id': task_id, 'actor': 'phone-account-patrol', 'checked_at': now(), 'schedule': '每天22:00（Asia/Shanghai）',
                'phones': {phone['nickname']: observation}}
    source = (ROOT / 'publish.mjs').read_text().replace('__INPUT__', json.dumps(incoming, ensure_ascii=False))
    output = ssh('us-vps', 'docker exec -i -w /app cecelia-node-brain node --input-type=module', input=source, timeout=200)
    reports = [json.loads(line) for line in output.splitlines() if line.startswith('{') and '"published"' in line]
    if not reports or len(reports[-1]['published']) != 1:
        raise RuntimeError('账号台账写回缺少确认回执')
    publish_path = save(task_id + '.publish.json', reports[-1])
    mirror = subprocess.run(['/usr/bin/python3', str(STATE.parent / 'phone-task-view/run.py')], capture_output=True, text=True, timeout=450)
    if mirror.returncode:
        raise RuntimeError('台账已写回，设备页面镜子更新失败')
    status, code = outcome(observation['results'])
    receipt = {'status': status, 'task_id': task_id, 'phone': phone['nickname'], 'serial': serial, 'checked_at': now(),
               'workflow_id': deployment['single_workflow_id'], 'source_revision': deployment['source_revision'],
               'states': {p: observation['results'][p]['state'] for p in ALL_PLATFORMS},
               'evidence': [observation_path, publish_path, phone['host'] + ':' + str(pathlib.PurePosixPath('~/.local/share/phone-account-patrol/evidence') / runid)],
               'actor': 'phone-account-patrol', 'maintenance_owner': '主理人'}
    save('phone-' + serial + '.latest.json', receipt)
    print(json.dumps(receipt, ensure_ascii=False))
    return code


def schedule_health(schedule, tasks, current):
    if not schedule.get('is_active'):
        return {'status': 'disabled'}
    current = dt.datetime.fromisoformat(current).astimezone(zoneinfo.ZoneInfo('Asia/Shanghai'))
    expected = current.replace(hour=22, minute=0, second=0, microsecond=0)
    if current < expected + dt.timedelta(minutes=30):
        expected -= dt.timedelta(days=1)
    # 刚启用的配置不追责过去不存在的巡查。
    if schedule.get('created_at') and dt.datetime.fromisoformat(schedule['created_at']).astimezone(expected.tzinfo) > expected:
        return {'status': 'awaiting_first_run', 'expected_at': expected.isoformat()}
    matches = [t for t in tasks if t.get('recurring_task_id') == schedule['id'] and dt.datetime.fromisoformat(t['created_at']) >= expected]
    if not matches:
        return {'status': 'missed', 'expected_at': expected.isoformat()}
    if any(t['status'] == 'failed' for t in matches):
        return {'status': 'failed', 'expected_at': expected.isoformat()}
    return {'status': 'healthy', 'expected_at': expected.isoformat()}


def monitor(deployment):
    schedules = rows(api('recurring-tasks'))
    schedule = next(s for s in schedules if s['id'] == deployment['schedule_id'])
    tasks = []
    if schedule.get('last_run_at'):
        tasks.append({'recurring_task_id': schedule['id'], 'created_at': schedule['last_run_at'], 'status': schedule.get('last_run_status') or 'queued'})
    health = schedule_health(schedule, tasks, now())
    failed = []
    for file in STATE.glob('phone-*.latest.json'):
        latest = json.loads(file.read_text())
        if latest.get('task_id'):
            task = api('tasks/' + latest['task_id'])
            if task.get('status') == 'failed':
                failed.append(task)
    health['failed_task_ids'] = [t['id'] for t in failed]
    key = json.dumps({'status': health['status'], 'expected_at': health.get('expected_at') if health['status'] == 'missed' else None,
                      'failed': sorted(health['failed_task_ids'])}, sort_keys=True)
    marker = STATE / 'monitor.latest.json'
    previous = json.loads(marker.read_text()) if marker.exists() else {}
    if (health['status'] in ['missed', 'failed'] or failed) and previous.get('anomaly_key') != key:
        issue = api('tasks', {'title': '账号巡查异常：漏跑或执行失败', 'task_type': 'research', 'priority': 'P1', 'lane': '待分拣',
                             'description': '维护负责人：主理人。请查看关联失败运行；此任务仅记账，不自动调用AI修复。',
                             'payload': {'headed_manual': True, 'source': 'phone-account-patrol-monitor', 'health': health}})
        health['attention_task_id'] = issue['id']
    health.update({'checked_at': now(), 'anomaly_key': key, 'maintenance_owner': '主理人'})
    save('monitor.latest.json', health)
    print(json.dumps(health, ensure_ascii=False))
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['batch', 'phone', 'monitor', 'self-check'])
    parser.add_argument('--serial')
    parser.add_argument('--execution-script')
    parser.add_argument('--task-id')
    args = parser.parse_args()
    deployment = manifest()
    if args.mode == 'self-check':
        print(json.dumps({'ok': True, 'source_revision': deployment['source_revision'], 'schedule': '22:00 Asia/Shanghai', 'maintenance_owner': '主理人'}))
        return 0
    if args.mode == 'monitor':
        return monitor(deployment)
    task_id = args.task_id or task_from_script(args.execution_script or '')
    if args.mode == 'batch':
        receipt = enqueue_batch(api, task_id, ROOT, deployment['single_workflow_id'], deployment['source_revision'], deployment['project_id'])
        save('batch-' + task_id + '.json', receipt)
        print(json.dumps(receipt, ensure_ascii=False))
        return 0
    if not args.serial:
        raise ValueError('单手机流程必须明确设备标识')
    save('phone-' + args.serial + '.latest.json', {'status': 'in_progress', 'task_id': task_id, 'serial': args.serial, 'started_at': now()})
    return phone_run(args.serial, task_id, deployment)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'status': 'failed', 'actor': 'phone-account-patrol', 'error': str(error)[:300]}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
