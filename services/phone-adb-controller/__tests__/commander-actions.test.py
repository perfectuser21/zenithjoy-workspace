"""真实文件与子进程故障注入；不访问手机、Brain或生产账。"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
import os
import subprocess
import sys
from datetime import datetime, timezone
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('actions', HERE / 'commander/wf-v2-actions.py')
actions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(actions)


class ActionsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.code = self.home / 'code.py'
        self.skill = self.home / 'SKILL.md'
        self.code.write_text('raise ValueError("broken code")\n')
        self.skill.write_text('只执行同一个私密验收目标。\n')
        impl = lambda p, kind: {'implementation': {'kind': kind, 'id': kind + '-2', 'version': '2', 'digest': 'sha256:' + hashlib.sha256(p.read_bytes()).hexdigest()}, 'path': str(p)}
        pair = {'code': impl(self.code, 'code'), 'skill': impl(self.skill, 'skill')}
        pair['skill']['verification_ref'] = {'task_id': 'verify-task', 'run_id': 'verify-run', 'definition_sha256': 'f' * 64}
        pair['business_requirement_sha256'] = 'b' * 64
        self.envelope = {'protocol': 'commander-v2', 'task_id': 'task-1', 'run_id': 'run-1', 'attempt': 1, 'owner_epoch': 1,
                         'input_sha256': 'a' * 64, 'deadline_at': time.time() + 60, 'cleanup_deadline_at': time.time() + 90,
                         'input': {'allow_discard_existing_draft': True, 'authorization': {'object': {'task_id': 'task-1', 'account_ref': 'account'}, 'action': 'discard_existing_draft', 'scope': {'visibility': 'private', 'purpose': 'acceptance', 'content_ref': 'clip'}, 'grant_ref': 'decision-1'}},
                         'definition': {'snapshot_sha256': 'f' * 64},
                         'contract': {'environment': {'id': 'mmv', 'fingerprint': 'env-2'}, 'resources': {'account_ref': 'account'},
                                      'action_bindings': [{'key': 'task-1:publish', 'reference_id': 'publish', 'action': 'publish', 'object': {'task_id': 'task-1', 'account_ref': 'account'}, 'scope': {'visibility': 'private', 'purpose': 'acceptance', 'content_ref': 'clip'}}]},
                         'activity_bindings': [{'reference_id': 'publish', 'business_requirement_sha256': 'b' * 64, 'implementations': pair}]}
        self.store = actions.ActionStore(self.envelope, self.home)
        self.store.admit()
        self.count = 0

    def publish(self):
        self.count += 1
        return {'work_id': 'work-1', 'publication_count': self.count}

    def test_receipt_loss_readback_across_run_skill_never_republishes(self):
        def lost():
            self.publish()
            raise ConnectionError('response lost after external commit')
        with self.assertRaises(ConnectionError):
            self.store.execute('task-1:publish', lost)
        self.assertEqual(self.store.inspect('task-1:publish')['status'], 'unknown')
        self.store.close('official stopped after failed child', stopped=True)
        next_env = copy.deepcopy(self.envelope)
        next_env.update(run_id='run-2', attempt=2, owner_epoch=2)
        next_store = actions.ActionStore(next_env, self.home)
        with self.assertRaisesRegex(ValueError, 'unresolved'):
            next_store.admit()
        self.store.readback('task-1:publish', lambda: {'status': 'committed', 'receipt': {'work_id': 'work-1'}})
        next_store.admit()
        receipt = next_store.execute('task-1:publish', self.publish)
        self.assertEqual(receipt['work_id'], 'work-1')
        self.assertEqual(self.count, 1)

    def test_unknown_readback_does_not_enable_replay(self):
        with self.assertRaises(ConnectionError):
            self.store.execute('task-1:publish', lambda: (_ for _ in ()).throw(ConnectionError()))
        self.store.readback('task-1:publish', lambda: {'status': 'unknown', 'receipt': {'checked': True}})
        with self.assertRaisesRegex(ValueError, 'readback'):
            self.store.execute('task-1:publish', self.publish)
        self.assertEqual(self.count, 0)

    def test_stale_owner_and_expired_execution_zero_side_effects(self):
        self.store.close('official stopped', stopped=True)
        next_env = copy.deepcopy(self.envelope)
        next_env.update(run_id='run-2', owner_epoch=2, attempt=2)
        actions.ActionStore(next_env, self.home).admit()
        with self.assertRaisesRegex(ValueError, 'owner'):
            self.store.execute('task-1:publish', self.publish)
        next_env['deadline_at'] = time.time() - 1
        with self.assertRaises(ValueError):
            actions.ActionStore(next_env, self.home).execute('task-1:publish', self.publish)
        self.assertEqual(self.count, 0)

    def test_declared_termination_unknown_never_releases_execution(self):
        self.store.close('abort RPC lost', stopped=False)
        next_env = copy.deepcopy(self.envelope)
        next_env.update(run_id='run-2', owner_epoch=2)
        with self.assertRaisesRegex(ValueError, 'stopped'):
            actions.ActionStore(next_env, self.home).admit()
        with self.assertRaises(ValueError):
            self.store.execute('task-1:publish', self.publish)

    def test_historical_failure_does_not_authorize_current_run_rescue(self):
        self.store.record_execution('publish', 'code', 'fail', {'value': 0})
        self.store.close('official old child stopped', stopped=True)
        env = copy.deepcopy(self.envelope)
        env.update(run_id='run-2', owner_epoch=2, attempt=2)
        current = actions.ActionStore(env, self.home)
        current.admit()
        with self.assertRaisesRegex(ValueError, 'primary'):
            current.takeover('publish', lambda ref: {})
        current.record_execution('publish', 'code', 'pass', {'value': 1})
        fact = current.record_execution('publish', 'skill', 'pass', {'value': 1})
        self.assertEqual(fact['execution_role'], 'primary')
        self.assertEqual(current.executions()[0]['outcome'], 'fail', 'historical failure erased')

    def test_skill_takeover_requires_primary_failure_and_formal_matching_verification(self):
        binding = self.envelope['activity_bindings'][0]
        proof = {'task_id': 'verify-task', 'run_id': 'verify-run', 'definition_sha256': 'f' * 64,
                 'verdict': 'PASS', 'implementation': binding['implementations']['skill']['implementation'],
                 'execution_role': 'primary',
                 'environment': self.envelope['contract']['environment'], 'evidence': ['independent-original']}
        with self.assertRaisesRegex(ValueError, 'primary'):
            self.store.takeover('publish', lambda ref: proof)
        self.store.record_execution('publish', 'code', 'fail', {'error': 'broken code'})
        self.assertEqual(self.store.takeover('publish', lambda ref: proof)['path'], str(self.skill))
        self.store.record_execution('publish', 'skill', 'pass', {'work_id': 'work-1'})
        facts = self.store.executions()
        self.assertEqual([(x['implementation']['kind'], x['outcome']) for x in facts], [('code', 'fail'), ('skill', 'pass')])
        self.assertEqual(facts[1]['execution_role'], 'rescue')
        for mutate in [lambda p: p.update(verdict='FAIL'), lambda p: p.update(execution_role='rescue'), lambda p: p.update(environment={'id': 'other', 'fingerprint': 'env-2'}), lambda p: p.update(implementation={**p['implementation'], 'digest': 'wrong'})]:
            bad = copy.deepcopy(proof)
            mutate(bad)
            with self.assertRaisesRegex(ValueError, 'verification'):
                self.store.takeover('publish', lambda ref: bad)

    def test_authorization_missing_or_wrong_object_cannot_discard(self):
        action = copy.deepcopy(self.envelope['contract']['action_bindings'][0])
        action.update(key='task-1:discard', action='discard_existing_draft')
        for mutate in [lambda e: e['input'].pop('allow_discard_existing_draft'), lambda e: e['input']['authorization']['object'].update(task_id='wrong'), lambda e: e['input']['authorization']['scope'].update(visibility='public')]:
            env = copy.deepcopy(self.envelope)
            env['contract']['action_bindings'].append(action)
            mutate(env)
            with self.assertRaisesRegex(ValueError, 'authorization'):
                actions.ActionStore(env, self.home).execute('task-1:discard', self.publish)
        self.assertEqual(self.count, 0)

    def test_consume_shared_contract_v1_without_reinventing_fields(self):
        sample = json.loads((HERE / '__tests__/fixtures/commander-contract-v1.json').read_text())
        self.assertEqual(sample['sample_version'], 1)
        envelope = {'task_id': sample['task']['id'], 'contract': sample['contract'], 'input': sample['task']['payload']['workflow_input']}
        discard = next(a for a in envelope['contract']['action_bindings'] if a['action'] == 'discard_existing_draft')
        actions.authorize(envelope, discard)
        self.assertEqual(sample['implementations']['skill']['verification_ref']['definition_sha256'], 'a' * 64)
        self.assertEqual(sample['evidence']['observed'], {'value': 1})
        envelope['input']['authorization']['object']['account_ref'] = 'wrong-account'
        with self.assertRaisesRegex(ValueError, 'authorization'):
            actions.authorize(envelope, discard)

    def test_probe_preserves_activity_and_step_failure_in_one_observation(self):
        spec = importlib.util.spec_from_file_location('gateway_multi', HERE / 'commander/wf-v2-gateway.py')
        gateway = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gateway)
        self.envelope['definition'].update(runtime_snapshot_sha256='e' * 64, expected_path=[{'reference_id': 'publish'}, {'reference_id': 'publish', 'step_id': 'step-1'}])
        self.envelope['contract']['action_bindings'][0]['readback'] = {'path': 'frozen-probe.py', 'digest': 'f' * 64, 'args': []}
        directory = self.home / 'wf-agent-runs/run-1'
        directory.mkdir(parents=True)
        (directory / 'envelope.json').write_text(json.dumps(self.envelope))
        self.store.record_execution('publish', 'code', 'unknown', {'value': 0})
        now = datetime.now(timezone.utc).isoformat()
        result = {'status': 'none', 'receipt': {'readback_source': 'isolated-probe'}, '_observed_started_at': now, '_observed_ended_at': now,
                  'activity_facts': [{'reference_id': 'publish', 'outcome': 'fail', 'observed': {'value': 0}}, {'reference_id': 'publish', 'step_id': 'step-1', 'outcome': 'fail', 'observed': {'value': 0}}]}
        with patch.dict(os.environ, HOME=str(self.home)):
            events = gateway.emit_readback(self.envelope, 'task-1:publish', result)
        self.assertEqual(len(events), 2)
        self.assertEqual([e['data']['outcome'] for e in events], ['fail', 'fail'])

    def test_explicit_skill_primary_can_run_without_a_code_partner(self):
        env = copy.deepcopy(self.envelope)
        activity = env['activity_bindings'][0]
        primary = dict(activity['implementations']['skill'], business_requirement_sha256=activity['implementations']['business_requirement_sha256'])
        activity.pop('implementations')
        activity['primary_implementation'] = primary
        store = actions.ActionStore(env, self.home)
        fact = store.record_execution('publish', 'skill', 'pass', {'value': 1})
        self.assertEqual(fact['execution_role'], 'primary')
        self.assertEqual(fact['implementation']['digest'], primary['implementation']['digest'])
        with self.assertRaises(ValueError):
            store.record_execution('publish', 'code', 'pass', {'value': 1})

    def test_policy_recovery_cannot_change_frozen_goal_input_or_total_budget(self):
        policy = self.home / 'policy.json'
        actions.install_policy(policy, self.envelope)
        actions.close_policy(policy, stopped=True)
        for mutate in [lambda e: e.update(deadline_at=time.time() + 1000),
                       lambda e: e['input']['authorization']['scope'].update(visibility='public'),
                       lambda e: e['definition'].update(snapshot_sha256='changed'),
                       lambda e: e['contract']['environment'].update(fingerprint='changed'),
                       lambda e: e.update(run_id='run-1')]:
            candidate = copy.deepcopy(self.envelope)
            candidate.update(run_id='run-2', owner_epoch=2, attempt=2)
            mutate(candidate)
            with self.assertRaises(ValueError):
                actions.install_policy(policy, candidate)

    def test_gateway_actual_code_failure_and_single_skill_record_reach_formal_events(self):
        spec = importlib.util.spec_from_file_location('gateway', HERE / 'commander/wf-v2-gateway.py')
        gateway = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gateway)
        def persist(env):
            directory = self.home / 'wf-agent-runs' / env['run_id']
            (directory / 'evidence').mkdir(parents=True)
            env['definition'].update(runtime_snapshot_sha256='e' * 64, expected_path=[{'reference_id': 'publish', 'activity_id': 'activity', 'activity_definition_version_id': 'version'}])
            for name, value in [('envelope', env), ('input', env['input']), ('contract', env['contract'])]:
                (directory / (name + '.json')).write_text(json.dumps(value))
            return directory
        directory = persist(self.envelope)
        with patch.dict(os.environ, HOME=str(self.home)):
            result = gateway.execute('primary', self.envelope, {'reference_id': 'publish', 'args': []})
            self.assertNotEqual(result['result']['exit_code'], 0)
            self.assertTrue(Path(result['evidence']['artifact']).is_file())
            events = json.loads((directory / 'events.json').read_text())
            self.assertEqual(events[0]['data']['outcome'], 'fail')
            self.assertEqual(events[0]['data']['evidence']['implementation']['kind'], 'code')
            self.assertEqual(events[0]['data']['evidence']['execution_role'], 'primary')
            env = copy.deepcopy(self.envelope)
            env.update(task_id='task-skill-only', run_id='run-skill-only')
            activity = env['activity_bindings'][0]
            activity['primary_implementation'] = dict(activity['implementations']['skill'], business_requirement_sha256=activity['implementations']['business_requirement_sha256'])
            activity.pop('implementations')
            skill_dir = persist(env)
            actions.ActionStore(env).admit()
            context = gateway.execute('primary', env, {'reference_id': 'publish'})
            started = datetime.now(timezone.utc).isoformat()
            actual = Path(context['skill']['path']).read_text()
            ended = datetime.now(timezone.utc).isoformat()
            gateway.execute('record', env, {'reference_id': 'publish', 'kind': 'skill', 'outcome': 'pass', 'observed': {'value': len(actual)}, 'started_at': started, 'ended_at': ended})
            event = json.loads((skill_dir / 'events.json').read_text())[0]
            self.assertEqual(event['data']['evidence']['execution_role'], 'primary')
            self.assertEqual(event['data']['evidence']['implementation']['kind'], 'skill')

    def test_code_exit_zero_stays_unknown_until_frozen_probe_reads_actual_work(self):
        spec = importlib.util.spec_from_file_location('gateway_probe', HERE / 'commander/wf-v2-gateway.py')
        gateway = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gateway)
        work = self.home / 'external-work.json'
        self.code.write_text('import json\nfrom pathlib import Path\nPath(' + repr(str(work)) + ').write_text(json.dumps({"work_id":"work-1","privacy":"private"}))\n')
        pair = self.envelope['activity_bindings'][0]['implementations']
        pair['code']['implementation']['digest'] = hashlib.sha256(self.code.read_bytes()).hexdigest()
        helper = HERE / '__tests__/fixtures/commander-work-readback.py'
        self.envelope['contract']['action_bindings'][0]['readback'] = {'path': '__tests__/fixtures/commander-work-readback.py', 'digest': hashlib.sha256(helper.read_bytes()).hexdigest(), 'args': [str(work), 'publish']}
        directory = self.home / 'wf-agent-runs' / 'run-1'
        (directory / 'evidence').mkdir(parents=True)
        self.envelope['definition'].update(runtime_snapshot_sha256='e' * 64, expected_path=[{'reference_id': 'publish'}])
        (directory / 'envelope.json').write_text(json.dumps(self.envelope))
        with patch.dict(os.environ, HOME=str(self.home)):
            result = gateway.execute('primary', self.envelope, {'reference_id': 'publish'})
            self.assertEqual(result['result']['exit_code'], 0)
            self.assertEqual(json.loads((directory / 'events.json').read_text())[0]['data']['outcome'], 'unknown')
            # 在隔离作用域中持久动作意图；读取独立fixture作品文件，不接受stdin PASS。
            with self.assertRaises(ConnectionError):
                self.store.execute('task-1:publish', lambda: (_ for _ in ()).throw(ConnectionError('lost response')))
            probe = actions.readback_helper(self.envelope, 'task-1:publish', HERE)
            events = gateway.emit_readback(self.envelope, 'task-1:publish', probe)
            self.assertEqual(events[0]['data']['outcome'], 'pass')
            self.assertEqual(events[0]['data']['evidence']['readback_receipt']['work_id'], 'work-1')
            facts = json.loads((directory / 'events.json').read_text())
            self.assertEqual([f['data']['outcome'] for f in facts], ['unknown', 'pass'])
            work.write_text(json.dumps({'work_id': 'work-1', 'privacy': 'private', 'business_valid': False}))
            failed_probe = actions.readback_helper(self.envelope, 'task-1:publish', HERE)
            gateway.emit_readback(self.envelope, 'task-1:publish', failed_probe)
            self.assertEqual([x['outcome'] for x in self.store.executions()], ['unknown', 'pass', 'fail'])
            proof = {'id': 'verify-task', 'parent_task_id': 'skill-business', 'status': 'completed', 'task_type': 'research',
                     'payload': {'verification_transport': 'openclaw-agent-v1', 'run_id': 'wfv-proof'},
                     'result': {'receipt': {'verification_runtime': {'provider': 'openai', 'model': 'gpt-6.1-sol', 'logical_run_id': 'wfv-proof', 'official_run_id': 'official-proof', 'rerouted': False}},
                                'workflow_verification': {'task_id': 'skill-business', 'run_id': 'verify-run', 'definition_sha256': 'f' * 64,
                                                          'verdict': 'PASS', 'execution_role': 'primary', 'implementation': pair['skill']['implementation'],
                                                          'environment': self.envelope['contract']['environment'], 'assertions': [{'name': 'actual_skill_result', 'pass': True}], 'evidence': ['source-original']}}}
            source = {'id': 'skill-business', 'status': 'completed', 'result': {'workflow_control': {'verify_task_id': 'verify-task', 'envelope': {
                'run_id': 'verify-run', 'definition': {'snapshot_sha256': 'f' * 64}, 'contract': {'environment': self.envelope['contract']['environment']},
                'activity_bindings': [{'primary_implementation': dict(pair['skill'], business_requirement_sha256=pair['business_requirement_sha256'])}]}}}}
            with patch.object(gateway.io, 'brain_read', side_effect=lambda path: proof if path.endswith('verify-task') else source):
                context = gateway.execute('takeover', self.envelope, {'reference_id': 'publish'})
            self.assertEqual(context['execution_role'], 'rescue')
            self.assertEqual(context['skill']['path'], str(self.skill))
            self.assertEqual(json.loads((directory / 'events.json').read_text())[-1]['data']['outcome'], 'fail')

    def test_gate_refuses_late_controller_even_if_original_device_owner_remains(self):
        policy = self.home / 'policy.json'
        actions.install_policy(policy, self.envelope)
        actions.check_policy(policy, 'run-1', 1, 'tap', 'task-1:publish')
        for run, epoch in [('run-1', 2), ('run-2', 1), ('', 1)]:
            with self.assertRaises(ValueError):
                actions.check_policy(policy, run, epoch, 'tap', 'task-1:publish')
        actions.close_policy(policy, stopped=False)
        with self.assertRaises(ValueError):
            actions.check_policy(policy, 'run-1', 1, 'tap', 'task-1:publish')

    def test_slow_controller_uses_frozen_budget_and_expired_budget_sends_nothing(self):
        spec = importlib.util.spec_from_file_location('phone_slow', HERE / 'commander/wf-v2-phone.py')
        phone_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(phone_module)
        env = copy.deepcopy(self.envelope)
        env['contract']['resources'].update(machine='xian-m4', profile='p1', device_serial='SER1')
        env['deadline_at'] = datetime.fromtimestamp(time.time() + 50, timezone.utc).isoformat()
        env['cleanup_deadline_at'] = datetime.fromtimestamp(time.time() + 80, timezone.utc).isoformat()
        ssh = self.home / 'ssh'
        log = self.home / 'ssh.log'
        ssh.write_text('#!/bin/sh\nprintf started >> "$TEST_SSH_LOG"\nsleep 26\nprintf actual-controller-result\n')
        ssh.chmod(0o755)
        phone = phone_module.Phone(self.home, env)
        phone.stage = 'preflight'
        with patch.dict(os.environ, PATH=str(self.home) + os.pathsep + os.environ['PATH'], TEST_SSH_LOG=str(log)):
            self.assertEqual(phone.ssh('isolated-read-only-controller'), b'actual-controller-result')
            before = log.read_bytes()
            phone.deadline = time.time() - 1
            with self.assertRaisesRegex(ValueError, 'budget exhausted'):
                phone.ssh('must-not-be-sent')
            self.assertEqual(log.read_bytes(), before)

    def test_actual_controller_checks_epoch_and_fence_before_any_adb(self):
        registry = self.home / 'registry.tsv'
        registry.write_text('p1\tSER1\tMODEL\t1199\t2663\n')
        adb = self.home / 'adb'
        log = self.home / 'adb.log'
        work = self.home / 'external-work.json'
        adb.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_ADB_LOG"\ncase "$*" in *get-state*) echo device;; *"getprop ro.product.model"*) echo MODEL;; *"dumpsys window"*) echo "mCurrentFocus=Window{abc u0 com.ss.android.ugc.aweme/.MainActivity}";; *"shell input tap"*) printf \'{"work_id":"work-1","privacy":"private"}\' > "$TEST_WORK";; *" pull "*) for last; do :; done; printf PNGDATA > "$last";; esac\nexit 0\n')
        adb.chmod(0o755)
        sips = self.home / 'sips'
        sips.write_text('#!/bin/sh\nfor last; do :; done\nprintf jpg > "$last"\n')
        sips.chmod(0o755)
        tmp = self.home / 'phone'
        lock = tmp / 'locks/SER1.lock'
        lock.mkdir(parents=True)
        (lock / 'owner').write_text('run-1\n')
        (lock / 'acquired_at').write_text(str(int(time.time())))
        policy = tmp / 'locks/SER1.commander.json'
        helper = HERE / '__tests__/fixtures/commander-work-readback.py'
        self.envelope['contract']['action_bindings'][0]['readback'] = {'path': '__tests__/fixtures/commander-work-readback.py', 'digest': hashlib.sha256(helper.read_bytes()).hexdigest(), 'args': [str(work)]}
        actions.install_policy(policy, self.envelope)
        env = dict(os.environ, HOME=str(self.home), DOUYIN_PHONE_REGISTRY=str(registry), DOUYIN_PHONE_TMP_ROOT=str(tmp),
                   DOUYIN_ADB_BIN=str(adb), DOUYIN_PYTHON_BIN=sys.executable, TEST_ADB_LOG=str(log),
                   DOUYIN_SIPS_BIN=str(sips), WF_COMMANDER_ACTION_KEY='task-1:publish', TEST_WORK=str(work))
        def call(owner, epoch, command='back', args=(), payload=None):
            return subprocess.run(['zsh', str(HERE / 'douyin-phone-adb'), '--profile', 'p1', '--lock-owner', owner, command, *args],
                                  env=dict(env, WF_COMMANDER_OWNER_EPOCH=str(epoch)), input=json.dumps(payload) if payload else None, capture_output=True, text=True, timeout=5)
        stale = call('run-1', 2, 'tap-evidence', ('--outward', 'publish', '10', '20', 'run-1-01-publish', '0'))
        self.assertNotEqual(stale.returncode, 0, stale.stdout + stale.stderr)
        self.assertFalse(log.exists(), 'stale child reached ADB')
        current = call('run-1', 1, 'open-app')
        self.assertEqual(current.returncode, 0, current.stdout + current.stderr)
        args = ('10', '20', 'run-1-01-publish', '0', '--outward', 'publish')
        published = call('run-1', 1, 'tap-evidence', args)
        self.assertEqual(published.returncode, 0, published.stdout + published.stderr)
        self.assertEqual(self.store.inspect('task-1:publish')['status'], 'unknown', 'tap success cannot pretend work readback')
        repeated = call('run-1', 1, 'tap-evidence', (*args, '--allow-repeat'))
        self.assertNotEqual(repeated.returncode, 0, repeated.stdout + repeated.stderr)
        self.assertEqual(log.read_text().count('shell input tap'), 1)
        identity = {'task_id': 'task-1', 'run_id': 'run-1', 'owner_epoch': 1}
        readback = call('run-1', 1, 'commander-readback', payload=dict(identity, key='task-1:publish'))
        self.assertEqual(readback.returncode, 0, readback.stdout + readback.stderr)
        self.assertEqual(json.loads(readback.stdout)['receipt']['work_id'], 'work-1')
        before = log.read_bytes()
        actions.close_policy(policy, stopped=False)
        late = call('run-1', 1, 'open-app')
        self.assertNotEqual(late.returncode, 0, late.stdout + late.stderr)
        self.assertEqual(log.read_bytes(), before, 'late controller wrote device after quarantine')
        self.assertEqual((lock / 'owner').read_text(), 'run-1\n')
        next_env = copy.deepcopy(self.envelope)
        next_env.update(run_id='run-2', owner_epoch=2, attempt=2)
        fence = call('run-1', 1, 'commander-fence', payload=dict(identity, execution_stopped=True))
        self.assertEqual(fence.returncode, 0, fence.stdout + fence.stderr)
        (lock / 'owner').write_text('run-2\n')
        rebound = call('run-2', 2, 'commander-bind', payload=next_env)
        self.assertEqual(rebound.returncode, 0, rebound.stdout + rebound.stderr)
        replay = call('run-2', 2, 'tap-evidence', args)
        self.assertEqual(replay.returncode, 0, replay.stdout + replay.stderr)
        self.assertEqual(log.read_text().count('shell input tap'), 1, 'new run re-published instead of using work readback')
        actions.close_policy(policy, stopped=True)
        (lock / 'owner').unlink()
        (lock / 'acquired_at').unlink()
        lock.rmdir()
        before = log.read_bytes()
        bare = subprocess.run(['zsh', str(HERE / 'douyin-phone-adb'), '--profile', 'p1', 'open-app'],
                              env=env, capture_output=True, text=True, timeout=5)
        self.assertNotEqual(bare.returncode, 0, 'closed policy was bypassed by anonymous late controller')
        self.assertEqual(log.read_bytes(), before, 'anonymous late controller reached ADB after lock release')


if __name__ == '__main__':
    unittest.main()
