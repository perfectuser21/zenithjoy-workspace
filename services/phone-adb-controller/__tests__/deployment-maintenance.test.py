"""真实flock与原手机owner目录，部署不能回收正在使用的设备。"""
import fcntl
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zlib

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

    def test_code_only_review_admission_preserves_old_and_durable_owners(self):
        spec = importlib.util.spec_from_file_location('phone_lock_root', SERVICE / 'phone-lock-root.py')
        root_tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(root_tool)
        old = self.home / 'old-locks'
        old.mkdir()
        for serial in ['SERIAL1', 'SERIAL2']:
            (old / (serial + '.guard')).touch()
        review = old / 'SERIAL1.lock'
        review.mkdir()
        for name, value in [('owner', 'frozen-run\n'), ('standalone_review_required', 'frozen-run\n'),
                            ('acquired_at', '1\n')]:
            (review / name).write_text(value)
        claim = old / 'standalone-claims/SERIAL1/frozen-run'
        claim.parent.mkdir(parents=True)
        claim.write_text('frozen-run\n')
        orphan = old / '.orphan-quarantine-old'
        orphan.mkdir()
        (orphan / 'owner').write_text('prior-run\n')
        durable = self.home / 'durable-locks'
        root_tool.migrate(old, durable)
        record = self.module.acquire(self.home, 't1', self.registry, durable)
        self.assertEqual(record['mode'], 'review-preserve')
        self.module.verify(self.home, 't1', self.registry, durable)
        spec = importlib.util.spec_from_file_location('input_release', SERVICE / 'input-runtime-release.py')
        input_tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(input_tool)
        with input_tool.device_barrier(self.registry, durable, maintenance=(self.home, 't1')) as verify_input:
            verify_input()
        self.module.release(self.home, 't1', self.registry, durable)
        self.assertEqual((review / 'owner').read_text(), 'frozen-run\n')
        self.assertEqual((durable / 'SERIAL1.lock/owner').read_text(), 'frozen-run\n')
        self.assertFalse((durable / 'SERIAL2.lock').exists())
        self.assertEqual(claim.read_text(), 'frozen-run\n')
        self.assertEqual((orphan / 'owner').read_text(), 'prior-run\n')
        claim.write_text('changed\n')
        with self.assertRaisesRegex(ValueError, 'inventory|digest|review'):
            self.module.verify(self.home, 't1', self.registry, durable)
        claim.write_text('frozen-run\n')
        guard = durable / 'SERIAL1.guard'
        guard.unlink()
        guard.touch()
        with self.assertRaisesRegex(ValueError, 'guard|identity'):
            self.module.verify(self.home, 't1', self.registry, durable)

    def test_frozen_candidate_is_atomically_sealed_and_stays_sealed_after_rollback(self):
        source = SERVICE / 'deployment-candidate-fence.py'
        spec = importlib.util.spec_from_file_location('candidate_fence', source)
        fence = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fence)
        root = self.home / '.local/share/zenithjoy/phone-candidate-runs'
        packages = self.home / '.local/share/zenithjoy/phone-candidates'
        package = packages / ('a' * 40)
        package.mkdir(parents=True)
        (package / 'run.sh').write_text('old launcher')
        frozen = root / ('a' * 40) / 'ledger' / 'old-run' / 'runtime'
        frozen.mkdir(parents=True)
        (frozen / 'douyin-phone-adb').write_text('old executable bytes')
        record = fence.seal(self.home, 't1')
        self.assertTrue(root.is_file(), 'frozen runtime directory must be replaced by a blocker file')
        self.assertTrue(packages.is_file(), 'old candidate directory must be replaced by a blocker file')
        self.assertEqual(packages.read_text(), 'PHONE_CANDIDATE_FENCE t1\n')
        self.assertEqual((Path(record['roots'][1]['sealed_path']) / ('a' * 40) / 'ledger' / 'old-run' /
                          'runtime/douyin-phone-adb').read_text(), 'old executable bytes')
        self.assertEqual((Path(record['roots'][0]['sealed_path']) / ('a' * 40) / 'run.sh').read_text(),
                         'old launcher')
        encoded = base64.b64encode(zlib.compress(json.dumps({'sha':'a' * 40}).encode())).decode()
        old_installer = subprocess.run([sys.executable, str(SERVICE / 'deployment-candidate-remote.py'),
                                        'presence', encoded], env={**os.environ, 'HOME':str(self.home)},
                                       capture_output=True, text=True)
        self.assertNotEqual(old_installer.returncode, 0,
                            'old candidate installer must reject blocker as a non-directory')
        self.assertEqual(fence.verify(self.home, 't1'), record)
        self.assertEqual(fence.seal(self.home, 't1'), record, 'interrupted seal resumes exact inode')
        root.unlink()
        root.mkdir()
        with self.assertRaisesRegex(ValueError, 'candidate|fence'):
            fence.verify(self.home, 't1')

    def test_candidate_seal_resumes_after_first_rename_without_reopening_old_entry(self):
        source = SERVICE / 'deployment-candidate-fence.py'
        spec = importlib.util.spec_from_file_location('candidate_fence', source)
        fence = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fence)
        parent = self.home / '.local/share/zenithjoy'
        for name in ('phone-candidates', 'phone-candidate-runs'):
            (parent / name).mkdir(parents=True)
        original = fence.exchange
        calls = [0]
        def crash_second(*args):
            calls[0] += 1
            if calls[0] == 2:
                raise OSError('process lost between atomic swaps')
            return original(*args)
        with patch.object(fence, 'exchange', crash_second):
            with self.assertRaisesRegex(OSError, 'process lost'):
                fence.seal(self.home, 't1')
        self.assertTrue((parent / 'phone-candidates').is_file())
        self.assertTrue((parent / 'phone-candidate-runs').exists())
        fence.seal(self.home, 't1')
        self.assertTrue((parent / 'phone-candidate-runs').is_file())
        self.assertEqual(fence.verify(self.home, 't1')['state'], 'sealed')


if __name__ == '__main__':
    unittest.main()
