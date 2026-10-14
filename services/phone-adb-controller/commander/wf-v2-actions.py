#!/usr/bin/env python3
"""Code/Skill共用任务动作账；未知结果先读回，当前owner/预算机械隔离。"""
from contextlib import contextmanager
from datetime import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def need(value, reason):
    if not value:
        raise ValueError(reason)


def epoch(value):
    return float(value) if isinstance(value, (int, float)) else datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_name(path.name + '.tmp')
    with open(tmp, 'w') as handle:
        os.chmod(tmp, 0o600)
        json.dump(value, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


@contextmanager
def locked(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    need(not path.is_symlink(), 'linked execution lock forbidden')
    with open(path, 'a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield handle


def authorize(envelope, action):
    need(action['object'].get('task_id') == envelope['task_id'], 'action authorization task mismatch')
    account = envelope['contract'].get('resources', {}).get('account_ref')
    need(action['object'].get('account_ref') == account, 'action authorization account mismatch')
    if action['action'] != 'discard_existing_draft':
        return
    auth = envelope['input'].get('authorization', {})
    scope = action['scope']
    need(envelope['input'].get('allow_discard_existing_draft') is True
         and auth.get('object') == action['object'] and auth.get('scope') == scope
         and auth.get('action') == 'discard_existing_draft'
         and isinstance(auth.get('grant_ref'), str) and auth['grant_ref'].strip()
         and scope.get('visibility') == 'private' and scope.get('purpose') == 'acceptance'
         and isinstance(scope.get('content_ref'), str) and scope['content_ref'], 'draft authorization missing or outside scope')


class ActionStore:
    def __init__(self, envelope, home=None):
        self.envelope = envelope
        key = hashlib.sha256(envelope['task_id'].encode()).hexdigest()
        self.root = Path(home or Path.home()) / '.local/share/zenithjoy/commander-actions' / key
        self.path = self.root / 'state.json'
        self.guard = self.root / '.guard'

    def state(self):
        return read(self.path)

    def admitted(self, state, execution=True):
        e = self.envelope
        need(all(state.get(k) == e.get(k) for k in ('task_id', 'run_id', 'owner_epoch', 'input_sha256')), 'execution owner or frozen input mismatch')
        need(not state.get('closed'), 'execution owner closed; readback only')
        need(not execution or time.time() < epoch(e['deadline_at']), 'execution deadline exhausted')

    def admit(self):
        e = self.envelope
        need(time.time() < epoch(e['deadline_at']), 'execution deadline exhausted')
        with locked(self.guard):
            old = self.state() if self.path.exists() else None
            if old:
                need(old['input_sha256'] == e['input_sha256'], 'frozen input mismatch')
                need(all(old.get(k) == e.get(k) for k in ('deadline_at', 'cleanup_deadline_at')), 'frozen total budget changed')
                if old['run_id'] == e['run_id'] and old['owner_epoch'] == e['owner_epoch']:
                    self.admitted(old)
                    return
                need(old.get('stopped') is True, 'previous execution not officially stopped')
                need(e['owner_epoch'] > old['owner_epoch'], 'stale execution owner')
                need(all(a['status'] != 'unknown' for a in old['actions'].values()), 'unresolved action requires readback')
            state = {k: e[k] for k in ('task_id', 'run_id', 'owner_epoch', 'input_sha256')}
            state.update(deadline_at=e['deadline_at'], cleanup_deadline_at=e['cleanup_deadline_at'],
                         closed=False, stopped=False, actions=(old or {}).get('actions', {}), executions=(old or {}).get('executions', []))
            write(self.path, state)

    def action(self, key):
        rows = [a for a in self.envelope['contract'].get('action_bindings', []) if a['key'] == key]
        need(len(rows) == 1 and self.envelope['task_id'] in key, 'action lacks one frozen task binding')
        authorize(self.envelope, rows[0])
        return rows[0]

    def execute(self, key, operation):
        action = self.action(key)
        with locked(self.guard):
            state = self.state()
            self.admitted(state)
            prior = state['actions'].get(key)
            if prior:
                need(prior['binding'] == action, 'frozen action binding changed')
                if prior['status'] == 'committed':
                    return prior['receipt']
                need(prior['status'] in ('none', 'compensated'), 'unknown action requires readback; replay forbidden')
            record = {'key': key, 'status': 'unknown', 'receipt': None, 'binding': action,
                      'run_id': self.envelope['run_id'], 'owner_epoch': self.envelope['owner_epoch'], 'started_at': time.time(),
                      'history': (prior or {}).get('history', []) + [{'event': 'intent', 'run_id': self.envelope['run_id'], 'at': time.time()}]}
            state['actions'][key] = record
            write(self.path, state)  # 意图先fsync：外部提交后崩溃也不能误认无动作。
            try:
                receipt = operation()
            except Exception as error:
                record['history'].append({'event': 'result_unknown', 'error': str(error), 'at': time.time()})
                write(self.path, state)
                raise
            need(isinstance(receipt, dict) and receipt, 'external result requires readback receipt')
            record.update(status='unknown' if receipt.get('status') == 'unknown' else 'committed', receipt=receipt, ended_at=time.time())
            record['history'].append({'event': 'result', 'receipt': receipt, 'at': time.time()})
            write(self.path, state)
            return receipt

    def inspect(self, key):
        with locked(self.guard):
            return self.state()['actions'].get(key)

    def readback(self, key, operation):
        self.action(key)
        with locked(self.guard):
            state = self.state()
            need(state['input_sha256'] == self.envelope['input_sha256'], 'readback input mismatch')
            result = operation()
            need(isinstance(result, dict) and result.get('status') in ('none', 'committed', 'compensated', 'unknown')
                 and isinstance(result.get('receipt'), dict) and result['receipt'], 'readback requires independent result receipt')
            record = state['actions'][key]
            need(not (record['status'] == 'committed' and result['status'] == 'none'), 'committed action cannot be erased by absent readback')
            record.update(result, readback_at=time.time())
            record.setdefault('history', []).append({'event': 'readback', **result, 'at': time.time()})
            write(self.path, state)
            return result

    def close(self, reason, stopped=False):
        with locked(self.guard):
            state = self.state()
            need(state['run_id'] == self.envelope['run_id'] and state['owner_epoch'] == self.envelope['owner_epoch'], 'close owner mismatch')
            state.update(closed=True, stopped=stopped is True, close_reason=reason)
            write(self.path, state)

    def binding(self, reference):
        rows = [a for a in self.envelope['activity_bindings'] if a['reference_id'] == reference]
        need(len(rows) == 1 and (rows[0].get('implementations', {}).get('business_requirement_sha256')
             or rows[0].get('primary_implementation', {}).get('business_requirement_sha256')), 'missing frozen business implementation')
        return rows[0]

    def record_execution(self, reference, kind, outcome, observed):
        activity = self.binding(reference)
        binding = activity.get('implementations', {}).get(kind) or activity.get('primary_implementation')
        need(binding and binding['implementation']['kind'] == kind, 'execution kind not declared in frozen implementation')
        need(outcome in ('pass', 'fail', 'unknown'), 'invalid execution outcome')
        with locked(self.guard):
            state = self.state()
            self.admitted(state)
            previous = [x for x in state['executions'] if x['run_id'] == self.envelope['run_id'] and x['reference_id'] == reference and x['implementation']['kind'] == 'code']
            role = 'rescue' if kind == 'skill' and any(x['outcome'] == 'fail' for x in previous) else 'primary'
            fact = {'reference_id': reference, 'implementation': binding['implementation'], 'execution_role': role,
                    'environment': self.envelope['contract']['environment'], 'outcome': outcome, 'observed': observed,
                    'run_id': self.envelope['run_id'], 'at': time.time()}
            state['executions'].append(fact)
            write(self.path, state)
            return fact

    def executions(self):
        with locked(self.guard):
            return self.state()['executions']

    def takeover(self, reference, verify_readback):
        pair = self.binding(reference)['implementations']
        skill = pair['skill']
        with locked(self.guard):
            state = self.state()
            self.admitted(state)
            need(any(x['run_id'] == self.envelope['run_id'] and x['reference_id'] == reference and x['implementation'] == pair['code']['implementation'] and x['outcome'] == 'fail'
                     for x in state['executions']), 'primary code failure missing')
            proof = verify_readback(skill['verification_ref'])
            need(isinstance(proof, dict) and all(proof.get(k) == v for k, v in skill['verification_ref'].items())
                 and proof.get('verdict') == 'PASS' and proof.get('evidence')
                 and proof.get('execution_role') == 'primary'
                 and proof.get('implementation') == skill['implementation']
                 and proof.get('environment') == self.envelope['contract']['environment'], 'skill verification missing or mismatched')
            path = source_path(skill['path'])
            need(hashlib.sha256(path.read_bytes()).hexdigest() == skill['implementation']['digest'].removeprefix('sha256:'), 'skill source digest mismatch')
            need(all(x['status'] != 'unknown' for x in state['actions'].values()), 'unresolved action must readback before skill takeover')
            state.setdefault('takeovers', {})[reference] = {'implementation': skill['implementation'], 'verification_ref': skill['verification_ref'], 'environment': proof['environment']}
            write(self.path, state)
            return skill


def source_path(raw):
    path = Path(raw)
    if not path.is_absolute():
        root = Path(__file__).resolve().parent
        path = root / path
        need(path.resolve().is_relative_to(root), 'source outside frozen runtime root')
    need(path.is_file() and path.resolve() == path, 'source missing or linked')
    return path


def install_policy(path, envelope, admit_store=False):
    path = Path(path)
    with locked(str(path) + '.guard'):
        if path.exists():
            prior = read(path)
            need(prior == envelope or (prior.get('_stopped') is True and (envelope['task_id'] != prior['task_id']
                 or envelope['owner_epoch'] > prior['owner_epoch'])), 'controller owner policy conflict')
            if envelope['task_id'] == prior['task_id'] and prior != envelope:
                need(envelope['run_id'] != prior['run_id'] and envelope['attempt'] == prior['attempt'] + 1
                     and envelope['owner_epoch'] == prior['owner_epoch'] + 1, 'controller recovery requires next independent run/epoch')
                for field in ('input', 'input_sha256', 'contract', 'deadline_at', 'cleanup_deadline_at'):
                    need(envelope.get(field) == prior.get(field), 'controller frozen recovery field changed: ' + field)
                definition = lambda e: {k: v for k, v in e['definition'].items() if k not in ('attempt_key', 'actor')}
                need(definition(envelope) == definition(prior), 'controller frozen business definition changed')
        if admit_store:
            ActionStore(envelope).admit()
        write(path, envelope)


def close_policy(path, stopped=False):
    with locked(str(path) + '.guard'):
        policy = read(path)
        policy.update(_closed=True, _stopped=stopped is True)
        write(path, policy)


def check_policy(path, run, owner_epoch, command, action_key=None):
    p = read(path)
    need(run == p['run_id'] and owner_epoch == p['owner_epoch'], 'controller execution owner mismatch')
    cleanup = command in ('close-app', 'return-safe-desktop', 'lock-release', 'lock-status', 'snapshot-evidence', 'ui-evidence')
    need(time.time() < epoch(p['cleanup_deadline_at'] if cleanup else p['deadline_at']), 'controller deadline exhausted')
    need(not p.get('_closed') or (cleanup and p.get('_stopped') is True), 'controller execution quarantined')
    if action_key:
        rows = [a for a in p['contract'].get('action_bindings', []) if a['key'] == action_key]
        need(len(rows) == 1, 'controller action not frozen')
        authorize(p, rows[0])
    return p


def controller_guard(path, run, owner_epoch, command, action_key, argv):
    with locked(str(path) + '.guard') as handle:
        policy = check_policy(path, run, owner_epoch, command, action_key or None)
        os.set_inheritable(handle.fileno(), True)
        env = dict(os.environ, WF_COMMANDER_GATE_FD=str(handle.fileno()))
        end = epoch(policy['cleanup_deadline_at'] if command in ('close-app', 'return-safe-desktop', 'lock-release', 'lock-status', 'snapshot-evidence', 'ui-evidence') else policy['deadline_at'])
        def execute():
            inherited = (handle.fileno(),)
            if os.environ.get('DOUYIN_LOCK_GUARD_FD'):
                inherited += (int(os.environ['DOUYIN_LOCK_GUARD_FD']),)
            child = subprocess.Popen(argv, env=env, pass_fds=inherited, start_new_session=True)
            try:
                code = child.wait(timeout=max(0.01, end - time.time()))
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
                policy.update(_closed=True, _stopped=False)
                write(path, policy)
                code = 124
            return {'status': 'unknown', 'exit_code': code, 'readback_required': True}
        if command in ('tap', 'tap-snapshot', 'tap-evidence', 'locate-tap', 'private-message-send'):
            need(action_key and '--outward' in argv, 'protected click requires frozen outward action gateway')
            store = ActionStore(policy)
            action = store.action(action_key)
            need(argv[argv.index('--outward') + 1] == action['action'], 'controller outward action differs from frozen authorization')
            store.admit()
            receipt = store.execute(action_key, execute)
        else:
            receipt = execute()
        return receipt.get('exit_code', 0)


def guarded_fd(path):
    try:
        actual = os.fstat(int(os.environ['WF_COMMANDER_GATE_FD']))
        expected = os.stat(str(path) + '.guard')
        if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
            return False
        fcntl.flock(int(os.environ['WF_COMMANDER_GATE_FD']), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except (KeyError, OSError, ValueError):
        return False


def relevant_policy(path, owner_path, declared):
    policy = read(path)
    current = Path(owner_path).read_text().strip() if Path(owner_path).exists() else ''
    # 已闭合policy也不能被无身份裸调用降成legacy；新任务必须明确新owner领锁。
    return not declared or policy['run_id'] in (current, declared)


def readback_helper(envelope, key, root):
    store = ActionStore(envelope)
    action = store.action(key)
    config = action.get('readback', {})
    need(isinstance(config, dict) and isinstance(config.get('args'), list) and config.get('digest'), 'readback helper not frozen; retain unknown')
    root = Path(root).resolve()
    path = root / config.get('path', '')
    need(path.is_file() and path.resolve() == path and path.is_relative_to(root), 'readback source missing or outside runtime root')
    need(hashlib.sha256(path.read_bytes()).hexdigest() == config['digest'].removeprefix('sha256:'), 'readback source digest mismatch')
    need(path.suffix == '.py', 'readback helper must use fixed Python runtime')
    args = config['args']
    need(all(isinstance(x, str) and '\0' not in x for x in args), 'readback args invalid')
    def observe():
        budget = epoch(envelope['cleanup_deadline_at']) - time.time()
        need(budget > 0, 'readback cleanup budget exhausted')
        started = datetime.now().astimezone().isoformat()
        result = subprocess.run([sys.executable, str(path), *args], capture_output=True, text=True, timeout=budget)
        need(result.returncode == 0, 'independent action readback helper failed')
        return dict(json.loads(result.stdout), _observed_started_at=started, _observed_ended_at=datetime.now().astimezone().isoformat())
    return store.readback(key, observe)


if __name__ == '__main__':
    try:
        if sys.argv[1] == 'relevant-policy':
            sys.exit(0 if relevant_policy(*sys.argv[2:]) else 1)
        cmd, path, run, raw_epoch, command, action, *argv = sys.argv[1:]
        if cmd == 'controller-check':
            need(guarded_fd(path), 'controller gate lock missing')
            check_policy(path, run, int(raw_epoch), command, action or None)
            sys.exit(0)
        need(cmd == 'controller-guard' and argv, 'unknown controller gate command')
        sys.exit(controller_guard(path, run, int(raw_epoch), command, action, argv))
    except (ValueError, OSError, KeyError) as error:
        print('commander_gate: ' + str(error), file=sys.stderr)
        sys.exit(2)
