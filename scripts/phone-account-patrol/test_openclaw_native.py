"""原生 infra agent 只登记冻结代码任务，结果只信中央真实身份。"""
import copy
import datetime as dt
import importlib.util
import json
import pathlib
import tempfile
import unittest
import subprocess
import hashlib
import uuid as uuid_module
from unittest.mock import patch

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
        controller = self.state / 'controllers' / ('a' * 40) / 'openclaw_native.py'
        controller.parent.mkdir(parents=True);controller.write_bytes(pathlib.Path(__file__).with_name('openclaw_native.py').read_bytes())
        original_file = native.__file__;native.__file__ = str(controller)
        self.addCleanup(setattr, native, '__file__', original_file)
        original_root = native.bridge.CONTROL_RELEASES;native.bridge.CONTROL_RELEASES = (self.state / 'controllers').resolve()
        self.addCleanup(setattr, native.bridge, 'CONTROL_RELEASES', original_root)
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


class ContinuousRecoveryTests(unittest.TestCase):
    def test_nonformal_canary_candidate_and_pre_activation_phones_do_not_block_partition(self):
        for index, shape in enumerate([
            {'task_type':'script_run','status':'cancelled','created_at':'2026-10-12T08:41:27Z','parent_task_id':None,'payload':{'workflow_id':WORKFLOW,'source_revision':'2'*40,'recurring_task_id':ROUTING,'recurring_slot':'2026-10-12T08:41:00Z'}},
            {'task_type':'script_run','status':'completed','created_at':'2026-10-10T09:47:14Z','parent_task_id':ROUTING,'payload':{'workflow_id':SINGLE,'source_revision':'6'*40,'phone_serial':'phone-a'}},
            {'task_type':'script_run','status':'paused','created_at':'2026-10-10T09:05:40Z','parent_task_id':ROUTING,'payload':{'workflow_id':SINGLE,'source_revision':'1'*40,'phone_serial':'phone-a'}}]):
            task = dict(shape,id=str(uuid_module.UUID(int=500+index)),project_id=PROJECT)
            self.tasks[task['id']] = task
        self.cycle();self.assertEqual(len(self.demands()),1);self.assertEqual(len(self.attempts()),1)

    def test_formal_child_missing_workflow_cannot_escape_unknown_source_guard(self):
        self.tasks[CHILD]['payload'].pop('workflow_id')
        self.tasks[CHILD]['payload']['source_revision']='f'*40
        with self.assertRaises(ValueError):self.cycle()
        self.assertEqual(self.posts,[])

    def test_formal_demand_parent_cannot_hide_behind_foreign_origin_pointers(self):
        self.cycle();demand = self.demands()[0]
        demand['payload'].update(origin_task_id=REVIEW, origin_batch_task_id=REVIEW, phone_source_revision='f'*40)
        self.posts.clear()
        with self.assertRaises(ValueError):native.recovery_partition(list(self.tasks.values()), self.call('recurring-tasks')[0], self.deployment)
        self.assertEqual(self.posts,[])

    def test_formal_attempt_cannot_hide_as_attention_record(self):
        self.cycle();attempt = self.attempts()[0]
        attempt['payload'].update(recovery_attention=True, phone_source_revision='f'*40)
        self.posts.clear()
        with self.assertRaises(ValueError):self.cycle()
        self.assertEqual(self.posts,[])

    def test_unversioned_current_wrapper_cannot_self_attest_with_task_hash(self):
        self.cycle();demand = self.demands()[0];attempt = self.attempts()[0];attempt['status'] = 'in_progress'
        loose = self.state / 'unversioned' / 'openclaw_native.py';loose.parent.mkdir();loose.write_text('unversioned controller')
        loose = loose.resolve()
        attempt['payload'].update(cmd='/usr/bin/python3 ' + str(loose) + ' recovery-phone --demand-task-id ' + demand['id'] + ' --serial phone-a --execution-script "$0"',control_sha256=hashlib.sha256(loose.read_bytes()).hexdigest())
        with patch.object(native, '__file__', str(loose)), self.assertRaises(ValueError):
            native.recovery_phone('/tmp/script-' + attempt['id'] + '-a1.sh', demand['id'], 'phone-a', self.deployment, self.call, lambda *a, **k: self.fail('未验真入口不应运行手机'))

    def legacy_execution(self, probe, after_probe=None):
        old = native.bridge.LEGACY_PHONE_REVISION
        legacy = dict(self.deployment, source_revision=old, release='/fixed/old')
        self.tasks[BATCH]['payload'].update(source_revision=old, cmd='/usr/bin/python3 /fixed/old/runner.py batch --execution-script "$0"')
        self.tasks[CHILD]['payload']['source_revision'] = old
        with patch.object(native.bridge, 'load_historical_deployment', return_value=legacy):self.cycle()
        demand, attempt = self.demands()[0], self.attempts()[0];attempt['status'] = 'in_progress'
        commands = []
        def execute(command, **kwargs):
            commands.append(command)
            if command[0] == '/usr/bin/ssh':
                if after_probe:after_probe(demand)
                if isinstance(probe, Exception):raise probe
                return probe
            return subprocess.CompletedProcess([], 255, '', 'legacy runner failure')
        with patch.object(native.bridge, 'load_historical_deployment', return_value=legacy), patch.object(native, 'STATE', self.state):
            value, code = native.recovery_phone('/tmp/script-' + attempt['id'] + '-a1.sh', demand['id'], 'phone-a', self.deployment, self.call, execute)
        return value, code, commands

    def probe_output(self, code='adb_unreachable', serial='phone-a', returncode=1):
        checks = dict(source_version=True, ocr=True, device_lock_controller=True, pillow=True, adb_online=code is None)
        return subprocess.CompletedProcess([], returncode, json.dumps({'ok':code is None, 'serial':serial, 'checks':checks,
            'failure':{'code':code,'message':'device not found; password="fake secret"','stderr':'offline','exit_code':1} if code else None}), '')

    def test_legacy_adb_probe_records_distinct_diagnostic_identity_without_starting_old_runner(self):
        value, code, commands = self.legacy_execution(self.probe_output())
        self.assertEqual(len(commands),1);self.assertEqual(commands[0][0],'/usr/bin/ssh')
        self.assertIn(native.bridge.PHONE_SOURCE_REVISION, commands[0][-1])
        self.assertEqual(value['failure']['stage'],'legacy_pre_execution_preflight')
        self.assertEqual(value['failure']['code'],'adb_unreachable');self.assertNotEqual(code,0)
        self.assertIn('旧runner尚未启动',value['failure']['message'])
        self.assertIn(native.bridge.PHONE_SOURCE_REVISION,value['failure']['message'])
        self.assertNotIn('fake secret',json.dumps(value));self.assertEqual(value['source_revision'],native.bridge.LEGACY_PHONE_REVISION)
        proof = json.loads(next(self.state.glob('*.legacy-preflight.json')).read_text())
        self.assertEqual(proof['run_id'],value['run_id']);self.assertEqual(proof['diagnostic_source_revision'],native.bridge.PHONE_SOURCE_REVISION)
        self.assertEqual(proof['phone_source_revision'],native.bridge.LEGACY_PHONE_REVISION)
        self.assertEqual(proof['control_source_revision'],'a'*40);self.assertIn('observed_at',proof)

    def test_legacy_probe_transport_dependency_and_identity_failures_never_guess_adb(self):
        for probe in [self.probe_output(returncode=255), self.probe_output('prerequisite_failed'),
                      self.probe_output('source_version_mismatch'), self.probe_output('adb_check_timeout'),
                      self.probe_output(serial='foreign'), subprocess.CompletedProcess([],1,'not JSON','dependency missing'),
                      subprocess.TimeoutExpired(['ssh'],60,stderr='timed out')]:
            value, code, commands = self.legacy_execution(probe)
            self.assertEqual(len(commands),1);self.assertNotEqual(code,0)
            self.assertNotEqual(value['failure']['code'],'adb_unreachable')
            self.setUp()

    def test_legacy_probe_success_rechecks_cancellation_or_enabled_before_old_runner(self):
        for change, expected in [(lambda demand:demand.update(status='cancelled'),'stopped'),
                                 (lambda demand:setattr(self,'serial_enabled',False),'stopped'),
                                 (lambda demand:self.tasks[CHILD].update(status='in_progress'),'deferred')]:
            value, code, commands = self.legacy_execution(self.probe_output(None, returncode=0),change)
            self.assertEqual(len(commands),1);self.assertEqual(value['status'],expected);self.assertEqual(code,0)
            self.setUp()

    def test_current_phone_does_not_duplicate_its_own_preflight(self):
        self.cycle();demand, attempt = self.demands()[0],self.attempts()[0];attempt['status']='in_progress'
        commands=[]
        def execute(command, **kwargs):
            commands.append(command)
            return subprocess.CompletedProcess([],1,'','runtime failure')
        value, code = native.recovery_phone('/tmp/script-' + attempt['id'] + '-a1.sh', demand['id'], 'phone-a', self.deployment,self.call,execute)
        self.assertEqual(len(commands),1);self.assertEqual(commands[0][0],'/usr/bin/python3')
        self.assertEqual(value['failure']['code'],'phone_subprocess_failed')

    def test_successful_probe_does_not_claim_later_legacy_failure_root_cause(self):
        value, code, commands = self.legacy_execution(self.probe_output(None, returncode=0))
        self.assertEqual(len(commands),2);self.assertEqual(commands[1][1],'/fixed/old/runner.py')
        self.assertEqual(value['failure']['code'],'legacy_failure_detail_unavailable')
        self.assertIn('不是',value['failure']['message']);self.assertNotEqual(code,0)

    def test_old_phone_demand_continues_with_new_control_without_rewriting_identity(self):
        old = '4f899cab6425341646e27c5fca20979b8ac42be7'
        legacy = dict(self.deployment, source_revision=old, release='/fixed/old')
        self.tasks[BATCH]['payload'].update(source_revision=old, cmd='/usr/bin/python3 /fixed/old/runner.py batch --execution-script "$0"')
        self.tasks[CHILD]['payload']['source_revision'] = old
        original = copy.deepcopy(self.tasks[CHILD])
        with patch.object(native.bridge, 'load_historical_deployment', return_value=legacy, create=True):
            self.cycle()
        demand, attempt = self.demands()[0], self.attempts()[0]
        self.assertEqual(demand['payload']['phone_source_revision'], old)
        self.assertEqual(attempt['payload']['source_revision'], old)
        self.assertEqual(attempt['payload']['control_source_revision'], 'a' * 40)
        self.assertEqual(self.tasks[CHILD], original)
        attempt['status'] = 'in_progress'
        output = subprocess.CompletedProcess([], 0, json.dumps({'task_id': attempt['id'], 'serial': 'phone-a', 'source_revision': old, 'status': 'deferred'}), '')
        commands = []
        def execute(command, **kwargs):
            commands.append(command)
            return self.probe_output(None, returncode=0) if command[0] == '/usr/bin/ssh' else output
        with patch.object(native.bridge, 'load_historical_deployment', return_value=legacy, create=True), patch.object(native, 'STATE', self.state):
            value, _ = native.recovery_phone('/tmp/script-' + attempt['id'] + '-a1.sh', demand['id'], 'phone-a', self.deployment, self.call, execute)
        self.assertEqual(value['source_revision'], old)
        self.assertEqual(commands[0][0], '/usr/bin/ssh')
        self.assertEqual(commands[1][1], '/fixed/old/runner.py')
        # 新版成功不能拿来冒充旧需求的同版本完成证据。
        self.complete_phone(attempt)
        with patch.object(native.bridge, 'load_historical_deployment', return_value=legacy):self.cycle()
        self.assertEqual(demand['status'], 'blocked')
        fixed = copy.deepcopy(demand['payload']);demand['status'] = 'completed_no_pr'
        with patch.object(native.bridge, 'load_historical_deployment', return_value=legacy):
            result = self.cycle()
        self.assertEqual(demand['payload'], fixed)
        self.assertEqual(len({x['demand_task_id'] for x in result['recovery']['demands']}), len(result['recovery']['demands']))

    def test_historical_wrapper_proof_requires_original_control_revision_path_and_bytes(self):
        self.cycle();attempt = self.attempts()[0];self.complete_phone(attempt)
        root = (self.state / 'controllers').resolve();old = root / native.bridge.LEGACY_CONTROL_REVISION / 'openclaw_native.py';new = root / ('c' * 40) / 'openclaw_native.py'
        old.parent.mkdir(parents=True);new.parent.mkdir(parents=True);old.write_text('frozen old controller');new.write_text('new controller')
        attempt['payload'].update(cmd='/usr/bin/python3 ' + str(old) + ' recovery-phone --demand-task-id ' + self.demands()[0]['id'] + ' --serial phone-a --execution-script "$0"',
            control_sha256=hashlib.sha256(old.read_bytes()).hexdigest(), control_source_revision=native.bridge.LEGACY_CONTROL_REVISION)
        proof = lambda: native.bridge.phone_completion(attempt, 'phone-a', self.deployment, self.child['created_at'], self.tasks, self.current, new)
        with patch.object(native.bridge, 'LEGACY_CONTROL_SHA256', hashlib.sha256(old.read_bytes()).hexdigest()):
            self.assertIsNotNone(proof())
            attempt['payload']['control_source_revision'] = 'd' * 40
            self.assertIsNone(proof())
            attempt['payload']['control_source_revision'] = native.bridge.LEGACY_CONTROL_REVISION;old.write_text('changed after frozen receipt')
            self.assertIsNone(proof())
            attempt['payload']['control_sha256'] = hashlib.sha256(old.read_bytes()).hexdigest()
            self.assertIsNone(proof(), '任务自报hash与磁盘同时改写仍不得冒充已提交控制器')

    def test_unknown_phone_revision_fails_before_creating_any_recovery(self):
        self.tasks[CHILD]['payload']['source_revision'] = 'f' * 40
        with self.assertRaises(ValueError): self.cycle()
        self.assertEqual(self.posts, [])

    def test_failed_phone_receipt_survives_recovery_without_losing_reason(self):
        self.cycle(); demand = self.demands()[0]; attempt = self.attempts()[0]
        attempt['status'] = 'in_progress'
        script = '/tmp/script-' + attempt['id'] + '-a1.sh'
        receipt = {'status': 'failed', 'task_id': attempt['id'], 'run_id': pathlib.Path(script).stem,
                   'serial': 'phone-a', 'workflow_id': SINGLE, 'source_revision': native.bridge.PHONE_SOURCE_REVISION,
                   'failure': {'stage': 'preflight', 'code': 'adb_unreachable', 'message': 'ADB无法连接设备',
                               'stderr': 'device phone-a not found', 'exit_code': 1, 'evidence': []}}
        output = subprocess.CompletedProcess([], 1, json.dumps(receipt), 'failed')
        value, code = native.recovery_phone(script, demand['id'], 'phone-a', self.deployment, self.call, lambda *a, **k: output)
        self.assertEqual(value['failure']['code'], 'adb_unreachable')
        self.assertEqual(value['run_id'], pathlib.Path(script).stem)
        self.assertEqual(code, 1)
        for key, bad in [('task_id', CHILD), ('serial', 'foreign'), ('run_id', pathlib.Path(script).stem[:-1] + '2'), ('source_revision', 'wrong')]:
            wrong = dict(receipt, **{key: bad})
            value, code = native.recovery_phone(script, demand['id'], 'phone-a', self.deployment, self.call,
                lambda *a, **k: subprocess.CompletedProcess([], 1, json.dumps(wrong), 'real error'))
            self.assertEqual(value['failure']['code'], 'phone_subprocess_failed')
            self.assertNotEqual(value['failure']['code'], 'adb_unreachable')

    def setUp(self):
        NativeCommanderTests.setUp(self)
        self.current = dt.datetime(2026, 10, 13, 3, 30, tzinfo=dt.timezone.utc)
        self.batch = {'id': BATCH, 'status': 'completed', 'task_type': 'script_run', 'project_id': PROJECT, 'parent_task_id': None,
            'created_at': '2026-10-12T14:05:00Z', 'payload': {'workflow_id': WORKFLOW, 'source_revision': native.bridge.PHONE_SOURCE_REVISION,
            'runtime_requires_llm': False, 'cmd': '/usr/bin/python3 /fixed/release/runner.py batch --execution-script "$0"',
            'recurring_task_id': SCHEDULE, 'recurring_slot': '2026-10-12T14:00:00Z'},
            'result': {'script': {'run_id': 'script-' + BATCH + '-a1', 'exit_code': 0, 'stdout': json.dumps({
                'task_id': BATCH, 'status': 'queued', 'source_revision': native.bridge.PHONE_SOURCE_REVISION,
                'children': [{'task_id': CHILD, 'serial': 'phone-a'}]})}}}
        self.child['created_at'] = '2026-10-12T14:10:00Z'
        self.tasks = {BATCH: copy.deepcopy(self.batch), CHILD: copy.deepcopy(self.child), REVIEW: {
            'id': REVIEW, 'status': 'in_progress', 'task_type': 'script_run', 'project_id': PROJECT,
            'payload': {'workflow_id': native.bridge.MAINTENANCE_WORKFLOW_ID, 'source_revision': 'a' * 40, 'runtime_requires_llm': False}}}
        self.serial_enabled = True;self.serial_host = 'xian-m4'
        self.posts = []
        self.counter = 100
        self.router = 1
        self.keys = {}
        self.lose_post = False

    def call(self, path, body=None, method=None):
        if path == 'recurring-tasks':
            return [{'id': SCHEDULE, 'is_active': True, 'template': {'activated_at': '2026-10-11T02:04:22Z'}}]
        if path == 'phone-registry':
            return {'phones': [{'serial': 'phone-a', 'nickname': '白', 'enabled': self.serial_enabled, 'host': self.serial_host}]}
        if path.startswith('tasks?'):
            from urllib.parse import parse_qs
            query = parse_qs(path.split('?', 1)[1]);offset = int(query.get('offset', ['0'])[0]);limit = int(query.get('limit', ['200'])[0])
            return copy.deepcopy(list(self.tasks.values())[offset:offset + limit])
        if path == 'tasks' and body is not None:
            duplicate = next((t for t in self.tasks.values() if t.get('title') == body['title'] and t.get('project_id') == body['project_id'] and t['status'] in ['queued', 'in_progress', 'blocked']), None)
            if duplicate:return {'id': duplicate['id']}
            self.posts.append(copy.deepcopy(body));key = (self.router, body.get('source_id'))
            if key not in self.keys:
                self.counter += 1;task_id = str(uuid_module.UUID(int=self.counter));self.keys[key] = task_id
                task = copy.deepcopy(body);task.pop('source_id', None)
                task.update(id=task_id, created_at=self.current.isoformat(), result=task.get('result', {}), blocked_until=None)
                task.setdefault('status', 'queued');task['payload']['routing_receipt_id'] = ROUTING;self.tasks[task_id] = task
            task_id = self.keys[key]
            if self.lose_post:
                self.lose_post = False;raise TimeoutError('POST committed but reply lost')
            return {'id': task_id}
        if path.startswith('tasks/'):
            task_id = path.split('/')[1]
            if body is not None:
                self.assertEqual(method, 'PATCH');task = self.tasks[task_id]
                self.assertNotIn('payload', body, '固定身份禁止通过进度PATCH变更')
                if 'result' in body:task.setdefault('result', {}).update(copy.deepcopy(body['result']))
                for key in ['status', 'blocked_reason', 'blocked_until']:
                    if key in body:task[key] = body[key]
            return copy.deepcopy(self.tasks[task_id])
        raise AssertionError(path)

    def run_monitor(self, command, **kwargs):
        self.assertEqual(command, ['/usr/bin/python3', '/fixed/release/runner.py', 'monitor'])
        return subprocess.CompletedProcess(command, 0, json.dumps({'status': 'failed', 'batch_task_ids': [BATCH], 'maintenance_owner': '主理人'}), '')

    def cycle(self):
        self.assertTrue(callable(getattr(native, 'maintain', None)), '缺少持续维护入口；目前失败只记一次异常')
        return native.maintain(REVIEW, self.deployment, self.state, self.call, self.current, self.run_monitor)

    def demands(self):
        return [t for t in self.tasks.values() if t.get('payload', {}).get('recovery_demand')]

    def attempts(self):
        return [t for t in self.tasks.values() if t.get('payload', {}).get('recovery_demand_id') and t['task_type'] == 'script_run']

    def complete_phone(self, task, outcome='completed', exit_code=0, checked=None):
        task['status'] = 'completed' if exit_code == 0 else 'failed'
        task['completed_at'] = self.current.isoformat()
        task['result'] = {'script': {'run_id': 'script-' + task['id'] + '-a1', 'exit_code': exit_code,
            'stdout': json.dumps({'task_id': task['id'], 'status': outcome, 'serial': 'phone-a',
                'source_revision': native.bridge.PHONE_SOURCE_REVISION, 'checked_at': checked or self.current.isoformat(), 'workflow_id': SINGLE,
                'states': {'抖音': '已登录', '小红书': '已登录', '微信': '已登录', '快手': '已登录', '今日头条': '已登录', '知乎': '待确认', '微博': '已登录', 'B站': '已登录', '视频号': '待确认'},
                'evidence': ['/private/' + task['id'] + '.observation.json', '/private/' + task['id'] + '.publish.json', '/private/' + task['id'] + '.mirror.json', 'xian-m4:/private/evidence/central-' + task['id']]})}}

    def test_failed_previous_day_creates_blocked_demand_and_real_code_attempt(self):
        result = self.cycle();demand = self.demands()[0];attempt = self.attempts()[0]
        self.assertEqual(demand['task_type'], 'project');self.assertEqual(demand['status'], 'blocked');self.assertIsNone(demand['blocked_until'])
        self.assertEqual(demand['payload']['origin_task_id'], CHILD);self.assertEqual(demand['payload']['original_slot'], '2026-10-12T14:00:00Z')
        self.assertEqual(attempt['parent_task_id'], demand['id']);self.assertEqual(attempt['payload']['source_revision'], native.bridge.PHONE_SOURCE_REVISION)
        self.assertFalse(attempt['payload']['runtime_requires_llm']);self.assertNotIn('recurring_task_id', attempt['payload'])
        self.assertIn(' recovery-phone ', attempt['payload']['cmd']);self.assertEqual(result['legacy_health']['status'], 'failed')
        self.assertEqual(self.tasks[CHILD]['status'], 'failed')

    def test_failures_over_three_escalate_once_and_continue_with_hourly_backoff(self):
        self.cycle()
        for _ in range(5):
            attempt = self.attempts()[-1];self.complete_phone(attempt, 'failed', 255)
            self.current += dt.timedelta(hours=2);self.cycle()
        demand = self.demands()[0]
        self.assertEqual(demand['status'], 'blocked');self.assertGreaterEqual(len(self.attempts()), 6)
        attention = [t for t in self.tasks.values() if t.get('payload', {}).get('recovery_attention')]
        self.assertEqual(len(attention), 1);self.assertEqual(attention[0]['status'], 'blocked')
        self.assertGreaterEqual(demand['result']['recovery']['failure_count'], 3)
        self.assertEqual(self.tasks[CHILD]['status'], 'failed')

    def test_router_version_and_lost_post_reply_never_duplicate_demand_or_generation(self):
        self.lose_post = True;self.cycle();self.router = 2;self.cycle()
        self.assertEqual(len(self.demands()), 1);self.assertEqual(len(self.attempts()), 1)
        self.assertEqual(self.attempts()[0]['payload']['recovery_generation'], 1)

    def test_active_formal_phone_or_disabled_device_delays_recovery(self):
        self.tasks[CHILD]['status'] = 'in_progress';self.cycle()
        self.assertEqual(len(self.attempts()), 0)
        self.tasks[CHILD]['status'] = 'failed';self.serial_enabled = False;self.cycle()
        self.assertEqual(len(self.attempts()), 0);self.assertEqual(self.demands()[0]['status'], 'blocked')

    def test_later_genuine_success_closes_demand_without_changing_original_failure(self):
        self.cycle();demand = self.demands()[0];attempt = self.attempts()[0]
        self.current += dt.timedelta(minutes=45);self.complete_phone(attempt)
        self.cycle();self.assertEqual(self.tasks[demand['id']]['status'], 'completed_no_pr')
        self.assertEqual(self.tasks[demand['id']]['result']['recovery']['satisfied_by_task_id'], attempt['id'])
        self.assertEqual(self.tasks[CHILD]['status'], 'failed');self.cycle();self.assertEqual(len(self.attempts()), 1)

    def test_old_checked_time_or_wrong_serial_cannot_complete_demand(self):
        self.cycle();demand = self.demands()[0];attempt = self.attempts()[0]
        self.complete_phone(attempt, checked='2026-10-12T14:20:00Z');self.cycle()
        self.assertEqual(self.tasks[demand['id']]['status'], 'blocked')
        self.current += dt.timedelta(hours=2);self.cycle();latest = self.attempts()[-1];self.complete_phone(latest)
        receipt = json.loads(latest['result']['script']['stdout']);receipt['serial'] = 'other-phone';latest['result']['script']['stdout'] = json.dumps(receipt)
        self.cycle();self.assertEqual(self.tasks[demand['id']]['status'], 'blocked')

    def test_human_cancellation_stops_new_attempts_and_wrapper_device_execution(self):
        self.cycle();demand = self.demands()[0];attempt = self.attempts()[0];self.tasks[demand['id']]['status'] = 'cancelled'
        self.current += dt.timedelta(hours=2);self.cycle();self.assertEqual(len(self.attempts()), 1)
        self.assertTrue(callable(getattr(native, 'recovery_phone', None)), '缺少执行前取消守卫')
        attempt['status'] = 'in_progress'
        def forbidden(*args, **kwargs):raise AssertionError('取消后不能执行手机')
        value, code = native.recovery_phone('/tmp/script-' + attempt['id'] + '-a1.sh', demand['id'], 'phone-a', self.deployment, self.call, forbidden)
        self.assertEqual(value['status'], 'stopped');self.assertEqual(code, 0)

    def test_echo_success_missing_platforms_or_future_time_cannot_close(self):
        for fault in ['cmd', 'states', 'evidence', 'future']:
            self.setUp();self.cycle();attempt = self.attempts()[0];self.current += dt.timedelta(minutes=45);self.complete_phone(attempt)
            if fault == 'cmd':attempt['payload']['cmd'] = 'echo arbitrary-json'
            else:
                receipt = json.loads(attempt['result']['script']['stdout'])
                if fault == 'future':receipt['checked_at'] = (self.current + dt.timedelta(hours=2)).isoformat()
                else:receipt.pop(fault)
                attempt['result']['script']['stdout'] = json.dumps(receipt)
            self.cycle();self.assertEqual(self.demands()[0]['status'], 'blocked', fault)

    def test_legacy_monitor_failure_does_not_stop_persistent_recovery(self):
        self.assertTrue(callable(getattr(native, 'maintain', None)))
        result = native.maintain(REVIEW, self.deployment, self.state, self.call, self.current,
            lambda *a, **k: subprocess.CompletedProcess([], 1, '', 'legacy error'))
        self.assertEqual(result['status'], 'partial_failure');self.assertEqual(result['legacy_health']['status'], 'unknown')
        self.assertEqual(len(self.demands()), 1);self.assertEqual(len(self.attempts()), 1)

    def test_cancel_during_guard_and_disabled_device_have_no_phone_effect(self):
        self.cycle();demand = self.demands()[0];attempt = self.attempts()[0];attempt['status'] = 'in_progress'
        count = 0
        def cancelled(path, body=None, method=None):
            nonlocal count
            if path == 'tasks/' + demand['id']:
                count += 1
                if count == 2:self.tasks[demand['id']]['status'] = 'canceled'
            return self.call(path, body, method)
        def forbidden(*args, **kwargs):raise AssertionError('守卫必须在手机动作之前终止')
        value, code = native.recovery_phone('/tmp/script-' + attempt['id'] + '-a1.sh', demand['id'], 'phone-a', self.deployment, cancelled, forbidden)
        self.assertEqual(value['status'], 'stopped');self.assertEqual(code, 0)

    def test_fixed_current_configuration_can_resume_after_old_controller_error(self):
        self.cycle();attempt = self.attempts()[0];attempt['status'] = 'blocked';attempt['updated_at'] = self.current.isoformat();attempt['payload']['control_sha256'] = 'f' * 64
        self.current += dt.timedelta(hours=2);self.cycle()
        self.assertEqual(len(self.attempts()), 2)
        self.assertEqual(self.demands()[0]['status'], 'blocked')

    def test_same_phone_different_original_slots_get_distinct_attention_tasks(self):
        self.tasks[CHILD]['payload']['script_attempts'] = [{'run_id': 'script-' + CHILD + '-a' + str(i), 'exit_code': 255} for i in [1, 2, 3]]
        self.cycle()
        old_batch = copy.deepcopy(self.tasks[BATCH]);old_batch.update(id=LEADER, created_at='2026-10-11T14:05:00Z')
        old_batch['payload']['recurring_slot'] = '2026-10-11T14:00:00Z';self.tasks[LEADER] = old_batch
        old_phone = copy.deepcopy(self.tasks[CHILD]);old_phone.update(id=ROUTING, parent_task_id=LEADER, created_at='2026-10-11T14:10:00Z')
        old_phone['payload']['script_attempts'] = [{'run_id': 'script-' + ROUTING + '-a' + str(i), 'exit_code': 255} for i in [1, 2, 3]]
        self.tasks[ROUTING] = old_phone;self.cycle()
        self.assertEqual(len([t for t in self.tasks.values() if t.get('payload', {}).get('recovery_attention')]), 2)

    def test_authorized_manual_success_before_late_bookkeeping_covers_old_failure(self):
        task = copy.deepcopy(self.tasks[CHILD]);task.update(id=ROUTING, parent_task_id=CHILD, created_at=(self.current - dt.timedelta(minutes=5)).isoformat())
        task['payload'].update(host='mmv', runtime_requires_llm=False, recovery_origin_task_id=CHILD,
            cmd='/usr/bin/python3 /fixed/release/runner.py phone --serial phone-a --execution-script "$0"')
        self.complete_phone(task, checked=(self.current - dt.timedelta(minutes=1)).isoformat());self.tasks[ROUTING] = task
        result = self.cycle();self.assertEqual(len(self.demands()), 0)
        self.assertEqual(result['recovery']['covered_originals'][0]['satisfied_by_task_id'], ROUTING)
        self.assertEqual(self.tasks[CHILD]['status'], 'failed')

    def test_execution_guard_rejects_wrong_command_or_generation_before_phone(self):
        self.cycle();demand = self.demands()[0];attempt = self.attempts()[0];attempt['status'] = 'in_progress'
        for key, wrong in [('cmd', 'echo wrong-entry'), ('recovery_generation', 0), ('recovery_demand_id', CHILD), ('host', 'other')]:
            original = copy.deepcopy(attempt['payload']);attempt['payload'][key] = wrong
            def forbidden(*a, **k):raise AssertionError('错误执行身份不能碰手机')
            with self.subTest(key=key), self.assertRaises(ValueError):
                native.recovery_phone('/tmp/script-' + attempt['id'] + '-a1.sh', demand['id'], 'phone-a', self.deployment, self.call, forbidden)
            attempt['payload'] = original

    def test_closed_demand_handoff_has_complete_schema_without_synthesized_repair(self):
        self.cycle();attempt = self.attempts()[0];self.current += dt.timedelta(minutes=45);self.complete_phone(attempt);self.cycle()
        handoff = self.demands()[0]['result']['handoff']
        for key in ['title', 'verdict', 'done', 'not_done', 'artifacts', 'data_sources', 'decision_refs', 'initiative_id', 'journey_id', 'created_at']:
            self.assertIn(key, handoff)
        self.assertEqual(handoff['schema_version'], 1)
        self.assertEqual(handoff['next_steps'], [{'kind': 'note', 'title': '需求已满足，无下一步'}])
        self.assertEqual(set(handoff['artifacts']), {'pr_urls', 'sprint_dir', 'branch', 'docs'})
        self.assertEqual(self.demands()[0]['result']['recovery']['actor'], 'OpenClaw:infra')

    def test_empty_or_other_task_evidence_does_not_satisfy_demand(self):
        for evidence in [[None, None, None, None], ['', '', '', ''],
                ['/private/other.observation.json', '/private/other.publish.json', '/private/other.mirror.json', 'xian-m4:/private/evidence']]:
            self.setUp();self.cycle();attempt = self.attempts()[0];self.current += dt.timedelta(minutes=45);self.complete_phone(attempt)
            receipt = json.loads(attempt['result']['script']['stdout']);receipt['evidence'] = evidence;attempt['result']['script']['stdout'] = json.dumps(receipt)
            self.cycle();self.assertEqual(self.demands()[0]['status'], 'blocked')

    def test_real_infra_qiumi_leader_is_not_misidentified_as_frozen_script_batch(self):
        leader = copy.deepcopy(self.leader)
        leader.update(id=LEADER, created_at='2026-10-12T14:00:04.659Z', status='completed_no_pr')
        leader['payload'].update(runtime_requires_llm=True, recurring_task_id=SCHEDULE, recurring_slot='2026-10-12T14:00:00.000Z')
        self.tasks[LEADER] = leader;self.tasks[BATCH]['parent_task_id'] = LEADER
        try:self.cycle()
        except ValueError as error:self.fail('已验证infra领跑者不应按script批次校验：' + str(error))
        self.assertEqual(len(self.demands()), 1);self.assertEqual(len(self.attempts()), 1)
        self.assertEqual(self.demands()[0]['payload']['origin_batch_task_id'], BATCH)
        self.assertEqual(self.tasks[LEADER]['task_type'], 'qiumi_task')

    def test_matching_script_batch_wrong_frozen_identity_is_still_rejected(self):
        for key, wrong in [('source_revision', 'f' * 40), ('cmd', 'echo forged'), ('runtime_requires_llm', True)]:
            original = copy.deepcopy(self.tasks[BATCH]['payload']);self.tasks[BATCH]['payload'][key] = wrong
            with self.subTest(key=key), self.assertRaises(ValueError):self.cycle()
            self.tasks[BATCH]['payload'] = original
        self.assertEqual(self.posts, [])

    def test_existing_closed_manual_demand_is_not_recreated(self):
        self.cycle();demand = self.demands()[0];self.tasks[demand['id']]['status'] = 'completed_no_pr'
        self.current += dt.timedelta(days=1);self.cycle();self.assertEqual(len(self.demands()), 1);self.assertEqual(len(self.attempts()), 1)


if __name__ == '__main__':
    unittest.main()
