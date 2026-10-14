import contextlib
import io
import hashlib
import sys
import subprocess
import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch
from subprocess import CompletedProcess

SPEC = importlib.util.spec_from_file_location('patrol_runner', pathlib.Path(__file__).with_name('runner.py'))
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class PatrolContractTests(unittest.TestCase):
    def test_mirror_busy_skip_requires_a_real_sync_receipt(self):
        receipt = {'observed_at': '2026-10-10T10:00:00Z', 'devices': {'errors': []}, 'errors': []}
        outputs = [CompletedProcess([], 0, ''), CompletedProcess([], 0, 'PostgreSQL pool configured: {\n  host: localhost\n}\n' + __import__('json').dumps(receipt) + '\n')]
        with patch.object(runner.subprocess, 'run', side_effect=outputs) as run, patch('time.sleep'):
            self.assertEqual(runner.sync_mirror(), receipt)
        self.assertEqual(run.call_count, 2)

    def test_mirror_missing_or_failed_receipt_cannot_confirm_sync(self):
        for output in ['', '{}', '{"observed_at":"now","devices":{"errors":["设备页失败"]},"errors":[]}']:
            with self.subTest(output=output), patch.object(runner.subprocess, 'run', return_value=CompletedProcess([], 0, output)), patch('time.sleep'):
                with self.assertRaises(RuntimeError):
                    runner.sync_mirror(max_attempts=1)

    def test_execution_identity_is_from_real_script_run(self):
        task = 'f8a71543-ad9a-4585-ba49-c8b16792ecfc'
        self.assertEqual(runner.task_from_script('/Users/a/brain-runs/script-' + task + '-a2.sh'), task)
        for bad in ['runner.py', 'script-not-a-uuid-a1.sh', 'script-' + task + '-a0.sh']:
            with self.assertRaises(ValueError):
                runner.task_from_script(bad)

    def test_batch_uses_registry_and_returns_queue_receipt(self):
        calls = []
        phones = [{'serial': 'phone-a', 'nickname': '甲', 'host': 'xian-m4', 'profile': 'a', 'enabled': True},
                  {'serial': 'phone-b', 'nickname': '乙', 'host': 'xian-m4', 'profile': 'b', 'enabled': False}]
        def api(path, body=None, method=None):
            calls.append((path, body))
            if path == 'phone-registry':
                return {'phones': phones}
            if path.startswith('tasks?'):
                return []
            if path == 'tasks':
                return {'id': 'child-a'}
            raise AssertionError(path)
        with tempfile.TemporaryDirectory() as d:
            receipt = runner.enqueue_batch(api, 'parent', pathlib.Path(d), 'workflow-single', 'rev123')
        self.assertEqual(receipt['status'], 'queued')
        self.assertEqual(len(receipt['children']), 1)
        body = next(b for p, b in calls if p == 'tasks')
        self.assertEqual(body['task_type'], 'script_run')
        self.assertEqual(body['parent_task_id'], 'parent')
        self.assertEqual(body['payload']['workflow_id'], 'workflow-single')
        self.assertIn('phone-a', body['payload']['cmd'])
        self.assertEqual(body['payload']['host'], 'mmv')
        self.assertNotIn('claude', body['payload']['cmd'])

    def test_batch_retry_uses_stable_server_idempotency_key(self):
        keys = []
        def api(path, body=None, method=None):
            if path == 'phone-registry':
                return {'phones': [{'serial': 'a', 'nickname': '甲', 'enabled': True}]}
            if path == 'tasks':
                keys.append(body['source_id'])
                return {'id': 'existing'}
            raise AssertionError('不依赖未经支持的列表过滤')
        with tempfile.TemporaryDirectory() as d:
            r = runner.enqueue_batch(api, 'parent', pathlib.Path(d), 'wf', 'rev')
            runner.enqueue_batch(api, 'parent', pathlib.Path(d), 'wf', 'rev')
        self.assertEqual(r['children'][0]['task_id'], 'existing')
        self.assertEqual(keys, ['phone-account-patrol:parent:a'] * 2)

    def test_incomplete_and_cross_device_results_fail_closed(self):
        good = {'serial': 'a', 'results': {p: {'state': '待确认'} for p in runner.ALL_PLATFORMS}}
        runner.validate_observation(good, 'a')
        for bad in [{'serial': 'b', 'results': good['results']}, {'serial': 'a', 'results': {'抖音': {'state': '已登录'}}}]:
            with self.assertRaises(ValueError):
                runner.validate_observation(bad, 'a')

    def test_busy_is_deferred_and_failure_is_not_success(self):
        self.assertEqual(runner.outcome({'抖音': {'state': '占用未查'}}), ('deferred', 0))
        self.assertEqual(runner.outcome({'抖音': {'state': '检测失败'}}), ('failed', 1))
        self.assertEqual(runner.outcome({'抖音': {'state': '未登录'}}), ('completed', 0))

    def test_watchdog_requires_execution_not_schedule_creation(self):
        schedule = {'id': 's', 'is_active': True}
        created = [{'recurring_task_id': 's', 'created_at': '2026-10-10T14:01:00+00:00', 'status': 'queued'}]
        self.assertEqual(runner.schedule_health(schedule, created, '2026-10-10T15:00:00+00:00')['status'], 'delayed')
        schedule['template'] = {'activated_at': '2026-10-10T09:00:00+00:00'}
        self.assertEqual(runner.schedule_health(schedule, [], '2026-10-10T09:30:00+00:00')['status'], 'awaiting_first_run')

    def test_watchdog_accepts_brain_utc_timestamps_on_native_python(self):
        schedule = {'id': 's', 'is_active': True, 'template': {'activated_at': '2026-10-10T09:00:00.000Z'}}
        self.assertEqual(runner.schedule_health(schedule, [], '2026-10-10T09:30:00.000Z')['status'], 'awaiting_first_run')

    def test_watchdog_checks_real_children_and_deferred_receipts(self):
        batch = {'id': 'b', 'status': 'completed', 'result': {'script': {'stdout': '{"children":[{"task_id":"p"}]}'}}}
        child = {'id': 'p', 'status': 'queued'}
        self.assertEqual(runner.batch_execution_health(batch, lambda path: child), 'delayed')
        child.update(status='failed')
        self.assertEqual(runner.batch_execution_health(batch, lambda path: child), 'failed')
        child.update(status='completed', result={'script': {'stdout': '{"status":"deferred"}'}})
        self.assertEqual(runner.batch_execution_health(batch, lambda path: child), 'deferred')
        child['result']['script']['stdout'] = '{"status":"completed"}'
        self.assertEqual(runner.batch_execution_health(batch, lambda path: child), 'healthy')

    def test_monitor_reads_recent_pages_without_historical_limit_failure(self):
        schedule = {'id': 's', 'is_active': True, 'template': {'activated_at': '2026-10-10T09:00:00.000Z'}}
        calls = []
        page = [{'id': 'p'+str(i), 'created_at': '2026-10-10T14:05:00Z'} for i in range(200)]
        def call(path, body=None, method=None):
            calls.append(path)
            if path == 'recurring-tasks':
                return [schedule]
            if path.startswith('tasks?'):
                return page if 'offset=0' in path else [{'id': 'old', 'created_at': '2026-10-09T10:00:00Z'}]
            if path.startswith('tasks/p'):
                return {'id': path.split('/')[-1], 'created_at': '2026-10-10T14:05:00Z', 'status': 'queued', 'payload': {}}
            raise AssertionError('不读取无关历史任务正文：'+path)
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory, patch.object(runner, 'api', call), patch.object(runner, 'STATE', pathlib.Path(directory)), patch.object(runner, 'now', lambda: '2026-10-10T14:15:00Z'):
            self.assertEqual(runner.monitor({'schedule_id': 's', 'project_id': 'project'}), 0)
        self.assertTrue(any('offset=200' in path for path in calls))
        self.assertNotIn('tasks/old', calls)

    def test_watchdog_disabled_and_missed_run_are_distinct(self):
        self.assertEqual(runner.schedule_health({'is_active': False}, [], '2026-10-10T15:00:00+00:00')['status'], 'disabled')
        schedule = {'id': 's', 'is_active': True, 'cron_expression': '0 22 * * *'}
        self.assertEqual(runner.schedule_health(schedule, [], '2026-10-10T15:00:00+00:00')['status'], 'missed')
        tasks = [{'recurring_task_id': 's', 'created_at': '2026-10-10T14:01:00+00:00', 'status': 'completed'}]
        self.assertEqual(runner.schedule_health(schedule, tasks, '2026-10-10T15:00:00+00:00')['status'], 'healthy')



ROOT = pathlib.Path(__file__).parent

class FailureEvidenceTests(unittest.TestCase):
    def test_deeply_nested_diagnostic_cannot_break_failure_reporting(self):
        cleaned = runner.safe_error_text('[' * 2000 + '0' + ']' * 2000)
        # Python's decoder stack limit varies; both safe omission paths are valid.
        self.assertRegex(cleaned, r'OMITTED|TRUNCATED')
        self.assertLess(len(cleaned), 2000)

    def test_preflight_adb_error_retains_device_error_and_checks_runner_hash(self):
        spec = importlib.util.spec_from_file_location('failure_preflight', ROOT / 'preflight.py')
        preflight = importlib.util.module_from_spec(spec); spec.loader.exec_module(preflight)
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            files = ['runner.py', 'collector.py', 'dispatch.py', 'preflight.py', 'publish.mjs', 'ocr.swift', 'SKILL.md', 'mirror.mjs']
            for name in files: (root / name).write_bytes((ROOT / name).read_bytes())
            manifest = {'sha256': {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in files}}
            (root / 'deployment.json').write_text(json.dumps(manifest))
            output = io.StringIO()
            with patch.object(preflight, '__file__', str(root / 'preflight.py')), patch.object(sys, 'argv', ['preflight', '--serial', 'phone-a']), \
                    patch.object(preflight.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'error: device phone-a not found')), contextlib.redirect_stdout(output):
                self.assertEqual(preflight.main(), 1)
            receipt = json.loads(output.getvalue())
            self.assertEqual(receipt['failure']['code'], 'adb_unreachable')
            self.assertIn('device phone-a not found', receipt['failure']['stderr'])
            (root / 'runner.py').write_text('changed dependency')
            output = io.StringIO()
            with patch.object(preflight, '__file__', str(root / 'preflight.py')), patch.object(sys, 'argv', ['preflight', '--serial', 'phone-a']), \
                    patch.object(preflight.subprocess, 'run') as adb, contextlib.redirect_stdout(output):
                self.assertEqual(preflight.main(), 1)
                adb.assert_not_called()
            self.assertEqual(json.loads(output.getvalue())['failure']['code'], 'source_version_mismatch')

    def test_quoted_secrets_basic_auth_and_url_userinfo_are_redacted(self):
        for text, secrets in [('{"password":"alpha beta gamma"}', ['alpha', 'beta', 'gamma']),
                              ('Authorization: Basic ZmFrZTpwYXNz', ['ZmFrZTpwYXNz']),
                              ('https://alice:fake-pass@example.test/path', ['alice', 'fake-pass']),
                              ('API_KEY="secret with spaces"', ['secret with spaces']),
                              ("{'password': 'alpha beta gamma'}", ['alpha', 'beta', 'gamma']),
                              ('password: "alpha beta gamma"', ['alpha', 'beta', 'gamma']),
                              (json.dumps({'log': json.dumps({'password': 'alpha beta gamma'})}), ['alpha', 'beta', 'gamma']),
                              ('probe started\n' + json.dumps({'log': json.dumps({'password': 'alpha beta gamma'})}), ['alpha', 'beta', 'gamma'])]:
            cleaned = runner.safe_error_text(text)
            for secret in secrets:
                self.assertNotIn(secret, cleaned)

    def test_remote_error_preserves_evidence_without_guessing_adb(self):
        output = subprocess.CompletedProcess([], 255, '', 'Permission denied (publickey).')
        with patch.object(runner.subprocess, 'run', return_value=output):
            with self.assertRaises(runner.PatrolFailure) as caught:
                runner.ssh('xian-m4', 'preflight', stage='preflight')
        failure = caught.exception.failure
        self.assertEqual(failure['code'], 'remote_execution_failed')
        self.assertEqual(failure['stage'], 'preflight')
        self.assertEqual(failure['exit_code'], 255)
        self.assertIn('Permission denied', failure['stderr'])

    def test_timeout_keeps_stage_and_partial_output(self):
        with patch.object(runner.subprocess, 'run', side_effect=subprocess.TimeoutExpired([], 60, output=b'partial', stderr=b'waiting')):
            with self.assertRaises(runner.PatrolFailure) as caught:
                runner.ssh('xian-m4', 'dispatch', stage='collect')
        self.assertEqual(caught.exception.failure['code'], 'remote_timeout')
        self.assertEqual(caught.exception.failure['stdout'], 'partial')
        self.assertEqual(caught.exception.failure['stage'], 'collect')

    def test_failed_preflight_json_is_saved_before_raising(self):
        check = {'ok': False, 'serial': 'phone-a', 'checks': {'adb_online': False},
                 'failure': {'stage': 'preflight', 'code': 'adb_unreachable', 'message': 'ADB无法连接设备',
                             'stderr': "error: device 'phone-a' not found", 'exit_code': 1}}
        output = subprocess.CompletedProcess([], 1, json.dumps(check), 'preflight failed')
        with tempfile.TemporaryDirectory() as directory, patch.object(runner, 'STATE', pathlib.Path(directory)), \
                patch.object(runner, 'api', return_value={'phones': [{'serial': 'phone-a', 'enabled': True, 'host': 'xian-m4'}]}), \
                patch.object(runner.subprocess, 'run', return_value=output):
            with self.assertRaises(runner.PatrolFailure) as caught:
                runner.phone_run('phone-a', 'task-a', {'remote_release': '/fixed'})
            self.assertEqual(caught.exception.failure['code'], 'adb_unreachable')
            self.assertEqual(json.loads((pathlib.Path(directory) / 'task-a.preflight.json').read_text()), check)

    def test_ssh_255_cannot_be_reclassified_from_partial_preflight_stdout(self):
        check = {'ok': False, 'serial': 'phone-a', 'checks': {'adb_online': False}}
        output = subprocess.CompletedProcess([], 255, json.dumps(check), 'connection reset')
        with patch.object(runner, 'api', return_value={'phones': [{'serial': 'phone-a', 'enabled': True, 'host': 'xian-m4'}]}), \
                patch.object(runner.subprocess, 'run', return_value=output):
            with self.assertRaises(runner.PatrolFailure) as caught:
                runner.phone_run('phone-a', 'task-a', {'remote_release': '/fixed'})
        self.assertEqual(caught.exception.failure['code'], 'remote_execution_failed')
        self.assertIn('connection reset', caught.exception.failure['stderr'])

    def test_failure_receipt_has_attempt_identity_and_redacted_bounded_logs(self):
        task = '11111111-1111-4111-8111-111111111111'
        error = runner.PatrolFailure('collect', 'remote_execution_failed', '远端失败', stderr='Authorization: Bearer SECRET\npassword=PASS\n' + 'x' * 12000)
        receipt = runner.failure_receipt(error, task, 'phone-a', {'single_workflow_id': 'wf', 'source_revision': 'rev'}, '/tmp/script-' + task + '-a2.sh')
        self.assertEqual(receipt['run_id'], 'script-' + task + '-a2')
        self.assertEqual(receipt['serial'], 'phone-a')
        self.assertNotIn('SECRET', json.dumps(receipt))
        self.assertNotIn('PASS', json.dumps(receipt))
        self.assertLessEqual(len(receipt['failure']['stderr']), 2000)



if __name__ == '__main__':
    unittest.main()
