#!/usr/bin/env python3
"""通用Commander正式入口；同run不重发副作用，官方子会话等待与持久反馈。"""
import argparse
from datetime import datetime
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


io = module('wf-v2-io')
handoff = module('wf-agent-handoff')
phone_module = module('wf-v2-phone')


class CleanupPending(Exception):
    pass


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def run_directory(run):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', run):
        raise ValueError('invalid run id')
    return Path.home().resolve() / 'wf-agent-runs' / run


def validate(envelope, parent):
    if envelope.get('protocol') != io.PROTOCOL:
        raise ValueError('unsupported commander protocol')
    if not re.fullmatch(r'agent:work-commander:[A-Za-z0-9_.:/-]+', parent):
        raise ValueError('explicit Commander parent required')
    if not re.fullmatch(r'[0-9a-f-]{36}', envelope.get('task_id', '')):
        raise ValueError('invalid task identity')
    run_directory(envelope['run_id'])
    for name in ('attempt', 'owner_epoch'):
        if type(envelope.get(name)) is not int or envelope[name] < 1:
            raise ValueError('invalid ' + name)
    if not isinstance(envelope['contract'].get('resources', {}), dict):
        raise ValueError('resources must be an object')
    if envelope['contract'].get('execution_profile') != 'codex_agent':
        raise ValueError('unsupported execution profile')
    # Node与Brain采用同一JSON数值/UTF-16键排序语义（1e-7、补充平面字符也须一致）。
    digest_script = "const fs=require('fs'),c=require('crypto');const s=v=>Array.isArray(v)?v.map(s):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,s(v[k])])):v;process.stdout.write(c.createHash('sha256').update(JSON.stringify(s(JSON.parse(fs.readFileSync(0,'utf8'))))).digest('hex'));"
    input_hash = subprocess.run(['node', '-e', digest_script], input=json.dumps(envelope['input'], ensure_ascii=False),
                                text=True, capture_output=True, check=True, timeout=10).stdout
    if input_hash != envelope['input_sha256']:
        raise ValueError('input digest mismatch')
    if timestamp(envelope['cleanup_deadline_at']) < timestamp(envelope['deadline_at']):
        raise ValueError('cleanup deadline precedes execution')
    if len(io.canonical(envelope)) > 180000:
        raise ValueError('envelope too large')
    if envelope['contract'].get('resources'):
        phone_module.Phone(run_directory(envelope['run_id']), envelope)
    if 'method_selection' in envelope and not re.fullmatch(r'[a-f0-9]{64}', envelope['definition'].get('runtime_snapshot_sha256') or ''):
        raise ValueError('method launch requires frozen composition')
    io.ready(envelope)
    if 'method_selection' in envelope:
        module('wf-method').execution_context(envelope, run_directory(envelope['run_id']))


def make_request(directory, envelope, parent):
    initialized = (directory / 'agent-request.json').exists()
    if initialized and ('method_selection' not in envelope or ((directory / 'method-context.json').exists() and (directory / 'msg.txt').exists())):
        return
    agent = envelope['contract'].get('agent', 'skill-factory')
    if agent != 'skill-factory':
        raise ValueError('agent not in deployed child authorization')
    state = 'RUN_ID=' + envelope['run_id'] + '\nTASK_ID=' + envelope['task_id'] + '\nAGENT=' + agent + '\n'
    (directory / 'state.env').write_text(state)
    remaining = timestamp(envelope['deadline_at']) - time.time()
    if remaining <= 0:
        raise ValueError('execution deadline exhausted')
    # init持nonce/parent；deadline来自Brain，不因恢复而延长。
    import contextlib
    with contextlib.redirect_stdout(__import__('io').StringIO()):
        if not initialized:
            handoff.init(directory, parent, min(86400, remaining))
    request = io.read(directory / 'agent-request.json')
    request['expires_at'] = timestamp(envelope['deadline_at'])
    request['protocol'] = io.PROTOCOL
    request['execution_location'] = {'host': 'mmv', 'tool': 'gateway_exec', 'run_directory': str(directory)}
    method_instruction = ''
    if 'method_selection' in envelope:
        context = module('wf-method').execution_context(envelope, directory)
        io.write(directory / 'method-context.json', context)
        request['execution_location']['method_context'] = str(directory / 'method-context.json')
        method_instruction = context['instruction']
    io.write(directory / 'agent-request.json', request)
    (directory / 'msg.txt').write_text(
        '【通用Commander业务子会话】仅执行冻结合同，禁止修改代码或直接完成Brain任务。\n'
        '执行位置execution_location=MMV网关宿主；模型本机不是MMV。读取绑定、input/contract、活动event、报告collect/verify、产物和交付文件均须gateway_exec；JSON用结构化env配固定Python读os.environ传stdin，正文不得拼shell。长进程用gateway_process。resources.machine仅指手机动作宿主，不能据此迁移run目录或报告helper。\n'
        '完整输入：' + str(directory / 'input.json') + '\n冻结合同：' + str(directory / 'contract.json') +
        '\n运行信封：' + str(directory / 'envelope.json') + '\n产物目录：' + str(directory / 'evidence') +
        '\n' + method_instruction + '\n不要求业务子会话调用session_status；仅使用实际暴露且执行目标所需的工具，绑定文件与官方receipt确认归属。上次因未暴露工具失败时先读previous_attempt，不重复附加无关工具要求。'
        '\n按照合同skill与activities执行；原样保留所有输入字段，仅为contract中by=agent的业务activity/step上报（preflight与cleanup由外壳负责，不能代补）；每个真实完成的activity/step，用activity_bindings按key定位并对照definition.expected_path的reference_id和step_id逐项通过 wf-v2.py event 发activity_completed，附started_at/ended_at/outcome及真实evidence；不能只记最外层activity，不能根据delivery补造步骤证据。'
        '\n手机资源由外壳领锁/收尾，业务全程精确使用run_id作lock-owner，不另领或释放锁。'
        '\n活动 outcome 只允许 pass|fail|skipped|unknown；completed 是事件类型，不是 outcome。started_at/ended_at 用真实带时区ISO时间；completed 的 evidence 必须为非空对象。event 被拒且未分seq时可依据同一真实产物纠正字段后重报；已持久事件不得改写。'
        '\n外部副作用幂等key用task_id与activity，不用run_id；未知副作用先读回，不重复发布。'
        '\n最后一行：WF_DELIVERY {"status":"completed|failed|blocked","outputs":{},"evidence":[],"effects":[],"failure":null}'
        '\n上次失败结构化上下文见信封recovery.previous_attempt（run_id、attempt、failure、verification.assertions/evidence、diagnostic_sha256）；先核对证据，原始记录按task/run只读回查。\n核验失败的断言与证据见信封recovery；只在冻结恢复合同允许范围修复产物，不现场修代码。\n', encoding='utf-8')


def current(directory):
    env = io.read(directory / 'envelope.json')
    state = io.read(directory / 'runtime.json')
    result = dict(protocol=io.PROTOCOL, run_id=env['run_id'], state=state['phase'],
                  execution_stopped=state.get('execution_stopped', False),
                  deadline_at=env['deadline_at'], cleanup_deadline_at=env['cleanup_deadline_at'])
    result['feedback'] = io.feedback_status(directory)
    for name, field in [('delivery.json', 'delivery'), ('events.json', 'events')]:
        if (directory / name).exists():
            result[field] = io.read(directory / name)
    if (directory / 'agent-binding.json').exists():
        result.update(action='await', binding=str(directory / 'agent-binding.json'))
    elif (directory / 'agent-request.json').exists():
        result.update(action='blocked' if (directory / 'spawn-claimed.json').exists() else 'claim_spawn',
                      request=str(directory / 'agent-request.json'), message=str(directory / 'msg.txt'))
    else:
        result['action'] = 'wait'
    if state['phase'] == 'cleanup_pending':
        result['action'] = 'cleanup'
    if (directory / 'delivery.json').exists():
        result['action'] = 'awaiting_verify'
    return result


def start_worker(directory):
    if os.environ.get('WF_V2_NO_WORKER') == '1':
        return
    with open(directory / 'runtime.log', 'ab') as log:
        subprocess.Popen([sys.executable, str(HERE / 'wf-v2.py'), 'worker', str(directory)],
                         stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True, close_fds=True)


def launch(path, parent):
    # 与部署封签的admission锁串行，避免ready之后半上线抢跑。
    with io.lock(HERE / '.admission.lock', shared=True):
        return launch_locked(path, parent)


def launch_locked(path, parent):
    if not Path(path).is_absolute() or Path(path).stat().st_size > 180000:
        raise ValueError('bounded absolute envelope path required')
    envelope = io.read(path)
    validate(envelope, parent)
    directory = run_directory(envelope['run_id'])
    # 新attempt先机械验证独享目录，再持久任何输入；不能靠未来目录预存在换取旧run安全PASS。
    if directory.is_symlink() or (directory.parent.exists() and directory.parent.resolve() != directory.parent):
        raise ValueError('run root alias forbidden')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if directory.resolve() != directory or (directory / '.launch.lock').is_symlink():
        raise ValueError('run root is not canonical')
    if 'method_selection' in envelope:
        goal = envelope['method_selection']['original_goal_definition']
        previous = envelope['method_selection']['selection_receipt']['previous_run_id']
        if envelope['run_id'] in (goal['original_run_id'], previous):
            raise ValueError('new attempt must not reuse failed run')
    with io.lock(directory / '.launch.lock'):
        if (directory / 'envelope.json').exists():
            for name in ('envelope.json', 'input.json', 'contract.json', 'runtime.json'):
                if (directory / name).is_symlink():
                    raise ValueError('persisted run file alias forbidden')
            if io.read(directory / 'envelope.json') != envelope:
                raise ValueError('frozen run identity/input/budget conflict')
            if io.read(directory / 'input.json') != envelope['input'] or io.read(directory / 'contract.json') != envelope['contract']:
                raise ValueError('persisted input or contract drift')
            if io.read(directory / 'runtime.json')['parent'] != parent:
                raise ValueError('parent session conflict; use original attributed parent')
        else:
            if any(path.name != '.launch.lock' for path in directory.iterdir()):
                raise ValueError('new run directory contains prior evidence; refuse overwrite')
            if time.time() >= timestamp(envelope['deadline_at']):
                raise ValueError('execution budget exhausted')
            io.write(directory / 'envelope.json', envelope)
            io.write(directory / 'input.json', envelope['input'])
            io.write(directory / 'contract.json', envelope['contract'])
            (directory / 'evidence').mkdir(exist_ok=True)
            io.write(directory / 'runtime.json', dict(phase='preparing', execution_stopped=False, parent=parent))
            io.emit(directory, 'started', {'definition': envelope['definition']})
        if not envelope['contract'].get('resources') and not (directory / 'delivery.json').exists():
            make_request(directory, envelope, parent)
        start_worker(directory)
        return current(directory)


def claim(directory):
    with io.lock(directory / '.launch.lock'):
        if (directory / 'handoff-closed.json').exists():
            raise ValueError('handoff closed; no new side effects')
        if (directory / 'spawn-claimed.json').exists() or (directory / 'agent-binding.json').exists():
            raise ValueError('spawn already claimed; bind existing receipt or await; never respawn')
        envelope = io.read(directory / 'envelope.json')
        if 'method_selection' in envelope:
            expected = module('wf-method').execution_context(envelope, directory)
            if io.read(directory / 'method-context.json') != expected or not (directory / 'msg.txt').is_file():
                raise ValueError('method child context missing or drifted')
            io.ready(envelope)  # 领取唯一spawn权之前重新核两实例，不能凭启动时旧ready。
        request = io.read(directory / 'agent-request.json')
        if time.time() >= request['expires_at']:
            raise ValueError('spawn deadline exhausted')
        io.write(directory / 'spawn-claimed.json', dict(nonce=request['nonce'], at=time.time()))
        return dict(request=request, message=(directory / 'msg.txt').read_text())


def finalize(directory, envelope, phone):
    completion = io.read(directory / 'agent-completion.json')
    agent = io.read(directory / 'agent-delivery.json')
    cleanup_path = directory / 'cleanup.json'
    if cleanup_path.exists() and io.read(cleanup_path).get('completed') is True:
        cleanup = io.read(cleanup_path)
    elif phone:
        cleanup = phone.cleanup()
    else:
        cleanup = dict(completed=True, evidence=[str(directory / 'agent-terminal.json')])
        io.write(cleanup_path, cleanup)
    if phone and not cleanup['completed'] and time.time() < timestamp(envelope['cleanup_deadline_at']):
        raise CleanupPending('cleanup evidence or release incomplete; cleanup-only reentry')
    if not isinstance(agent.get('outputs'), (dict, list)) or not isinstance(agent.get('evidence'), list) or not isinstance(agent.get('effects'), list):
        raise ValueError('complete outputs/evidence/effects required; never infer absent effects')
    for effect in agent['effects']:
        if not isinstance(effect, dict) or not effect.get('key') or effect.get('status') not in ('none', 'committed', 'compensated', 'unknown') or 'receipt' not in effect:
            raise ValueError('invalid external effect receipt')
    status = agent.get('status', agent.get('claimed_result', 'failed'))
    if status == 'success':
        status = 'completed'
    if status not in ('completed', 'failed', 'blocked') or completion['status'] != 'ok':
        status = 'failed'
    delivery = {key: envelope[key] for key in ('protocol', 'task_id', 'run_id', 'attempt', 'owner_epoch', 'input', 'input_sha256', 'definition')}
    delivery.update(outputs=agent.get('outputs', {}), evidence=agent.get('evidence', []),
                    effects=agent.get('effects', []), cleanup=cleanup, status=status,
                    failure=agent.get('failure') if status == 'completed' else (agent.get('failure') or 'execution_failed'),
                    agent_delivery=agent)
    if len(io.canonical(delivery)) > 200000:
        original = directory / 'agent-delivery.json'
        delivery['outputs'] = {'artifact': str(original), 'sha256': __import__('hashlib').sha256(original.read_bytes()).hexdigest()}
        delivery.pop('agent_delivery')
    io.write(directory / 'delivery.json', delivery)
    events = io.read(directory / 'events.json')
    if not any(event['type'] == 'delivery' for event in events):
        io.emit(directory, 'delivery', delivery)
    state = io.read(directory / 'runtime.json')
    io.write(directory / 'runtime.json', dict(state, phase='awaiting_verify', execution_stopped=True))



def failed_delivery(directory, envelope, reason):
    existing = directory / 'agent-delivery.json'
    agent = io.read(existing) if existing.exists() else {}
    proof = [str(directory / name) for name in ('agent-terminal.json', 'child-stop-readback.json', 'handoff-closed.json') if (directory / name).exists()]
    no_spawn = not (directory / 'spawn-claimed.json').exists() and not (directory / 'agent-binding.json').exists()
    cleanup = io.read(directory / 'cleanup.json') if (directory / 'cleanup.json').exists() else {'completed': not envelope['contract'].get('resources'), 'evidence': proof}
    delivery = {key: envelope[key] for key in ('protocol', 'task_id', 'run_id', 'attempt', 'owner_epoch', 'input', 'input_sha256', 'definition')}
    delivery.update(status='failed', failure=reason, cleanup=cleanup, evidence=proof,
                    outputs={'artifact': str(existing)} if existing.exists() else {},
                    effects=[{'key': envelope['task_id'] + ':execution', 'status': 'none' if no_spawn else 'unknown', 'receipt': proof}])
    io.write(directory / 'delivery.json', delivery)
    io.emit(directory, 'delivery', delivery)


def work(directory):
    try:
        with io.lock(directory / '.worker.lock', blocking=False):
            worker(directory)
    except BlockingIOError:
        return


def worker(directory):
    envelope = io.read(directory / 'envelope.json')
    phone = phone_module.Phone(directory, envelope) if envelope['contract'].get('resources') else None
    state = io.read(directory / 'runtime.json')
    try:
        if phone:
            for key in ('preflight', 'cleanup'):
                phone_module.shell.recover(phone, key)
        if (directory / 'delivery.json').exists():
            delivery = io.read(directory / 'delivery.json')
            if not any(event['type'] == 'delivery' for event in io.read(directory / 'events.json')):
                io.emit(directory, 'delivery', delivery)
            io.write(directory / 'runtime.json', dict(state, phase='awaiting_verify', execution_stopped=True))
            io.replay(directory)
            return
        if (directory / 'execution-failure.json').exists():
            reason = io.read(directory / 'execution-failure.json')['reason']
            if phone and (not (directory / 'cleanup.json').exists() or not io.read(directory / 'cleanup.json').get('completed')):
                cleanup = phone.cleanup()
                io.write(directory / 'cleanup.json', cleanup)
                if not cleanup['completed'] and time.time() < timestamp(envelope['cleanup_deadline_at']):
                    raise CleanupPending('failed execution cleanup-only reentry')
            failed_delivery(directory, envelope, reason)
            io.write(directory / 'runtime.json', dict(state, phase='awaiting_verify', execution_stopped=True))
            io.replay(directory)
            return
        if phone and not (directory / 'agent-completion.json').exists() and not (directory / 'preflight.json').exists():
            if (directory / 'preflight-intent.json').exists():
                raise ValueError('preflight interrupted; inspect owner/account before recovery')
            io.write(directory / 'preflight-intent.json', {'at': time.time()})
            phone.prepare()
        make_request(directory, envelope, state['parent'])
        io.write(directory / 'runtime.json', dict(state, phase='executing', execution_stopped=False))
        last_heartbeat = 0
        while not (directory / 'agent-completion.json').exists():
            if time.time() >= timestamp(envelope['cleanup_deadline_at']):
                raise ValueError('cleanup budget exhausted; retain unknown execution ownership')
            if time.time() >= timestamp(envelope['deadline_at']):
                if (directory / 'agent-binding.json').exists():
                    try:
                        handoff.await_result(directory, once=True)
                    except Exception as error:
                        io.write(directory / 'deadline-await-error.json', {'reason': str(error)})
                    if (directory / 'agent-completion.json').exists():
                        break
                    if time.time() < timestamp(envelope['cleanup_deadline_at']):
                        handoff.stop(directory)
                raise ValueError('deadline exhausted; child stopped or needs official readback')
            if time.time() - last_heartbeat > 30:
                io.emit(directory, 'heartbeat', {'phase': 'executing'})
                io.replay(directory)
                if phone:
                    phone.refresh()
                last_heartbeat = time.time()
            if (directory / 'agent-binding.json').exists():
                handoff.await_result(directory, once=True)
            else:
                time.sleep(1)
        finalize(directory, envelope, phone)
        io.replay(directory)
    except CleanupPending as error:
        io.write(directory / 'runtime.json', dict(state, phase='cleanup_pending', execution_stopped=True, failure=str(error)))
        io.emit(directory, 'blocked', {'reason': str(error), 'execution_stopped': True, 'recovery': 'cleanup_only'})
        io.replay(directory)
    except Exception as error:
        # 活性不明不收锁、不重跑；明确终态后可再次启动worker完成收尾/补账。
        stopped = (directory / 'agent-completion.json').exists()
        terminal_path = directory / 'agent-terminal.json'
        if terminal_path.exists() and (directory / 'agent-binding.json').exists():
            terminal = io.read(terminal_path)
            binding = io.read(directory / 'agent-binding.json')
            stopped = stopped or (terminal.get('runId') == binding['child_run_id'] and terminal.get('endedAt') is not None)
        stop_path = directory / 'child-stop-readback.json'
        if stop_path.exists():
            receipt = io.read(stop_path)
            binding = io.read(directory / 'agent-binding.json')
            stopped = stopped or (receipt.get('runId') == binding['child_run_id'] and receipt.get('endedAt') is not None)
        with io.lock(directory / '.launch.lock'):
            if not (directory / 'spawn-claimed.json').exists() and not (directory / 'agent-binding.json').exists():
                io.write(directory / 'handoff-closed.json', {'reason': str(error)})
                stopped = True
        if stopped:
            io.write(directory / 'execution-failure.json', {'reason': str(error)})
        if stopped and phone and (not (directory / 'cleanup.json').exists() or not io.read(directory / 'cleanup.json').get('completed')):
            try:
                io.write(directory / 'cleanup.json', phone.cleanup())
            except Exception:
                io.write(directory / 'cleanup.json', {'completed': False, 'evidence': []})
        if stopped and phone and not io.read(directory / 'cleanup.json')['completed'] and time.time() < timestamp(envelope['cleanup_deadline_at']):
            io.write(directory / 'runtime.json', dict(state, phase='cleanup_pending', execution_stopped=True, failure=str(error)))
            io.emit(directory, 'blocked', {'reason': str(error), 'execution_stopped': True, 'recovery': 'cleanup_only'})
            io.replay(directory)
            return
        io.write(directory / 'runtime.json', dict(state, phase='blocked', execution_stopped=stopped, failure=str(error)))
        io.emit(directory, 'blocked', {'reason': str(error), 'execution_stopped': stopped,
                                    'recovery': 'read existing child/side effects; retain task and immutable budget'})
        if stopped and not (directory / 'delivery.json').exists():
            failed_delivery(directory, envelope, str(error))
            io.write(directory / 'runtime.json', dict(state, phase='awaiting_verify', execution_stopped=True))
        io.replay(directory)


def main():
    command = sys.argv[1]
    if command == 'launch':
        parser = argparse.ArgumentParser()
        parser.add_argument('--ready', action='store_true')
        parser.add_argument('--envelope')
        parser.add_argument('--parent-session')
        args = parser.parse_args(sys.argv[2:])
        result = io.ready(json.load(sys.stdin)) if args.ready else launch(args.envelope, args.parent_session)
    elif command == 'worker':
        work(Path(sys.argv[2]))
        return
    elif command == 'status':
        directory = run_directory(sys.argv[2])
        result = current(directory)
        if result['state'] == 'cleanup_pending' or (not result['execution_stopped'] and (directory / 'agent-binding.json').exists()):
            try:
                with io.lock(directory / '.worker.lock', blocking=False):
                    start_worker(directory)  # 仅续接官方child监督，不产生新业务会话
            except BlockingIOError:
                pass
    elif command == 'claim-spawn':
        result = claim(Path(sys.argv[2]))
    elif command == 'replay':
        result = io.replay(Path(sys.argv[2]))
    elif command == 'event':
        event = json.load(sys.stdin)
        if event.get('type') not in ('activity_started', 'activity_completed'):
            raise ValueError('business events must be activity facts')
        result = io.emit(Path(sys.argv[2]), event['type'], event['data'])
    else:
        raise ValueError('unknown operation')
    print(json.dumps(result, ensure_ascii=False))
    if command == 'replay' and (not result['replayed'] or result.get('error') or result.get('rejected')):
        sys.exit(2)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps(dict(protocol=io.PROTOCOL, ready=False, error=str(error))))
        sys.exit(2)
