"""原生 infra agent 只登记冻结代码任务，结果只信中央真实身份。"""
import copy
import datetime as dt
import importlib.util
import json
import pathlib
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('patrol_openclaw_native', pathlib.Path(__file__).with_name('openclaw_native.py'))
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)
LEADER = '11111111-1111-4111-8111-111111111111'
BATCH = '22222222-2222-4222-8222-222222222222'
CHILD = '33333333-3333-4333-8333-333333333333'
REVIEW = '44444444-4444-4444-8444-444444444444'
PROJECT = '55555555-5555-4555-8555-555555555555'
WORKFLOW = '66666666-6666-4666-8666-666666666666'
SINGLE = '77777777-7777-4777-8777-777777777777'
SCHEDULE = '88888888-8888-4888-8888-888888888888'
ROUTING = '99999999-9999-4999-8999-999999999999'


class NativeCommanderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = pathlib.Path(self.temp.name)
        self.deployment = {'release': '/fixed/release', 'source_revision': native.bridge.PHONE_SOURCE_REVISION,
                           'project_id': PROJECT, 'batch_workflow_id': WORKFLOW, 'single_workflow_id': SINGLE, 'schedule_id': SCHEDULE}
        self.leader = {'id': LEADER, 'task_type': 'qiumi_task', 'status': 'in_progress', 'project_id': PROJECT,
            'payload': {'workflow_id': WORKFLOW, 'qiumi_department': 'infra', 'qiumi_route': {'source': 'explicit'},
            'source_revision': 'a' * 40, 'phone_source_revision': native.bridge.PHONE_SOURCE_REVISION,
            'recurring_task_id': SCHEDULE, 'recurring_slot': '2026-10-12T14:00:00Z', 'run_id': 'native-run-1'}}
        self.review = dict(copy.deepcopy(self.leader), id=REVIEW)
        self.review['payload']['workflow_id'] = native.bridge.MAINTENANCE_WORKFLOW_ID
        self.batch = None
        self.posts = []
        self.child = {'id': CHILD, 'parent_task_id': BATCH, 'project_id': PROJECT, 'task_type': 'script_run', 'status': 'failed',
            'payload': {'workflow_id': SINGLE, 'phone_serial': 'phone-a', 'routing_receipt_id': ROUTING,
                        'source_revision': native.bridge.PHONE_SOURCE_REVISION},
            'result': {'script': {'run_id': 'script-' + CHILD + '-a2', 'exit_code': 255, 'stdout': ''}}}

    def api(self, path, body=None):
        if path == 'tasks' and body is not None:
            self.posts.append(body)
            if self.batch is None:
                self.batch = dict(copy.deepcopy(body), id=BATCH, status='queued')
                self.batch.pop('source_id')
                self.batch['payload']['routing_receipt_id'] = ROUTING
            return {'id': BATCH}
        if path.startswith('tasks?'):
            return [self.leader]
        if path == 'tasks/' + LEADER:
            return self.leader
        if path == 'tasks/' + REVIEW:
            return self.review
        if path == 'tasks/' + BATCH:
            return self.batch
        if path == 'tasks/' + CHILD:
            return self.child
        raise AssertionError(path)

    def enqueue(self):
        return native.enqueue(LEADER, self.deployment, self.state, self.api)

    def completed_batch(self):
        self.enqueue()
        self.leader['status'] = 'completed'
        self.batch['status'] = 'completed'
        receipt = {'task_id': BATCH, 'source_revision': native.bridge.PHONE_SOURCE_REVISION, 'status': 'queued',
                   'children': [{'task_id': CHILD, 'serial': 'phone-a'}]}
        self.batch['result'] = {'script': {'stdout': json.dumps(receipt), 'run_id': 'script-' + BATCH + '-a1', 'exit_code': 0}}

    def test_enqueue_is_server_idempotent_code_only_and_preserves_schedule(self):
        first, second = self.enqueue(), self.enqueue()
        self.assertEqual(first['batch_task_id'], second['batch_task_id'])
        self.assertEqual(len(self.posts), 2)
        for body in self.posts:
            self.assertEqual(body['source_id'], 'OpenClaw:infra:' + LEADER + ':batch')
            self.assertEqual(body['parent_task_id'], LEADER)
            self.assertEqual(body['task_type'], 'script_run')
            self.assertFalse(body['payload']['runtime_requires_llm'])
            self.assertTrue(body['payload']['multi_task'])
            self.assertEqual(body['payload']['depends_on'], [])
            self.assertEqual(body['payload']['recurring_task_id'], SCHEDULE)
            self.assertEqual(body['payload']['recurring_slot'], '2026-10-12T14:00:00Z')
            self.assertIn('batch --execution-script "$0"', body['payload']['cmd'])
        self.assertNotIn('source_id', self.batch)
        for name in ['native-launch-' + LEADER + '.json', 'native-openclaw.latest.json']:
            self.assertEqual((self.state / name).stat().st_mode & 0o777, 0o600)

    def test_illegal_leader_never_registers_batch(self):
        for field, value in [('status', 'completed'), ('task_type', 'script_run'), ('project_id', WORKFLOW),
            ('qiumi_department', 'other'), ('workflow_id', SINGLE), ('source_revision', 'bad'), ('phone_source_revision', 'old')]:
            original = copy.deepcopy(self.leader)
            if field in ['status', 'task_type', 'project_id']:
                self.leader[field] = value
            else:
                self.leader['payload'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.enqueue()
            self.assertEqual(self.posts, [])
            self.leader = original

    def test_code_batch_get_readback_must_match_actual_parent_source_and_flow(self):
        self.enqueue()
        for field, value in [('parent_task_id', CHILD), ('source_revision', 'old'), ('workflow_id', SINGLE), ('routing_receipt_id', 'bad')]:
            original = copy.deepcopy(self.batch)
            if field == 'parent_task_id':
                self.batch[field] = value
            else:
                self.batch['payload'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.enqueue()
            self.batch = original

    def test_default_review_rejects_old_day_and_canary_slot(self):
        self.completed_batch()
        now = dt.datetime(2026, 10, 12, 14, 45, tzinfo=dt.timezone.utc)
        self.assertEqual(native.inspect(REVIEW, None, self.deployment, self.state, self.api, now)['batch_task_id'], BATCH)
        for slot, plan in [('2026-10-11T14:00:00Z', SCHEDULE), ('2026-10-12T13:00:00Z', SCHEDULE), ('2026-10-12T14:00:00Z', ROUTING)]:
            self.leader['payload']['recurring_slot'] = slot
            self.leader['payload']['recurring_task_id'] = plan
            with self.subTest(slot=slot, plan=plan), self.assertRaises(ValueError):
                native.inspect(REVIEW, None, self.deployment, self.state, self.api, now)

    def test_review_preserves_failure_exit_and_deferred_instead_of_fake_success(self):
        self.completed_batch()
        result = native.inspect(REVIEW, BATCH, self.deployment, self.state, self.api)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['children'][0]['status'], 'failed')
        self.assertEqual(result['children'][0]['exit_code'], 255)
        self.assertEqual(result['children'][0]['run_id'], 'script-' + CHILD + '-a2')
        self.child['status'] = 'completed'
        self.child['result']['script'].update(exit_code=0, stdout=json.dumps({'task_id': CHILD, 'status': 'deferred'}))
        self.assertEqual(native.inspect(REVIEW, BATCH, self.deployment, self.state, self.api)['status'], 'deferred')
        self.assertEqual((self.state / ('native-review-' + REVIEW + '.json')).stat().st_mode & 0o777, 0o600)

    def test_queued_batch_is_waiting_and_inspect_never_posts(self):
        self.enqueue()
        self.leader['status'] = 'completed'
        before = len(self.posts)
        result = native.inspect(REVIEW, BATCH, self.deployment, self.state, self.api)
        self.assertEqual(result['status'], 'waiting')
        self.assertEqual(result['batch_status'], 'queued')
        self.assertEqual(len(self.posts), before)

    def test_resolve_task_requires_unique_actual_session_run_identity(self):
        self.assertEqual(native.resolve_task('agent:infra:native-run-1', self.deployment, self.api), LEADER)
        for key in ['agent:infra:other-run', 'agent:other:native-run-1', 'agent:infra:native-run-1:fake']:
            with self.subTest(key=key), self.assertRaises(ValueError):
                native.resolve_task(key, self.deployment, self.api)
        with self.assertRaises(ValueError):
            native.resolve_task('agent:infra:native-run-1', self.deployment,
                lambda path: [self.leader, dict(copy.deepcopy(self.leader), id=CHILD)] if path.startswith('tasks?') else (dict(copy.deepcopy(self.leader), id=CHILD) if path == 'tasks/' + CHILD else self.api(path)))

    def test_unknown_child_business_outcome_is_not_completed(self):
        self.completed_batch()
        self.child['status'] = 'completed'
        self.child['result']['script'].update(exit_code=0, stdout='AI claimed success')
        self.assertEqual(native.inspect(REVIEW, BATCH, self.deployment, self.state, self.api)['status'], 'unknown')
        self.child['status'] = 'queued'
        self.assertEqual(native.inspect(REVIEW, BATCH, self.deployment, self.state, self.api)['status'], 'waiting')

    def test_review_parent_must_be_current_infra_maintenance_leader(self):
        self.completed_batch()
        for field, value in [('project_id', WORKFLOW), ('status', 'completed'), ('qiumi_department', 'other'), ('phone_source_revision', 'old')]:
            original = copy.deepcopy(self.review)
            if field in ['project_id', 'status']:
                self.review[field] = value
            else:
                self.review['payload'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                native.inspect(REVIEW, BATCH, self.deployment, self.state, self.api)
            self.review = original

    def test_missing_or_empty_explicit_route_is_rejected(self):
        for route in [None, {}, [], {'source': 'inferred'}]:
            self.leader['payload']['qiumi_route'] = route
            with self.subTest(route=route), self.assertRaises(ValueError):
                self.enqueue()
        self.assertEqual(self.posts, [])

    def test_nonzero_exit_overrides_claimed_completed_or_deferred(self):
        self.completed_batch()
        self.child['status'] = 'completed'
        for claimed in ['completed', 'deferred']:
            self.child['result']['script'].update(exit_code=255, stdout=json.dumps({'task_id': CHILD, 'status': claimed}))
            with self.subTest(claimed=claimed):
                self.assertEqual(native.inspect(REVIEW, BATCH, self.deployment, self.state, self.api)['status'], 'failed')
        self.child['result']['script']['exit_code'] = 0
        self.batch['result']['script']['exit_code'] = 1
        self.assertEqual(native.inspect(REVIEW, BATCH, self.deployment, self.state, self.api)['status'], 'failed')

    def test_completed_requires_real_run_and_zero_exit_for_batch_and_children(self):
        self.completed_batch()
        self.child['status'] = 'completed'
        self.child['result']['script'].update(exit_code=0, stdout=json.dumps({'task_id': CHILD, 'status': 'completed'}))
        for target, key in [('child', 'run_id'), ('child', 'exit_code'), ('batch', 'run_id'), ('batch', 'exit_code')]:
            task = self.child if target == 'child' else self.batch
            original = copy.deepcopy(task['result']['script'])
            task['result']['script'].pop(key)
            with self.subTest(target=target, key=key):
                self.assertEqual(native.inspect(REVIEW, BATCH, self.deployment, self.state, self.api)['status'], 'unknown')
            task['result']['script'] = original

    def test_parent_and_child_mismatch_cannot_be_reviewed(self):
        self.completed_batch()
        self.child['parent_task_id'] = LEADER
        with self.assertRaises(ValueError):
            native.inspect(REVIEW, BATCH, self.deployment, self.state, self.api)
        self.child['parent_task_id'] = BATCH
        self.review['payload']['workflow_id'] = SINGLE
        with self.assertRaises(ValueError):
            native.inspect(REVIEW, BATCH, self.deployment, self.state, self.api)


if __name__ == '__main__':
    unittest.main()
