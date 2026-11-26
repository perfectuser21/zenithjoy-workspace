"""共享真实性验证回归；不包含已取消的 CLI Agent 路径。"""
import concurrent.futures
import copy
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('patrol_shared_validation', pathlib.Path(__file__).with_name('openclaw_commander.py'))
shared = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(shared)
TASK = '11111111-1111-4111-8111-111111111111'
CHILD = '22222222-2222-4222-8222-222222222222'
WF = '33333333-3333-4333-8333-333333333333'
PROJECT = '44444444-4444-4444-8444-444444444444'


class SharedValidationTests(unittest.TestCase):
    def test_release_pin_promotes_known_package_and_keeps_prior_proof(self):
        previous_phone = '864154c57e88e8085d2add741a79103a28891a44'
        previous_control = 'f38c5a5635d2f57554efcfee4b09163d10cfe39b'
        self.assertEqual(shared.PHONE_SOURCE_REVISION, 'e3f8fc705e2c05db43f787711c31843ae080a458')
        self.assertEqual(shared.EXPECTED_SHA256['collector.py'], '7e0a29d0264f3ae8535ef1662886b69b76049eb7eb906a80bc9d98642ce07444')
        self.assertEqual(shared.ACCEPTED_RELEASES[previous_phone]['collector.py'], '501dd4af5358676473201ecbf8c3712db682e9a17128d52e3565021a3cb521f3')
        self.assertEqual(shared.HISTORICAL_CONTROL_SHA256[previous_control], '51f8ac3ff9f339536f2c07739c683b90e0811d7c2b99b31ad18b84ec0bc78213')

    def test_historical_loader_authenticates_known_hashes_without_changing_current_pointer(self):
        old = '4f899cab6425341646e27c5fca20979b8ac42be7'
        self.assertEqual(shared.ACCEPTED_RELEASES[old]['runner.py'], '26c5e6dc065b42f8298e485aca2492f25eb83b8a9650409ca3dc33b51798b9ce')
        self.assertEqual(shared.LEGACY_CONTROL_SHA256, '988f3f65522dbc9a0f33cf3161ca58e08981b6713e185972eb5d499dce58b596')
        historical = self.state / 'releases' / old;historical.mkdir()
        for name in self.fixture_hashes:(historical / name).write_bytes((self.release / name).read_bytes())
        manifest = dict(self.deployment, source_revision=old);manifest.pop('release')
        (historical / 'deployment.json').write_text(json.dumps(manifest))
        pointer = (self.state / 'deployment-current.json').read_bytes()
        with patch.dict(shared.ACCEPTED_RELEASES, {old: self.fixture_hashes}):
            accepted = shared.load_historical_deployment(self.state, old, self.deployment)
            self.assertEqual(accepted['source_revision'], old)
            with self.assertRaises(ValueError):shared.load_historical_deployment(self.state, old, dict(self.deployment, schedule_id=PROJECT))
            (historical / 'runner.py').write_text('tampered')
            with self.assertRaises(ValueError):shared.load_historical_deployment(self.state, old, self.deployment)
        self.assertEqual((self.state / 'deployment-current.json').read_bytes(), pointer)
        with self.assertRaises(ValueError):shared.load_historical_deployment(self.state, 'f' * 40, self.deployment)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = pathlib.Path(self.temp.name)
        self.release = self.state / 'releases' / shared.PHONE_SOURCE_REVISION
        self.release.mkdir(parents=True)
        self.fixture_hashes = {}
        for name in shared.EXPECTED_SHA256:
            content = f'frozen fixture payload for {name}\n'.encode()
            (self.release / name).write_bytes(content)
            self.fixture_hashes[name] = hashlib.sha256(content).hexdigest()
        fixture_release = patch.dict(shared.ACCEPTED_RELEASES, {shared.PHONE_SOURCE_REVISION: self.fixture_hashes})
        fixture_release.start()
        self.addCleanup(fixture_release.stop)
        self.deployment = {'release': str(self.release), 'source_revision': shared.PHONE_SOURCE_REVISION,
                           'single_workflow_id': WF, 'batch_workflow_id': TASK, 'project_id': PROJECT,
                           'schedule_id': CHILD, 'sha256': dict(self.fixture_hashes)}
        self.write_deployment(self.deployment)
        self.receipt = {'status': 'queued', 'task_id': TASK, 'source_revision': shared.PHONE_SOURCE_REVISION,
                        'children': [{'task_id': CHILD, 'serial': 'phone-a'}]}
        self.child = {'id': CHILD, 'parent_task_id': TASK, 'project_id': PROJECT, 'task_type': 'script_run',
                      'payload': {'workflow_id': WF, 'source_revision': shared.PHONE_SOURCE_REVISION,
                                  'phone_serial': 'phone-a', 'routing_receipt_id': PROJECT}}

    def write_deployment(self, value):
        (self.state / 'deployment-current.json').write_text(json.dumps(value))
        (self.release / 'deployment.json').write_text(json.dumps({k: v for k, v in value.items() if k != 'release'}))

    def api(self, path):
        if path == 'phone-registry':
            return {'phones': [{'serial': 'phone-a', 'enabled': True}]}
        if path == 'tasks/' + CHILD:
            return self.child
        raise AssertionError(path)

    def test_only_canonical_complete_uuid_is_accepted(self):
        self.assertEqual(shared.uuid(TASK), TASK)
        for bad in [None, '', 'tasks/' + TASK, TASK + '?extra=1', '../' + TASK]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                shared.uuid(bad)

    def test_frozen_deployment_requires_exact_release_all_hashes_and_ids(self):
        self.assertEqual(shared.load_deployment(self.state), self.deployment)
        for key, value in [('source_revision', 'f' * 40), ('release', str(self.state / 'elsewhere')), ('project_id', 'not-uuid')]:
            self.write_deployment(dict(self.deployment, **{key: value}))
            with self.subTest(key=key), self.assertRaises(ValueError):
                shared.load_deployment(self.state)
        self.write_deployment(self.deployment)
        (self.release / 'runner.py').write_text('substituted code')
        with self.assertRaises(ValueError):
            shared.load_deployment(self.state)

    def test_forged_manifest_cannot_relabel_changed_code_as_frozen_source(self):
        (self.release / 'runner.py').write_text('replacement')
        forged = copy.deepcopy(self.deployment)
        forged['sha256']['runner.py'] = hashlib.sha256((self.release / 'runner.py').read_bytes()).hexdigest()
        self.write_deployment(forged)
        with self.assertRaises(ValueError):
            shared.load_deployment(self.state)

    def test_atomic_private_save_survives_concurrent_receipts(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            paths = list(executor.map(lambda i: shared.save(self.state, 'latest.json', {'attempt': i}), range(12)))
        self.assertEqual(len(paths), 12)
        target = self.state / 'latest.json'
        self.assertIn(json.loads(target.read_text())['attempt'], range(12))
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(self.state.glob('latest.json.*.tmp')), [])

    def test_api_identity_is_read_back_without_inventing_source_id(self):
        self.assertNotIn('source_id', self.child)
        self.assertEqual(shared.verify_children(self.receipt, TASK, self.deployment, self.api), [self.child])
        for field, wrong in [('parent_task_id', CHILD), ('project_id', CHILD), ('id', TASK),
                ('workflow_id', TASK), ('source_revision', 'old'), ('phone_serial', 'wrong'), ('routing_receipt_id', 'bad')]:
            original = copy.deepcopy(self.child)
            if field in ['parent_task_id', 'project_id', 'id']:
                self.child[field] = wrong
            else:
                self.child['payload'][field] = wrong
            with self.subTest(field=field), self.assertRaises(ValueError):
                shared.verify_children(self.receipt, TASK, self.deployment, self.api)
            self.child = original

    def test_wrong_batch_empty_duplicate_or_missing_phone_is_rejected(self):
        for field, wrong in [('task_id', CHILD), ('source_revision', 'old'), ('children', []),
                             ('children', self.receipt['children'] * 2)]:
            original = copy.deepcopy(self.receipt)
            self.receipt[field] = wrong
            with self.subTest(field=field), self.assertRaises(ValueError):
                shared.verify_children(self.receipt, TASK, self.deployment, self.api)
            self.receipt = original
        def registry_missing(path):
            return {'phones': []} if path == 'phone-registry' else self.api(path)
        with self.assertRaises(ValueError):
            shared.verify_children(self.receipt, TASK, self.deployment, registry_missing)


if __name__ == '__main__':
    unittest.main()
