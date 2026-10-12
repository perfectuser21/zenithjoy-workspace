#!/usr/bin/env python3
"""Commander 正式子会话交接：init/bind/await/complete/status/stop。消息只经 sessions_spawn。

bind/complete 从 stdin 读取 JSON。身份绑定 run/task/parent/nonce/child，不接受跨 run 或晚到交付。
stop 只精确取消已绑定的子 run；取消和只读等待均为官方非消息 RPC，不删 exec 标记。
"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location('wf_agent_lib', Path(__file__).with_name('wf-agent-lib.py'))
lib = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lib)
IDENTITY = ('run_id', 'task_id', 'parent_session_key', 'nonce')
CHILD = ('child_session_key', 'child_run_id')


def load(path):
    return json.loads(path.read_text())


def write(path, value):
    lib._write(str(path), value)


def request_at(directory):
    return load(directory / 'agent-request.json')


def validate_identity(request, incoming):
    if any(incoming.get(k) != request[k] for k in IDENTITY):
        raise ValueError('handoff identity mismatch')


def ensure_open(directory, request):
    if (directory / 'handoff-closed.json').exists() or (directory / 'delivery.json').exists():
        raise ValueError('handoff already closed')
    if time.time() >= request['expires_at']:
        raise ValueError('handoff expired')


def init(directory, parent, timeout):
    if not re.fullmatch(r'agent:work-commander:[A-Za-z0-9_.:/-]+', parent):
        raise ValueError('explicit Commander parent session key required')
    seconds = float(timeout)
    if seconds <= 0 or seconds > 86400:
        raise ValueError('invalid handoff timeout')
    if (directory / 'agent-request.json').exists():
        raise ValueError('run already initialized; never relaunch it')
    state = lib.read_state(str(directory / 'state.env'))
    request = dict(run_id=state['RUN_ID'], task_id=state['TASK_ID'],
                   parent_session_key=parent, nonce=secrets.token_hex(24),
                   agent_id=state['AGENT'], expires_at=time.time() + seconds)
    write(directory / 'agent-request.json', request)
    print(json.dumps(request))


def bind(directory, incoming):
    request = request_at(directory)
    validate_identity(request, incoming)
    ensure_open(directory, request)
    if not re.fullmatch(r'agent:' + re.escape(request['agent_id']) + r':subagent:[A-Za-z0-9_.:-]+', incoming.get('child_session_key', '')):
        raise ValueError('wrong child agent/session')
    if not re.fullmatch(r'[0-9a-fA-F-]{36}', incoming.get('child_run_id', '')):
        raise ValueError('invalid child run id')
    receipt = {k: incoming[k] for k in IDENTITY + CHILD}
    path = directory / 'agent-binding.json'
    if path.exists() and load(path) != receipt:
        raise ValueError('run already bound to another child')
    write(path, receipt)
    print(json.dumps(receipt))


def complete(directory, incoming):
    request = request_at(directory)
    validate_identity(request, incoming)
    binding = load(directory / 'agent-binding.json')
    if any(incoming.get(k) != binding[k] for k in CHILD):
        raise ValueError('child completion mismatch')
    if incoming.get('status') not in ('ok', 'error', 'timeout', 'aborted', 'unknown') or not isinstance(incoming.get('result'), str):
        raise ValueError('official terminal status and original result required')
    if len(incoming['result']) > 1000000:
        raise ValueError('result too large')
    path = directory / 'agent-completion.json'
    if path.exists():
        if load(path) == incoming:
            return
        raise ValueError('completion already recorded')
    ensure_open(directory, request)
    text = incoming['result']
    (directory / 'agent.log').write_text(text)
    delivery = lib.parse_delivery(text)
    if incoming['status'] != 'ok':
        # Runtime failure never becomes success merely because model text claims it.
        delivery = dict(delivery, claimed_result='failed', fail_reason='child_' + incoming['status']) if delivery else {}
    write(directory / 'agent-delivery.json', delivery)
    write(path, incoming)  # commit marker last; runner never consumes a partial result


def status(directory):
    request = request_at(directory)
    if (directory / 'agent-completion.json').exists():
        result = load(directory / 'agent-completion.json')
        print('0' if result['status'] == 'ok' else '1')
        return 0
    if time.time() >= request['expires_at']:
        return 4
    return 3


def rpc(method, payload, timeout=20):
    result = subprocess.run([os.environ.get('OPENCLAW', 'openclaw'), 'gateway', 'call', method,
                             '--params', json.dumps(payload), '--json', '--timeout', str(int(timeout * 1000))],
                            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout + 2)
    if result.returncode:
        raise ValueError('child lifecycle RPC failed')
    return json.loads(result.stdout)


def await_result(directory):
    # 不持文件锁等待网络，否则会阻塞外壳续租/超时检查；完成时重新校验全部身份。
    binding = load(directory / 'agent-binding.json')
    request = request_at(directory)
    validate_identity(request, binding)
    while True:
        remaining = request['expires_at'] - time.time()
        if remaining <= 0:
            raise ValueError('child await expired')
        seconds = min(60, remaining)
        terminal = rpc('agent.wait', dict(runId=binding['child_run_id'], timeoutMs=int(seconds * 1000)), seconds + 5)
        if terminal.get('runId') != binding['child_run_id']:
            raise ValueError('official terminal run mismatch')
        if terminal.get('endedAt') is not None:
            break
        if terminal.get('status') not in ('pending', 'timeout'):
            raise ValueError('official terminal receipt missing')
        if terminal['status'] == 'pending':
            time.sleep(1)  # 服务端排队未进入可等待run，限制重试速率
    receipt = terminal.get('terminalReceipt') or {}
    if terminal.get('status') == 'ok':
        effective = receipt.get('effective') or {}
        if receipt.get('runId') != binding['child_run_id'] or effective.get('provider') != 'openai' or effective.get('model') != 'gpt-6.1-sol':
            raise ValueError('official child model/run mismatch')
    text = (terminal.get('terminalReply') or {}).get('text') or ''
    if not isinstance(text, str):
        raise ValueError('official terminalReply text invalid')
    with open(directory / '.handoff.lock', 'a') as guard:
        fcntl.flock(guard, fcntl.LOCK_EX)
        write(directory / 'agent-terminal.json', terminal)
        complete(directory, dict(binding, status=terminal['status'], result=text))
    print(json.dumps(dict(run_id=binding['run_id'], child_run_id=binding['child_run_id'],
                         status=terminal['status'], terminalReceipt=receipt)))
    return 0


def stop(directory):
    # Close admission before cancellation, so a late spawn receipt cannot become executable.
    write(directory / 'handoff-closed.json', {'at': time.time()})
    binding_path = directory / 'agent-binding.json'
    if not binding_path.exists() or (directory / 'agent-completion.json').exists():
        return 0
    binding = load(binding_path)
    params = dict(key=binding['child_session_key'], runId=binding['child_run_id'])
    abort = rpc('sessions.abort', params)
    write(directory / 'child-abort.json', abort)
    terminal = rpc('agent.wait', dict(runId=binding['child_run_id'], timeoutMs=10000))
    write(directory / 'child-stop-readback.json', terminal)
    if terminal.get('runId') != binding['child_run_id'] or terminal.get('endedAt') is None or terminal.get('status') not in ('ok', 'error', 'timeout'):
        raise ValueError('child termination unconfirmed; retain controller lock')
    return 0


def main():
    command, root, *args = sys.argv[1:]
    directory = Path(root)
    if command == 'await':
        return await_result(directory)
    with open(directory / '.handoff.lock', 'a') as guard:
        fcntl.flock(guard, fcntl.LOCK_EX)
        if command == 'init':
            init(directory, *args)
        elif command == 'bind':
            bind(directory, json.load(sys.stdin))
        elif command == 'complete':
            complete(directory, json.load(sys.stdin))
        elif command == 'status':
            return status(directory)
        elif command == 'stop':
            return stop(directory)
        else:
            raise ValueError('unknown handoff operation')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print('wf-agent-handoff: ' + str(exc), file=sys.stderr)
        sys.exit(2)
