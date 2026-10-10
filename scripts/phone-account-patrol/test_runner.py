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
        outputs = [CompletedProcess([], 0, ''), CompletedProcess([], 0, __import__('json').dumps(receipt))]
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


if __name__ == '__main__':
    unittest.main()
