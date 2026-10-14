#!/usr/bin/env python3
"""冻结run的动作/Code/Skill接手入口；业务不能改变组合、预算或授权。"""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


actions = module('wf-v2-actions')
io = module('wf-v2-io')


def bound(path):
    path = Path(path)
    envelope = io.read(path)
    expected = Path.home().resolve() / 'wf-agent-runs' / envelope['run_id'] / 'envelope.json'
    actions.need(path == expected and path.resolve() == path, 'gateway requires actual persisted run envelope')
    actions.need(io.read(path.parent / 'input.json') == envelope['input']
                 and io.read(path.parent / 'contract.json') == envelope['contract'], 'gateway frozen input/contract drift')
    io.ready(envelope)
    return envelope


def verification(ref, envelope, reference):
    # 正式task结果来自鉴权Brain读回，不能接受stdin自报PASS。
    response = io.brain_read('/api/brain/tasks/' + ref['task_id'])
    task = response.get('task', response)
    actions.need(task.get('id') == ref['task_id'] and task.get('status') in ('completed', 'completed_no_pr'), 'verification task not independently completed')
    payload = task.get('payload', {})
    runtime = task.get('result', {}).get('receipt', {}).get('verification_runtime', {})
    actions.need(task.get('task_type') == 'research' and payload.get('verification_transport') == 'openclaw-agent-v1'
                 and runtime.get('provider') == 'openai' and runtime.get('model') == 'gpt-6.1-sol'
                 and runtime.get('logical_run_id') == payload.get('run_id') and runtime.get('official_run_id')
                 and runtime.get('rerouted') is False, 'verification transport not formally confirmed')
    result = task.get('result', {}).get('workflow_verification', {})
    actions.need(result.get('task_id') == task.get('parent_task_id') and result.get('run_id') == ref['run_id'] and result.get('definition_sha256') == ref['definition_sha256']
                 and result.get('assertions') and all(a.get('pass') is True for a in result['assertions']), 'verification identity or assertions mismatch')
    source_response = io.brain_read('/api/brain/tasks/' + task['parent_task_id'])
    source = source_response.get('task', source_response)
    control = source.get('result', {}).get('workflow_control', {})
    frozen = control.get('envelope', {})
    actions.need(source.get('status') in ('completed', 'completed_no_pr') and control.get('verify_task_id') == ref['task_id']
                 and frozen.get('run_id') == ref['run_id'] and frozen.get('definition', {}).get('snapshot_sha256') == ref['definition_sha256']
                 and frozen.get('contract', {}).get('environment') == envelope['contract']['environment'], 'verification source run/environment mismatch')
    expected = actions.ActionStore(envelope).binding(reference)['implementations']
    candidates = []
    for item in frozen.get('activity_bindings', []):
        declared = item.get('primary_implementation', {})
        if declared.get('implementation') == expected['skill']['implementation'] and declared.get('path') == expected['skill']['path']:
            candidates.append(declared)
    actions.need(len(candidates) == 1 and candidates[0].get('business_requirement_sha256') == expected['business_requirement_sha256'], 'verification source business Skill binding mismatch')
    return dict(result, task_id=ref['task_id'])


def invoke(path, args, envelope):
    actions.need(isinstance(args, list) and all(isinstance(a, str) and '\0' not in a for a in args), 'gateway args must be strings')
    interpreter = {'.py': sys.executable, '.sh': 'bash', '.mjs': 'node', '.js': 'node'}.get(path.suffix)
    actions.need(interpreter, 'frozen Code language unsupported')
    env = {k: v for k, v in os.environ.items() if k not in ('PYTHONPATH', 'NODE_PATH', 'BASH_ENV', 'ENV')}
    env.update(WF_COMMANDER_ENVELOPE=str(Path.home().resolve() / 'wf-agent-runs' / envelope['run_id'] / 'envelope.json'),
               WF_COMMANDER_OWNER_EPOCH=str(envelope['owner_epoch']), PYTHONDONTWRITEBYTECODE='1')
    child = subprocess.Popen([interpreter, str(path), *args], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        stdout, stderr = child.communicate(timeout=max(0.01, actions.epoch(envelope['deadline_at']) - time.time()))
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        stdout, stderr = child.communicate()
        raise ValueError('frozen code deadline exhausted; result unknown')
    return {'exit_code': child.returncode, 'stdout': stdout.decode(), 'stderr': stderr.decode()}


def fence(envelope, incoming):
    actions.need(all(incoming.get(k) == envelope[k] for k in ('task_id', 'run_id', 'owner_epoch')), 'fence identity mismatch')
    store = actions.ActionStore(envelope)
    store.close(incoming.get('reason', 'execution authority revoked'), stopped=False)
    stopped = False
    directory = Path.home().resolve() / 'wf-agent-runs' / envelope['run_id']
    binding_path, terminal_path = directory / 'agent-binding.json', directory / 'agent-terminal.json'
    if binding_path.exists() and terminal_path.exists():
        terminal, binding = io.read(terminal_path), io.read(binding_path)
        stopped = terminal.get('runId') == binding['child_run_id'] and terminal.get('endedAt') is not None
    fenced = True
    resource = envelope['contract'].get('resources', {})
    if resource:
        phone = module('wf-v2-phone').Phone(directory, envelope)
        phone.stage = 'cleanup'
        phone.deadline = phone.cleanup_deadline
        try:
            result = phone.policy('fence', stopped=stopped)
            fenced = result.get('execution_fenced') is True and all(result.get(k) == envelope[k] for k in ('task_id', 'run_id', 'owner_epoch'))
        except Exception as error:
            fenced = False
            io.write(directory / 'execution-fence-error.json', {'reason': str(error)})
    if stopped:
        store.close(incoming.get('reason', 'official terminal confirmed'), stopped=True)
    result = {k: envelope[k] for k in ('protocol', 'task_id', 'run_id', 'owner_epoch')}
    result.update(execution_fenced=fenced, execution_stopped=stopped, cleanup={'completed': False, 'evidence': []})
    io.write(directory / 'execution-fence.json', result)
    return result


def execute(command, envelope, payload):
    store = actions.ActionStore(envelope)
    reference = payload.get('reference_id')
    if command == 'fence':
        return fence(envelope, payload)
    if command == 'takeover':
        skill = store.takeover(reference, lambda ref: verification(ref, envelope, reference))
        return {'skill': skill, 'execution_role': 'rescue', 'environment': envelope['contract']['environment'], 'action_store': str(store.path)}
    if command == 'primary':
        with actions.locked(store.guard):
            store.admitted(store.state())
        activity = store.binding(reference)
        binding = activity.get('primary_implementation') or activity.get('implementations', {}).get('code')
        actions.need(binding, 'frozen primary implementation missing')
        if activity.get('implementations') and binding['implementation']['kind'] == 'code':
            actions.need(binding['implementation'] == activity['implementations']['code']['implementation'], 'primary Code does not match pair')
        path = actions.source_path(binding['path'])
        actions.need(actions.hashlib.sha256(path.read_bytes()).hexdigest() == binding['implementation']['digest'].removeprefix('sha256:'), 'frozen Code digest mismatch')
        if binding['implementation']['kind'] == 'skill':
            return {'skill': binding, 'execution_role': 'primary', 'environment': envelope['contract']['environment'], 'action_store': str(store.path)}
        started = datetime.now(timezone.utc).isoformat()
        artifact = Path.home().resolve() / 'wf-agent-runs' / envelope['run_id'] / 'evidence' / ('primary-' + actions.hashlib.sha256(reference.encode()).hexdigest()[:16] + '-' + str(time.time_ns()) + '.json')
        try:
            result = invoke(path, payload.get('args', []), envelope)
            io.write(artifact, {'implementation': binding['implementation'], 'started_at': started, 'ended_at': datetime.now(timezone.utc).isoformat(), 'result': result})
            # Code退出0只表示helper完成；真实业务PASS仍须独立核验。
            fact = store.record_execution(reference, 'code', 'unknown' if result['exit_code'] == 0 else 'fail', {'value': result['exit_code']})
        except Exception as error:
            if not artifact.exists():
                io.write(artifact, {'implementation': binding['implementation'], 'started_at': started, 'ended_at': datetime.now(timezone.utc).isoformat(), 'error': str(error)})
            fact = store.record_execution(reference, 'code', 'fail', {'error': str(error)})
            fact['artifact'] = str(artifact)
            emit_execution(envelope, reference, fact, started)
            raise
        fact['artifact'] = str(artifact)
        emit_execution(envelope, reference, fact, started)
        return {'result': result, 'evidence': fact}
    if command == 'record':
        activity = store.binding(reference)
        kind = payload['kind']
        actions.need(kind == 'skill', 'Code facts must come from actual primary helper execution')
        primary = activity.get('primary_implementation')
        skill_primary = primary and primary['implementation']['kind'] == 'skill'
        if not skill_primary:
            actions.need(store.state().get('takeovers', {}).get(reference), 'Skill rescue not admitted by formal verification')
        skill = primary if skill_primary else activity['implementations']['skill']
        source = actions.source_path(skill['path'])
        actions.need(actions.hashlib.sha256(source.read_bytes()).hexdigest() == skill['implementation']['digest'].removeprefix('sha256:'), 'record Skill source drift')
        fact = store.record_execution(reference, kind, payload['outcome'], payload['observed'])
        data = {'reference_id': reference, 'started_at': payload['started_at'], 'ended_at': payload['ended_at'],
                'outcome': payload['outcome'], 'evidence': {k: fact[k] for k in ('implementation', 'execution_role', 'environment', 'observed')}}
        if payload.get('step_id'):
            data['step_id'] = payload['step_id']
        io.emit(Path.home().resolve() / 'wf-agent-runs' / envelope['run_id'], 'activity_completed', data)
        return fact
    actions.need(command == 'readback', 'unknown gateway operation')
    if envelope['contract'].get('resources'):
        directory = Path.home().resolve() / 'wf-agent-runs' / envelope['run_id']
        phone = module('wf-v2-phone').Phone(directory, envelope)
        phone.stage = 'cleanup'
        phone.deadline = phone.cleanup_deadline
        result = phone.policy('readback', key=payload['key'])
    else:
        result = actions.readback_helper(envelope, payload['key'], HERE)
    return {'readback': result, 'events': emit_readback(envelope, payload['key'], result)}


def emit_execution(envelope, reference, fact, started):
    directory = Path.home().resolve() / 'wf-agent-runs' / envelope['run_id']
    paths = [p for p in envelope['definition'].get('expected_path', []) if p['reference_id'] == reference]
    # helper是整Activity入口，不能根据失败凭空补造从未开始的步骤。
    activity = next((p for p in paths if not p.get('step_id')), None)
    actions.need(activity, 'primary helper missing frozen Activity path')
    evidence = {k: fact[k] for k in ('implementation', 'execution_role', 'environment', 'observed')}
    if fact.get('artifact'):
        evidence['source_file'] = {'path': fact['artifact'], 'sha256': actions.hashlib.sha256(Path(fact['artifact']).read_bytes()).hexdigest()}
    evidence['runtime_snapshot_sha256'] = envelope['definition']['runtime_snapshot_sha256']
    data = {'reference_id': reference, 'outcome': fact['outcome'], 'started_at': started,
            'ended_at': datetime.now(timezone.utc).isoformat(), 'evidence': evidence}
    io.emit(directory, 'activity_completed', data)


def emit_readback(envelope, key, result):
    # 只有已冻结probe的真实输出可新增观察事实；不接受stdin自报Code PASS。
    store = actions.ActionStore(envelope)
    action = store.action(key)
    events = []
    for observed in result.get('activity_facts', []):
        reference = observed['reference_id']
        actions.need(reference == action['reference_id'] and isinstance(observed.get('observed'), dict), 'readback fact outside frozen action')
        activity = store.binding(reference)
        primary = activity.get('primary_implementation') or activity.get('implementations', {}).get('code')
        failed = any(x['run_id'] == envelope['run_id'] and x['reference_id'] == reference and x['implementation']['kind'] == 'code' and x['outcome'] == 'fail' for x in store.executions())
        if failed:
            takeover = store.state().get('takeovers', {}).get(reference)
            actions.need(takeover, 'Code failure retained; readback alone cannot authorize rescue or turn Code PASS')
            implementation, role = takeover['implementation'], 'rescue'
        else:
            actions.need(primary, 'readback primary identity missing')
            implementation, role = primary['implementation'], 'primary'
        actions.need(observed.get('outcome') in ('pass', 'fail', 'unknown'), 'readback outcome invalid')
        store.record_execution(reference, implementation['kind'], observed['outcome'], observed['observed'])
        data = {'reference_id': reference, 'outcome': observed['outcome'],
                'started_at': result['_observed_started_at'], 'ended_at': result['_observed_ended_at'],
                'evidence': {'implementation': implementation, 'execution_role': role, 'environment': envelope['contract']['environment'],
                             'observed': observed['observed'], 'readback_receipt': result['receipt'], 'readback_binding': action['readback'],
                             'runtime_snapshot_sha256': envelope['definition']['runtime_snapshot_sha256']}}
        if observed.get('step_id'):
            data['step_id'] = observed['step_id']
        events.append(io.emit(Path.home().resolve() / 'wf-agent-runs' / envelope['run_id'], 'activity_completed', data))
    return events


if __name__ == '__main__':
    try:
        command, path = sys.argv[1:]
        print(json.dumps(execute(command, bound(path), json.load(sys.stdin)), ensure_ascii=False))
    except (ValueError, OSError, KeyError) as error:
        print(json.dumps({'protocol': 'commander-v2', 'error': str(error)}))
        sys.exit(2)
