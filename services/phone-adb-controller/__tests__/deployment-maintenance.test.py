"""真实flock与原手机owner目录，部署不能回收正在使用的设备。"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SERVICE = Path(__file__).resolve().parents[1]


class MaintenanceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.registry = self.home / '.config/openclaw/douyin-phone-profiles.tsv'
        self.registry.parent.mkdir(parents=True)
        self.registry.write_text('#profile\tserial\tenabled\np1\tSERIAL1\ttrue\np2\tSERIAL2\ttrue\n')
        self.locks = self.home / 'device-locks'
        self.locks.mkdir()
        for serial in ['SERIAL1', 'SERIAL2']:
            (self.locks / (serial + '.guard')).touch()
        directory = self.home / '.local/share/zenithjoy/phone-transactions/t1'
        directory.mkdir(parents=True)
        (directory.parent / 'active.json').write_text(json.dumps({'transaction': 't1'}))
        spec = importlib.util.spec_from_file_location('phone_maintenance', SERVICE / 'deployment-maintenance.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def acquire(self):
        return self.module.acquire(self.home, 't1', self.registry, self.locks)

    def test_quarantine_is_durable_and_exactly_released(self):
        self.acquire()
        for serial in ['SERIAL1', 'SERIAL2']:
            directory = self.locks / (serial + '.lock')
            self.assertEqual((directory / 'owner').read_text().strip(), 'phone-deploy-t1')
            self.assertEqual((directory / 'standalone_review_required').read_text().strip(), 'phone-deploy-t1')
        self.module.verify(self.home, 't1', self.registry, self.locks)
        self.module.release(self.home, 't1', self.registry, self.locks)
        self.assertFalse(list(self.locks.glob('*.lock')))

    def test_existing_owner_blocks_all_new_claims(self):
        old = self.locks / 'SERIAL2.lock'
        old.mkdir()
        (old / 'owner').write_text('business-run')
        with self.assertRaisesRegex(ValueError, 'owner'):
            self.acquire()
        self.assertFalse((self.locks / 'SERIAL1.lock').exists())
        self.assertEqual((old / 'owner').read_text(), 'business-run')

    def test_busy_kernel_guard_blocks_without_creating_owner(self):
        with (self.locks / 'SERIAL2.guard').open('r+') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(ValueError, 'guard'):
                self.acquire()
        self.assertFalse(list(self.locks.glob('*.lock')))

    def test_partial_acquire_can_resume_using_original_durable_intent(self):
        self.acquire()
        second = self.locks / 'SERIAL2.lock'
        for p in second.iterdir():
            p.unlink()
        second.rmdir()
        self.acquire()
        self.module.verify(self.home, 't1', self.registry, self.locks)

    def test_changed_owner_or_registry_never_releases_other_operator(self):
        self.acquire()
        owner = self.locks / 'SERIAL2.lock/owner'
        owner.write_text('other-owner')
        with self.assertRaisesRegex(ValueError, 'owner'):
            self.module.release(self.home, 't1', self.registry, self.locks)
        self.assertTrue((self.locks / 'SERIAL1.lock').exists())
        owner.write_text('phone-deploy-t1\n')
        self.registry.write_text(self.registry.read_text() + 'p3\tSERIAL3\ttrue\n')
        with self.assertRaisesRegex(ValueError, 'registry'):
            self.module.verify(self.home, 't1', self.registry, self.locks)

    def test_symlink_guard_or_registry_is_refused(self):
        guard = self.locks / 'SERIAL2.guard'
        guard.unlink()
        guard.symlink_to(self.locks / 'SERIAL1.guard')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.acquire()

    def test_input_pair_accepts_only_its_frozen_transaction_quarantine(self):
        self.acquire()
        spec = importlib.util.spec_from_file_location('input_release', SERVICE / 'input-runtime-release.py')
        tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tool)
        with self.assertRaisesRegex(ValueError, 'owner'):
            with tool.device_barrier(self.registry, self.locks):
                self.fail('legacy installer cannot bypass quarantine')
        with tool.device_barrier(self.registry, self.locks, maintenance=(self.home, 't1')) as verify:
            verify()
            (self.locks / 'SERIAL1.lock/owner').write_text('different owner')
            with self.assertRaisesRegex(ValueError, 'owner'):
                verify()

    def test_input_pair_maintenance_cannot_take_a_free_device_without_its_owner(self):
        spec = importlib.util.spec_from_file_location('input_release', SERVICE / 'input-runtime-release.py')
        tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tool)
        with self.assertRaises((ValueError, FileNotFoundError)):
            with tool.device_barrier(self.registry, self.locks, maintenance=(self.home, 't1')):
                self.fail('missing maintenance intent cannot authorize installation')

    def test_interrupted_retired_owner_cleanup_resumes_without_leaving_partial_directories(self):
        self.acquire()
        original = Path.unlink
        stopped = [False]
        def interrupted(path, *args, **kwargs):
            if path.parent.name.startswith('.phone-retired-') and path.name == 'standalone_review_required' and not stopped[0]:
                stopped[0] = True
                raise OSError('process lost during retired cleanup')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'unlink', interrupted):
            with self.assertRaises(OSError):
                self.module.release(self.home, 't1', self.registry, self.locks)
        self.module.release(self.home, 't1', self.registry, self.locks)
        self.assertFalse(list(self.locks.glob('.phone-retired-*')))
        self.assertFalse(list(self.locks.glob('*.lock')))
        self.acquire()
        self.module.verify(self.home, 't1', self.registry, self.locks)

    def test_unknown_retired_owner_refuses_release_before_other_owners_are_removed(self):
        self.acquire()
        retired = self.locks / '.phone-retired-t1-SERIAL1'
        retired.mkdir()
        (retired / 'owner').write_text('someone-else')
        with self.assertRaisesRegex(ValueError, 'owner'):
            self.module.release(self.home, 't1', self.registry, self.locks)
        self.assertEqual(len(list(self.locks.glob('*.lock'))), 2)
        self.assertEqual((retired / 'owner').read_text(), 'someone-else')


if __name__ == '__main__':
    unittest.main()
