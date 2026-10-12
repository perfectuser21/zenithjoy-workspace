"""回归：只有真实 Gateway 执行和中央子任务证据才能承认派发。"""
import contextlib
import fcntl
import datetime as dt
import copy
import hashlib
import importlib.util
import io
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('patrol_openclaw_commander', pathlib.Path(__file__).with_name('openclaw_commander.py'))
commander = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(commander)
TASK = '11111111-1111-4111-8111-111111111111'
CHILD = '22222222-2222-4222-8222-222222222222'
WF = '33333333-3333-4333-8333-333333333333'
PROJECT = '44444444-4444-4444-8444-444444444444'
BATCH = '55555555-5555-4555-8555-555555555555'


class OpenClawCommanderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = pathlib.Path(self.temp.name)
        self.release = self.state / 'releases' / commander.PHONE_SOURCE_REVISION
        self.release.mkdir(parents=True)
        for name in commander.EXPECTED_SHA256:
            (self.release / name).write_bytes(pathlib.Path(__file__).with_name(name).read_bytes())
        self.deployment = {'release': str(self.release), 'source_revision': commander.PHONE_SOURCE_REVISION,
                           'single_workflow_id': WF, 'batch_workflow_id': BATCH, 'project_id': PROJECT,
                           'schedule_id': '66666666-6666-4666-8666-666666666666',
                           'sha256': dict(commander.EXPECTED_SHA256)}
        manifest = {k: v for k, v in self.deployment.items() if k != 'release'}
        (self.release / 'deployment.json').write_text(json.dumps(manifest))
        (self.state / 'deployment-current.json').write_text(json.dumps(self.deployment))
        self.receipt = {'status': 'queued', 'task_id': TASK, 'source_revision': commander.PHONE_SOURCE_REVISION,
                        'children': [{'task_id': CHILD, 'serial': 'phone-a', 'phone': '小白'}]}
        self.child = {'id': CHILD, 'parent_task_id': TASK,
                      'project_id': PROJECT, 'task_type': 'script_run',
                      'payload': {'workflow_id': WF, 'source_revision': commander.PHONE_SOURCE_REVISION,
                                  'phone_serial': 'phone-a', 'routing_receipt_id': '77777777-7777-4777-8777-777777777777'}}
        self.calls = []

    def api(self, path):
        self.calls.append(path)
        if path == 'phone-registry':
            return {'phones': [{'serial': 'phone-a', 'enabled': True}, {'serial': 'disabled', 'enabled': False}]}
        if path == 'tasks/' + TASK:
            return {'id': TASK, 'status': 'in_progress', 'task_type': 'script_run', 'project_id': PROJECT,
                    'payload': {'workflow_id': BATCH, 'phone_source_revision': commander.PHONE_SOURCE_REVISION, 'source_revision': 'a' * 40}}
        if path == 'tasks/' + CHILD:
            return self.child
        raise AssertionError(path)

    def gateway(self, command, **kwargs):
        if command[0] == '/usr/bin/python3':
            self.assertEqual(command, ['/usr/bin/python3', str(self.release / 'runner.py'), 'batch', '--task-id', TASK])
            commander.save(self.state, 'batch-' + TASK + '.json', self.receipt)
            return subprocess.CompletedProcess(command, 0, json.dumps(self.receipt), '')
        self.assertEqual(command[:4], ['/opt/homebrew/bin/openclaw', 'agent', '--agent', 'infra'])
        self.assertNotIn('--local', command)
        self.assertIn('agent:infra:phone-patrol:' + TASK + ':launch', command)
        message = json.loads(command[command.index('--message') + 1])
        self.assertIn(' invoke --task-id ' + TASK, message['command'])
        self.assertIn('--nonce ' + message['nonce'], message['command'])
        self.assertIn('--task-id ' + TASK, message['command'])
        commander.invoke(TASK, message['nonce'], self.deployment, self.state, self.api)
        return subprocess.CompletedProcess(command, 0, json.dumps(self.envelope()), '')

    def envelope(self):
        return {'runId': 'gateway-run-1', 'status': 'ok', 'result': {'meta': {'aborted': False, 'agentMeta': {
            'sessionId': 'session-1', 'terminalReceipt': {'runId': 'gateway-run-1', 'sessionId': 'session-1',
            'successfulToolNames': ['gateway_exec']}}}}}

    def run_launch(self, gateway=None):
        with patch.object(commander.subprocess, 'run', side_effect=gateway or self.gateway):
            return commander.launch(TASK, commander.load_deployment(self.state), self.state, call=self.api)

    def test_identity_requires_absolute_real_script_name(self):
        self.assertEqual(commander.task_from_script('/tmp/script-' + TASK + '-a2.sh'), TASK)
        for path in ['runner.py', '../script-' + TASK + '-a1.sh', '/tmp/../script-' + TASK + '-a1.sh',
                     '/tmp/script-' + TASK + '-a0.sh', '/tmp/script-not-a-uuid-a1.sh', '/tmp/script-' + TASK + '-a1.sh/extra']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                commander.task_from_script(path)

    def test_frozen_release_pointer_and_manifest_must_match(self):
        for key, value in [('source_revision', 'f' * 40), ('release', str(self.state / 'elsewhere')), ('project_id', 'not-uuid')]:
            bad = dict(self.deployment, **{key: value})
            (self.state / 'deployment-current.json').write_text(json.dumps(bad))
            with self.subTest(key=key), self.assertRaises(ValueError):
                commander.load_deployment(self.state)
        (self.state / 'deployment-current.json').write_text(json.dumps(self.deployment))
        (self.release / 'runner.py').write_text('print("substituted")')
        with self.assertRaises(ValueError):
            commander.load_deployment(self.state)

    def test_forged_hash_map_cannot_relabel_changed_code_as_frozen_source(self):
        (self.release / 'runner.py').write_text('malicious replacement')
        forged = copy.deepcopy(self.deployment)
        forged['sha256']['runner.py'] = hashlib.sha256((self.release / 'runner.py').read_bytes()).hexdigest()
        (self.state / 'deployment-current.json').write_text(json.dumps(forged))
        (self.release / 'deployment.json').write_text(json.dumps({k: v for k, v in forged.items() if k != 'release'}))
        with self.assertRaises(ValueError):
            commander.load_deployment(self.state)

    def test_gateway_failure_never_falls_back_to_batch(self):
        with patch.object(commander.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'token secret')) as run:
            with self.assertRaises(RuntimeError):
                commander.launch(TASK, self.deployment, self.state, call=self.api)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0][0], '/opt/homebrew/bin/openclaw')
        self.assertFalse((self.state / ('batch-' + TASK + '.json')).exists())

    def test_parent_identity_must_be_real_running_registered_batch(self):
        for key, value in [('status', 'completed'), ('project_id', WF), ('task_type', 'dev'),
                           ('workflow_id', WF), ('source_revision', 'not-git'), ('phone_source_revision', 'old')]:
            def bad(path):
                task = self.api(path)
                if path == 'tasks/' + TASK:
                    if key in ['workflow_id', 'source_revision', 'phone_source_revision']:
                        task['payload'][key] = value
                    else:
                        task[key] = value
                return task
            with self.subTest(key=key), patch.object(commander.subprocess, 'run') as run, self.assertRaises(ValueError):
                commander.launch(TASK, self.deployment, self.state, bad)
            run.assert_not_called()

    def test_missing_enabled_phone_cannot_be_hidden_by_short_receipt(self):
        def two_phones(path):
            value = self.api(path)
            if path == 'phone-registry':
                value['phones'].append({'serial': 'phone-b', 'enabled': True})
            return value
        with patch.object(commander.subprocess, 'run', side_effect=self.gateway), self.assertRaises(ValueError):
            commander.launch(TASK, self.deployment, self.state, two_phones)

    def test_old_batch_cannot_count_as_new_gateway_action(self):
        commander.save(self.state, 'batch-' + TASK + '.json', self.receipt)
        with self.assertRaises((ValueError, FileNotFoundError)):
            self.run_launch(lambda *a, **k: subprocess.CompletedProcess([], 0, json.dumps(self.envelope()), ''))

    def test_old_review_cannot_count_as_new_gateway_inspection(self):
        commander.inspection(TASK, BATCH, self.deployment, self.state, self.review_api)
        with patch.object(commander.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(self.envelope()), '')):
            with self.assertRaises((ValueError, FileNotFoundError)):
                commander.review(BATCH, TASK, self.deployment, self.state, self.review_api)

    def test_ai_success_without_real_batch_receipt_is_failure(self):
        output = json.dumps(self.envelope())
        with self.assertRaises((ValueError, RuntimeError, FileNotFoundError)):
            self.run_launch(lambda *a, **k: subprocess.CompletedProcess([], 0, output, ''))

    def test_gateway_needs_real_top_level_run_id_and_success_status(self):
        for result in [{'status': 'ok'}, {'runId': 'r', 'status': 'accepted'}, {'runId': 'r', 'status': 'failed'},
                       {'result': {'runId': 'r', 'status': 'ok'}}, {'runId': 'r', 'status': 'unknown'}]:
            def fake(command, **kwargs):
                (self.state / ('batch-' + TASK + '.json')).write_text(json.dumps(self.receipt))
                return subprocess.CompletedProcess([], 0, json.dumps(result), '')
            with self.subTest(result=result), self.assertRaises(ValueError):
                self.run_launch(fake)

    def test_missing_aborted_or_unrelated_terminal_tool_receipt_is_rejected(self):
        for key, value in [('aborted', True), ('aborted', None), ('runId', 'other-run'), ('sessionId', 'other-session'), ('successfulToolNames', ['bash'])]:
            result = self.envelope()
            if key == 'aborted':
                result['result']['meta'][key] = value
            else:
                result['result']['meta']['agentMeta']['terminalReceipt'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.run_launch(lambda *a, **k: subprocess.CompletedProcess([], 0, json.dumps(result), ''))

    def test_wrong_or_missing_batch_identity_is_rejected(self):
        for field, value in [('task_id', CHILD), ('source_revision', 'old'), ('status', 'completed'), ('children', [])]:
            original = copy.deepcopy(self.receipt)
            self.receipt[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.run_launch()
            self.receipt = original

    def test_duplicate_or_unregistered_phone_or_child_is_rejected(self):
        for children in [[self.receipt['children'][0]] * 2,
                         [dict(self.receipt['children'][0], serial='wrong')],
                         [dict(self.receipt['children'][0], task_id='not-uuid')],
                         [dict(self.receipt['children'][0], task_id=TASK)]]:
            original = copy.deepcopy(self.receipt)
            self.receipt['children'] = children
            with self.subTest(children=children), self.assertRaises(ValueError):
                self.run_launch()
            self.receipt = original

    def test_brain_child_parent_source_workflow_and_serial_must_match(self):
        cases = [('parent_task_id', CHILD), ('payload.routing_receipt_id', 'not-uuid'), ('id', TASK), ('project_id', BATCH),
                 ('payload.workflow_id', BATCH), ('payload.source_revision', 'wrong'), ('payload.phone_serial', 'wrong')]
        for key, value in cases:
            original = copy.deepcopy(self.child)
            if key.startswith('payload.'):
                self.child['payload'][key.split('.')[1]] = value
            else:
                self.child[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.run_launch()
            self.child = original

    def test_api_failure_cannot_confirm_batch(self):
        def failing(path):
            if path == 'tasks/' + CHILD:
                raise RuntimeError('unavailable')
            return self.api(path)
        with patch.object(commander.subprocess, 'run', side_effect=self.gateway), self.assertRaises(RuntimeError):
            commander.launch(TASK, self.deployment, self.state, call=failing)

    def test_actual_task_api_without_source_id_uses_real_routing_receipt_uuid(self):
        self.assertNotIn('source_id', self.child)
        self.assertIn('routing_receipt_id', self.child['payload'])
        result = self.run_launch()
        self.assertEqual(result['children'][0]['task_id'], CHILD)
        for invalid in [None, '', 'not-uuid']:
            self.child['payload']['routing_receipt_id'] = invalid
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                self.run_launch()

    def test_success_keeps_monitor_children_and_private_commander_receipt(self):
        receipt = self.run_launch()
        self.assertEqual(receipt['children'], self.receipt['children'])
        self.assertEqual(receipt['status'], 'queued')
        self.assertEqual(receipt['commander']['agent_id'], 'infra')
        self.assertEqual(receipt['commander']['openclaw_run_id'], 'gateway-run-1')
        self.assertEqual(receipt['commander']['session_key'], 'agent:infra:phone-patrol:' + TASK + ':launch')
        self.assertIn('source_version', receipt['commander'])
        private = self.state / ('commander-' + TASK + '.launch.json')
        self.assertEqual(private.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('已经完成', private.read_text())
        self.assertIn('tasks/' + CHILD, self.calls)

    def test_cli_outputs_compatible_batch_as_final_line(self):
        output = io.StringIO()
        with patch.object(commander, 'STATE', self.state), patch.object(commander, 'api', side_effect=self.api), \
             patch.object(commander.subprocess, 'run', side_effect=self.gateway), contextlib.redirect_stdout(output):
            code = commander.main(['launch', '--execution-script', '/tmp/script-' + TASK + '-a1.sh'])
        self.assertEqual(code, 0)
        last = json.loads(output.getvalue().splitlines()[-1])
        self.assertEqual(last['children'], self.receipt['children'])
        self.assertEqual(last['commander']['openclaw_run_id'], 'gateway-run-1')

    def review_api(self, path):
        if path == 'tasks/' + BATCH:
            return {'id': BATCH, 'status': 'in_progress', 'task_type': 'script_run', 'project_id': PROJECT,
                    'payload': {'workflow_id': commander.MAINTENANCE_WORKFLOW_ID,
                    'phone_source_revision': commander.PHONE_SOURCE_REVISION, 'source_revision': 'a' * 40}}
        if path == 'tasks/' + TASK:
            task = self.api(path)
            task['status'] = 'completed'
            launched = dict(self.receipt, commander={'agent_id': 'infra', 'openclaw_run_id': 'real-launch-run',
                'session_key': 'agent:infra:phone-patrol:' + TASK + ':launch', 'source_version': commander.SOURCE_VERSION,
                'source_sha256': 'b' * 64})
            task['result'] = {'script': {'stdout': json.dumps(launched)}}
            return task
        if path == 'tasks/' + CHILD:
            task = dict(self.child, status='completed', result={'script': {'run_id': 'child-run-a1', 'exit_code': 0,
                'stdout': json.dumps({'task_id': CHILD, 'status': 'deferred'})}})
            return task
        return self.api(path)

    def test_review_rejects_old_python_batch_without_commander_provenance(self):
        def old_batch(path):
            value = self.review_api(path)
            if path == 'tasks/' + TASK:
                value['result'] = {'script': {'stdout': json.dumps(self.receipt)}}
            return value
        with self.assertRaises(ValueError):
            commander.inspection(TASK, BATCH, self.deployment, self.state, old_batch)
        def wrong_source(path):
            value = self.review_api(path)
            if path == 'tasks/' + TASK:
                value['payload'].pop('phone_source_revision')
            return value
        with self.assertRaises(ValueError):
            commander.inspection(TASK, BATCH, self.deployment, self.state, wrong_source)

    def test_review_requires_real_inspect_snapshot_and_preserves_business_deferred(self):
        def gateway(command, **kwargs):
            message = json.loads(command[command.index('--message') + 1])
            self.assertIn(' inspect --batch-task-id ' + TASK, message['command'])
            commander.inspection(TASK, BATCH, self.deployment, self.state, self.review_api, nonce=message['nonce'])
            return subprocess.CompletedProcess([], 0, json.dumps(self.envelope()), '')
        with patch.object(commander.subprocess, 'run', side_effect=gateway):
            result = commander.review(BATCH, TASK, self.deployment, self.state, self.review_api)
        self.assertEqual(result['children'][0]['business_status'], 'deferred')
        self.assertEqual(result['children'][0]['run_id'], 'child-run-a1')
        self.assertEqual(result['children'][0]['business_receipt'], {'task_id': CHILD, 'status': 'deferred'})
        self.assertEqual(result['children'][0]['exit_code'], 0)
        self.assertEqual(result['actor'], 'OpenClaw:infra')
        self.assertEqual(result['commander']['session_key'], 'agent:infra:phone-patrol:' + BATCH + ':review')

    def test_review_rejects_ai_only_result_or_fake_inspect_status(self):
        for fake_snapshot in [False, True]:
            def gateway(command, **kwargs):
                if fake_snapshot:
                    message = json.loads(command[command.index('--message') + 1])
                    value = commander.inspection(TASK, BATCH, self.deployment, self.state, self.review_api, persist=False)
                    value['children'][0]['status'] = 'failed'
                    commander.save_action(self.state, BATCH, 'review', message['nonce'], value)
                return subprocess.CompletedProcess([], 0, json.dumps(self.envelope()), '')
            with patch.object(commander.subprocess, 'run', side_effect=gateway), self.assertRaises((ValueError, FileNotFoundError)):
                commander.review(BATCH, TASK, self.deployment, self.state, self.review_api)

    def test_invoke_nonblocking_lock_refuses_concurrent_batch(self):
        with (self.state / ('commander-' + TASK + '.lock')).open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(commander.subprocess, 'run') as run, self.assertRaises(RuntimeError):
                commander.invoke(TASK, '88888888-8888-4888-8888-888888888888', self.deployment, self.state, self.api)
            run.assert_not_called()

    def test_nonce_and_bridge_hash_cannot_be_replaced_in_action_receipt(self):
        for field, wrong in [('nonce', CHILD), ('source_sha256', 'f' * 64), ('task_id', CHILD), ('mode', 'review')]:
            def fake(command, **kwargs):
                message = json.loads(command[command.index('--message') + 1])
                action = commander.save_action(self.state, TASK, 'launch', message['nonce'], self.receipt)
                action[field] = wrong
                commander.save(self.state, commander.action_name(TASK, 'launch', message['nonce']), action)
                return subprocess.CompletedProcess([], 0, json.dumps(self.envelope()), '')
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.run_launch(fake)

    def test_retry_has_new_nonce_and_preserves_previous_attempt_actions(self):
        first = self.run_launch()
        second = self.run_launch()
        a, b = first['commander']['attempt_nonce'], second['commander']['attempt_nonce']
        self.assertNotEqual(a, b)
        for nonce in [a, b]:
            path = self.state / commander.action_name(TASK, 'launch', nonce)
            self.assertTrue(path.exists())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_review_parent_must_match_project_maintenance_workflow_and_both_sources(self):
        for field, bad in [('project_id', TASK), ('workflow_id', WF), ('phone_source_revision', 'wrong'), ('source_revision', 'no-git')]:
            def wrong(path):
                value = self.review_api(path)
                if path == 'tasks/' + BATCH:
                    if field == 'project_id':
                        value[field] = bad
                    else:
                        value['payload'][field] = bad
                return value
            with self.subTest(field=field), patch.object(commander.subprocess, 'run') as run, self.assertRaises(ValueError):
                commander.review(BATCH, TASK, self.deployment, self.state, wrong)
            run.assert_not_called()

    def test_automatic_review_uses_only_verified_same_day_formal_launch(self):
        with self.assertRaises(ValueError):
            commander.resolve_batch(None, self.deployment, self.state, self.review_api)
        latest = dict(self.receipt, commander={'agent_id': 'infra', 'openclaw_run_id': 'verified-run'}, verified=True)
        commander.save(self.state, 'openclaw-commander.latest.json', latest)
        current = dt.datetime(2026, 10, 12, 14, 45, tzinfo=dt.timezone.utc)
        def formal(path):
            value = self.review_api(path)
            if path == 'tasks/' + TASK:
                value['payload']['recurring_task_id'] = self.deployment['schedule_id']
                value['payload']['recurring_slot'] = '2026-10-12T14:00:00.000Z'
            return value
        self.assertEqual(commander.resolve_batch(None, self.deployment, self.state, formal, current), TASK)
        for slot in ['2026-10-11T14:00:00Z', '2026-10-12T13:00:00Z']:
            def stale(path):
                value = formal(path)
                if path == 'tasks/' + TASK:
                    value['payload']['recurring_slot'] = slot
                return value
            with self.subTest(slot=slot), self.assertRaises(ValueError):
                commander.resolve_batch(None, self.deployment, self.state, stale, current)

    def test_timeout_is_unknown_not_gateway_cancellation_and_no_secret_output(self):
        output = io.StringIO()
        timeout = subprocess.TimeoutExpired('openclaw', 300, output='token secret', stderr='credential')
        with patch.object(commander, 'STATE', self.state), patch.object(commander, 'api', side_effect=self.api), \
             patch.object(commander.subprocess, 'run', side_effect=timeout), contextlib.redirect_stdout(output):
            code = commander.main(['launch', '--execution-script', '/tmp/script-' + TASK + '-a1.sh'])
        self.assertNotEqual(code, 0)
        receipt = json.loads(output.getvalue().splitlines()[-1])
        self.assertEqual(receipt['status'], 'unknown')
        self.assertEqual(receipt['reason'], 'gateway_timeout')
        self.assertFalse(receipt['gateway_cancelled'])
        self.assertNotIn('secret', output.getvalue())
        self.assertNotIn('credential', output.getvalue())


if __name__ == '__main__':
    unittest.main()
