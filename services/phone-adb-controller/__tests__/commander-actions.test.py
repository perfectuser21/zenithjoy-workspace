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
        self.envelope = {'task_id': 'task-1', 'run_id': 'run-1', 'attempt': 1, 'owner_epoch': 1,
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

    def test_actual_controller_checks_epoch_and_fence_before_any_adb(self):
        registry = self.home / 'registry.tsv'
        registry.write_text('p1\tSER1\tMODEL\t1199\t2663\n')
        adb = self.home / 'adb'
        log = self.home / 'adb.log'
        adb.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_ADB_LOG"\ncase "$*" in *get-state*) echo device;; *"getprop ro.product.model"*) echo MODEL;; *"dumpsys window"*) echo "mCurrentFocus=Window{abc u0 com.ss.android.ugc.aweme/.MainActivity}";; *" pull "*) for last; do :; done; printf PNGDATA > "$last";; esac\nexit 0\n')
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
        actions.install_policy(policy, self.envelope)
        env = dict(os.environ, HOME=str(self.home), DOUYIN_PHONE_REGISTRY=str(registry), DOUYIN_PHONE_TMP_ROOT=str(tmp),
                   DOUYIN_ADB_BIN=str(adb), DOUYIN_PYTHON_BIN=sys.executable, TEST_ADB_LOG=str(log),
                   DOUYIN_SIPS_BIN=str(sips), WF_COMMANDER_ACTION_KEY='task-1:publish')
        def call(owner, epoch, command='back', args=()):
            return subprocess.run(['zsh', str(HERE / 'douyin-phone-adb'), '--profile', 'p1', '--lock-owner', owner, command, *args],
                                  env=dict(env, WF_COMMANDER_OWNER_EPOCH=str(epoch)), capture_output=True, text=True, timeout=5)
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
        self.store.readback('task-1:publish', lambda: {'status': 'committed', 'receipt': {'work_id': 'work-1'}})
        before = log.read_bytes()
        actions.close_policy(policy, stopped=False)
        late = call('run-1', 1, 'open-app')
        self.assertNotEqual(late.returncode, 0, late.stdout + late.stderr)
        self.assertEqual(log.read_bytes(), before, 'late controller wrote device after quarantine')
        self.assertEqual((lock / 'owner').read_text(), 'run-1\n')
        self.store.close('official stopped', stopped=True)
        next_env = copy.deepcopy(self.envelope)
        next_env.update(run_id='run-2', owner_epoch=2, attempt=2)
        actions.close_policy(policy, stopped=True)
        actions.install_policy(policy, next_env)
        (lock / 'owner').write_text('run-2\n')
        actions.ActionStore(next_env, self.home).admit()
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
