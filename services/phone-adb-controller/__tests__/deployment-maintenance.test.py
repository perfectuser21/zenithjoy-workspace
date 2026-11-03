"""真实flock与原手机owner目录，部署不能回收正在使用的设备。"""
import fcntl
import base64
import importlib.util
import json
import io
import pwd
import runpy
import types
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
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

    def test_only_pinned_registry_generation_symlink_is_admitted_and_retarget_fails(self):
        generations = self.registry.parent / '.phone-registry-generations'
        first = generations / ('a' * 64) / 'profiles.tsv'
        first.parent.mkdir(parents=True)
        self.registry.rename(first)
        self.registry.symlink_to(first)
        self.acquire()
        self.module.verify(self.home, 't1', self.registry, self.locks)
        second = generations / ('b' * 64) / 'profiles.tsv'
        second.parent.mkdir(parents=True)
        second.write_bytes(first.read_bytes())
        self.registry.unlink()
        self.registry.symlink_to(second)
        with self.assertRaisesRegex(ValueError, 'registry|identity'):
            self.module.verify(self.home, 't1', self.registry, self.locks)
        self.registry.unlink()
        self.registry.symlink_to(self.home / 'untrusted.tsv')
        with self.assertRaisesRegex(ValueError, 'registry|symlink'):
            self.module.verify(self.home, 't1', self.registry, self.locks)

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

    def historical_review(self, *, unknown_owner=False):
        serials = ['SERIAL1', 'SERIAL2', 'e6c7ef34', 'FREE4']
        self.registry.write_text('#profile\tserial\tenabled\n' + ''.join(
            f'p{i}\t{serial}\ttrue\n' for i, serial in enumerate(serials)))
        old = self.home / 'historical-locks'
        old.mkdir()
        historical = '47.100.213.173:10001'
        for serial in [*serials, historical]:
            (old / (serial + '.guard')).touch()
        for serial in ['SERIAL1', 'SERIAL2', *([historical] if unknown_owner else [])]:
            owner = old / (serial + '.lock')
            owner.mkdir()
            for name, value in [('owner', serial + '-original'),
                                ('standalone_review_required', serial + '-original'), ('acquired_at', '1')]:
                (owner / name).write_text(value + '\n')
        durable = self.home / '.local/share/zenithjoy/phone-locks'
        self.module.lock_root_tool.migrate(old, durable)
        return old, durable, historical

    def test_historical_guard_snapshot_is_preserved_and_all_guards_are_locked(self):
        old, durable, historical = self.historical_review()
        before = [self.module.lock_root_tool.inventory(root) for root in (old, durable)]
        record = self.module.acquire(self.home, 't1', self.registry, durable)
        self.assertEqual(record['serials'], sorted(['SERIAL1', 'SERIAL2', 'e6c7ef34', 'FREE4']))
        self.assertEqual(len(record['guard_identity']), 10)
        with self.module.guards(record):
            for root in (old, durable):
                with (root / (historical + '.guard')).open('r+') as probe:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.module.verify(self.home, 't1', self.registry, durable)
        self.module.release(self.home, 't1', self.registry, durable)
        self.assertEqual([self.module.lock_root_tool.inventory(root) for root in (old, durable)], before)

    def test_busy_historical_guard_blocks_admission_without_writing_intent(self):
        old, durable, historical = self.historical_review()
        for root in (old, durable):
            with (root / (historical + '.guard')).open('r+') as held:
                fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaisesRegex(ValueError, 'busy'):
                    self.module.acquire(self.home, 't1', self.registry, durable)
        self.assertFalse((self.home / '.local/share/zenithjoy/phone-transactions/t1/maintenance.json').exists())

    def test_historical_guard_identity_replacement_refuses_saved_intent(self):
        old, durable, historical = self.historical_review()
        self.module.acquire(self.home, 't1', self.registry, durable)
        guard = old / (historical + '.guard')
        guard.rename(old / 'previous-guard')
        guard.touch()
        with self.assertRaisesRegex(ValueError, 'identity'):
            self.module.verify(self.home, 't1', self.registry, durable)

    def test_historical_snapshot_guard_drift_or_extra_owner_is_rejected(self):
        old, durable, historical = self.historical_review(unknown_owner=True)
        with self.assertRaisesRegex(ValueError, 'owner'):
            self.module.acquire(self.home, 't1', self.registry, durable)

    def test_historical_snapshot_bytes_drift_is_rejected(self):
        old, durable, historical = self.historical_review()
        (old / (historical + '.guard')).write_text('changed')
        (durable / (historical + '.guard')).write_text('changed')
        with self.assertRaisesRegex(ValueError, 'inventory|digest'):
            self.module.acquire(self.home, 't1', self.registry, durable)

    def test_current_registry_still_requires_every_guard_in_both_roots(self):
        old, durable, historical = self.historical_review()
        self.registry.write_text(self.registry.read_text() + 'new\tNEW_SERIAL\ttrue\n')
        with self.assertRaisesRegex(ValueError, 'registry'):
            self.module.acquire(self.home, 't1', self.registry, durable)

    def input_tool(self):
        spec = importlib.util.spec_from_file_location('input_review_snapshot', SERVICE / 'input-runtime-release.py')
        tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tool)
        return tool

    def test_input_barrier_locks_full_snapshot_and_keeps_other_owners(self):
        old, durable, historical = self.historical_review()
        before = [self.module.lock_root_tool.inventory(root) for root in (old, durable)]
        self.module.acquire(self.home, 't1', self.registry, durable)
        with self.input_tool().device_barrier(self.registry, durable, maintenance=(self.home, 't1')) as verify:
            verify()
            for root in (old, durable):
                with (root / (historical + '.guard')).open('r+') as probe:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.assertEqual([self.module.lock_root_tool.inventory(root) for root in (old, durable)], before)

    def test_input_barrier_rejects_busy_or_replaced_historical_guard(self):
        old, durable, historical = self.historical_review()
        self.module.acquire(self.home, 't1', self.registry, durable)
        tool = self.input_tool()
        with (old / (historical + '.guard')).open('r+') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(ValueError, 'busy'):
                with tool.device_barrier(self.registry, durable, maintenance=(self.home, 't1')):
                    self.fail('partial external barrier cannot enter')
        with tool.device_barrier(self.registry, durable, maintenance=(self.home, 't1')) as verify:
            guard = durable / (historical + '.guard')
            guard.rename(durable / 'previous-guard')
            guard.touch()
            with self.assertRaisesRegex(ValueError, 'identity|guard'):
                verify()

    def test_service_and_fence_actual_clis_consume_the_same_full_snapshot_record(self):
        old, durable, historical = self.historical_review()
        self.module.acquire(self.home, 't1', self.registry, durable)
        tx = self.module.transaction
        folder = tx.transaction_directory(self.home, 't1')
        body = {'schema_version': 1, 'transaction': 't1', 'home': str(self.home),
                'phase': 'prepared', 'identity': {'target': 'xian-m4'},
                'entries': [{'path': '.local/bin/unwritten-fixture',
                             'before': {'kind': 'missing'}, 'after': {'kind': 'missing'}}]}
        tx.atomic_bytes(folder / 'journal.json', tx.canonical({**body, 'sha256': tx.digest(tx.canonical(body))}))
        spec = importlib.util.spec_from_file_location('service_snapshot_fixture', SERVICE / 'deployment-service.py')
        service = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(service)
        file = {'kind': 'file', 'bytes': 'ZnJvemVuIHNlcnZpY2U=', 'mode': 0o644, 'uid': 0, 'gid': 0}
        service.prepare(folder / 'service.json', file,
                        lambda: {'file': file, 'loaded': False, 'disabled': True})
        original_pwd = pwd.getpwuid
        def cli(name, action, stdin=''):
            first = True
            def target_home(uid):
                nonlocal first
                if first:
                    first = False
                    return types.SimpleNamespace(pw_dir=str(self.home))
                # Only sandbox the CLI home lookup. Keep lock-root's separate
                # authoritative-home policy untouched; it must not target real files.
                return original_pwd(uid)
            output = io.StringIO()
            with patch.object(pwd, 'getpwuid', side_effect=target_home), \
                 patch.object(sys, 'argv', [name, action, 't1']), \
                 patch.object(sys, 'stdin', io.StringIO(stdin)), \
                 patch.object(sys, 'stdout', output), \
                 patch.object(subprocess, 'run', side_effect=AssertionError('no external commands in sandbox CLI')):
                runpy.run_path(str(SERVICE / name), run_name='__main__')
            return json.loads(output.getvalue())
        before = [self.module.lock_root_tool.inventory(root) for root in (old, durable)]
        intent = (folder / 'maintenance.json').read_bytes()
        self.assertTrue(cli('deployment-service.py', 'prepare', json.dumps({'file': file}))['verified'])
        for name in ('phone-candidates', 'phone-candidate-runs'):
            (self.home / '.local/share/zenithjoy' / name).mkdir()
        self.assertTrue(cli('deployment-candidate-fence.py', 'seal-if-review')['verified'])
        self.assertEqual([self.module.lock_root_tool.inventory(root) for root in (old, durable)], before)
        self.assertEqual((folder / 'maintenance.json').read_bytes(), intent)

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
        time.sleep(0.01)
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



class LegacyAliasTest(unittest.TestCase):
    """真实文件/内核锁，唯一沙箱；仅隔离机器特定路径及权限元数据。"""
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.base = Path(temp.name).resolve()
        self.home = self.base / 'home'
        self.home.mkdir()
        self.shared = self.base / 'shared-tmp'
        self.shared.mkdir(mode=0o1777)
        self.runtime = self.home / 'Library/Application Support/ZenithJoy/phone-runtime-20261011'
        self.physical = self.runtime / 'locks'
        self.physical.mkdir(parents=True)
        self.alias = self.shared / 'openclaw-phone'
        self.alias.symlink_to(self.runtime)
        self.logical = self.alias / 'locks'
        self.durable = self.home / 'durable-locks'
        self.registry = self.home / 'profiles.tsv'
        self.registry.write_text('#profile\tserial\tenabled\np1\tSERIAL1\ttrue\np2\tSERIAL2\ttrue\n')
        for serial in ['SERIAL1', 'SERIAL2', '47.100.213.173:10001']:
            (self.physical / (serial + '.guard')).touch()
        for serial in ['SERIAL1', 'SERIAL2']:
            owner = self.physical / (serial + '.lock')
            owner.mkdir()
            for name in ('owner', 'standalone_review_required', 'acquired_at'):
                (owner / name).write_text('1\n' if name == 'acquired_at' else serial + '-original\n')
        folder = self.home / '.local/share/zenithjoy/phone-transactions/t1'
        folder.mkdir(parents=True)
        (folder.parent / 'active.json').write_text('{"transaction":"t1"}')
        spec = importlib.util.spec_from_file_location('alias_maintenance', SERVICE / 'deployment-maintenance.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.module.lock_root_tool.migrate(self.logical, self.durable)
        # Actual symlink inodes/readlink/flock, no real /private/tmp paths are touched.
        self.original_spec = importlib.util.spec_from_file_location
        def spec_fixture(name, location, *args, **kwargs):
            result = self.original_spec(name, location, *args, **kwargs)
            if Path(location).name == 'deployment-maintenance.py':
                execute = result.loader.exec_module
                def load(module):
                    execute(module)
                    module.LEGACY_ALIAS = self.alias
                result.loader.exec_module = load
            return result
        self.start_patch(patch.object(self.module, 'LEGACY_ALIAS', self.alias, create=True))
        self.start_patch(patch('importlib.util.spec_from_file_location', spec_fixture))
        original_pwd = pwd.getpwuid
        self.start_patch(patch('pwd.getpwuid', lambda uid: types.SimpleNamespace(pw_dir=str(self.home)) if uid == os.getuid() else original_pwd(uid)))
        original_lstat = Path.lstat
        self.bad_metadata = {}
        def metadata(path, *args, **kwargs):
            info = original_lstat(path, *args, **kwargs)
            overrides = {}
            # Model the trusted production HOME parent chain on Linux too;
            # never chmod the host /tmp (or any ancestor of this sandbox).
            if path in self.base.parents:
                overrides = {'st_uid': 0, 'st_mode': 0o40755}
            if path == self.shared:
                overrides = {'st_uid': 0, 'st_mode': 0o41777}
            elif path == self.alias:
                overrides = {'st_uid': os.getuid(), 'st_gid': 0, 'st_mode': 0o120755}
            overrides.update(self.bad_metadata.get(path, {}))
            if not overrides:
                return info
            return types.SimpleNamespace(**{**{key: getattr(info, key) for key in dir(info) if key.startswith('st_')}, **overrides})
        self.start_patch(patch.object(Path, 'lstat', metadata))

    def acquire(self):
        return self.module.acquire(self.home, 't1', self.registry, self.durable)

    def start_patch(self, patcher):
        self.addCleanup(patcher.stop)
        return patcher.start()

    def replace_alias(self, target=None):
        self.alias.rename(self.shared / ('previous-' + str(time.time_ns())))
        self.alias.symlink_to(target or self.runtime)

    def assert_guards_free(self):
        for root in (self.physical, self.durable):
            for path in root.glob('*.guard'):
                with path.open('r+') as file:
                    fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def input_tool(self):
        spec = self.original_spec('alias_input', SERVICE / 'input-runtime-release.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_known_alias_keeps_logical_marker_but_locks_physical_full_snapshot(self):
        before = [self.module.lock_root_tool.inventory(root) for root in (self.logical, self.durable)]
        record = self.acquire()
        self.assertEqual(record['legacy_root'], str(self.logical))
        self.assertIn(str(self.physical / '47.100.213.173:10001.guard'), record['guard_identity'])
        with self.module.guards(record):
            for path in record['guard_identity']:
                with Path(path).open('r+') as file:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.module.verify(self.home, 't1', self.registry, self.durable)
        self.module.release(self.home, 't1', self.registry, self.durable)
        self.assertEqual(before, [self.module.lock_root_tool.inventory(root) for root in (self.logical, self.durable)])
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.module.canonical_path(self.logical)

    def test_changed_alias_before_all_locks_is_rejected(self):
        record = self.acquire()
        self.replace_alias()
        with self.assertRaisesRegex(ValueError, 'binding|alias|identity'):
            with self.module.guards(record):
                self.fail('changed alias entered barrier')
        self.assert_guards_free()

    def test_alias_change_during_locks_is_rejected_by_check(self):
        record = self.acquire()
        with self.assertRaisesRegex(ValueError, 'binding|alias|identity'):
            with self.module.guards(record) as verify:
                self.replace_alias()
                verify()
        self.assert_guards_free()

    def test_normal_and_exception_exit_recheck_binding_and_close_all_fds(self):
        record = self.acquire()
        for failure in (False, True):
            with self.subTest(exception=failure):
                if failure:
                    # Freeze the current alias identity for this independent context.
                    intent = self.home / '.local/share/zenithjoy/phone-transactions/t1/maintenance.json'
                    intent.unlink()
                    record = self.acquire()
                with self.assertRaisesRegex(ValueError, 'binding|alias|identity'):
                    with self.module.guards(record):
                        self.replace_alias()
                        if failure:
                            raise RuntimeError('caller failed')
                self.assert_guards_free()

    def test_input_normal_and_exception_exit_recheck_without_manual_verify(self):
        self.acquire()
        for failure in (False, True):
            with self.subTest(exception=failure):
                if failure:
                    (self.home / '.local/share/zenithjoy/phone-transactions/t1/maintenance.json').unlink()
                    self.acquire()
                with self.assertRaisesRegex(ValueError, 'binding|alias|identity'):
                    with self.input_tool().device_barrier(self.registry, self.durable, (self.home, 't1')):
                        self.replace_alias()
                        if failure:
                            raise RuntimeError('caller failed')
                self.assert_guards_free()

    def test_shared_tmp_ctime_is_not_a_frozen_identity(self):
        self.acquire()
        (self.shared / 'unrelated-app').touch()
        self.module.verify(self.home, 't1', self.registry, self.durable)

    def test_wrong_metadata_or_target_is_rejected_without_intent(self):
        for path, values in ((self.alias, {'st_uid': os.getuid() + 1}),
                             (self.alias, {'st_gid': 1}),
                             (self.alias, {'st_mode': 0o120777}),
                             (self.shared, {'st_mode': 0o40777}),
                             (self.runtime, {'st_mode': 0o40777})):
            with self.subTest(path=path, values=values):
                self.bad_metadata[path] = values
                with self.assertRaises(ValueError):
                    self.acquire()
                self.bad_metadata.clear()
        other = self.home / 'other-runtime'
        other.mkdir()
        self.replace_alias(other)
        with self.assertRaises(ValueError):
            self.acquire()
        self.assertFalse((self.home / '.local/share/zenithjoy/phone-transactions/t1/maintenance.json').exists())

    def test_physical_root_symlink_is_rejected(self):
        self.acquire()
        self.physical.rename(self.runtime / 'previous-locks')
        self.physical.symlink_to(self.runtime / 'previous-locks')
        with self.assertRaisesRegex(ValueError, 'symlink|binding|identity'):
            self.module.verify(self.home, 't1', self.registry, self.durable)

    def test_alias_removal_is_rejected(self):
        record = self.acquire()
        self.alias.unlink()
        with self.assertRaises((ValueError, FileNotFoundError)):
            with self.module.guards(record):
                self.fail('missing alias entered barrier')
        self.assert_guards_free()

    def test_same_bytes_physical_root_replacement_is_rejected(self):
        import shutil
        record = self.acquire()
        original = self.runtime / 'previous-locks'
        self.physical.rename(original)
        shutil.copytree(original, self.physical)
        self.assertEqual(self.module.lock_root_tool.inventory(original), self.module.lock_root_tool.inventory(self.physical))
        with self.assertRaisesRegex(ValueError, 'binding|identity'):
            with self.module.guards(record):
                self.fail('replacement physical directory entered barrier')
        self.assert_guards_free()

    def test_physical_ancestor_symlink_is_rejected(self):
        record = self.acquire()
        library = self.home / 'Library'
        moved = self.home / 'previous-library'
        library.rename(moved)
        library.symlink_to(moved)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            with self.module.guards(record):
                self.fail('physical ancestor symlink entered barrier')
        self.assert_guards_free()

    def test_final_guard_symlink_is_rejected(self):
        record = self.acquire()
        guard = self.physical / 'SERIAL1.guard'
        guard.unlink()
        guard.symlink_to(self.physical / 'SERIAL2.guard')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            with self.module.guards(record):
                self.fail('guard symlink entered barrier')

    def test_change_during_partial_lock_acquisition_never_enters_either_barrier(self):
        self.acquire()
        original_open = os.open
        for consumer in ('maintenance', 'input'):
            with self.subTest(consumer=consumer):
                if consumer == 'input':
                    (self.home / '.local/share/zenithjoy/phone-transactions/t1/maintenance.json').unlink()
                    self.acquire()
                record = self.module.context(self.home, 't1', self.registry, self.durable)
                changed = [False]
                def change_after_open(path, *args, **kwargs):
                    fd = original_open(path, *args, **kwargs)
                    if str(path).endswith('.guard') and not changed[0]:
                        changed[0] = True
                        self.replace_alias()
                    return fd
                with self.assertRaisesRegex(ValueError, 'binding|alias|identity'):
                    with patch('os.open', change_after_open):
                        barrier = (self.module.guards(record) if consumer == 'maintenance' else
                                   self.input_tool().device_barrier(self.registry, self.durable, (self.home, 't1')))
                        with barrier:
                            self.fail('partially frozen alias entered barrier')
                self.assertTrue(changed[0])
                self.assert_guards_free()

    def test_exact_legacy_path_as_real_directory_preserves_canonical_layout(self):
        self.alias.unlink()
        self.runtime.rename(self.alias)
        # Remove only the symlink permission fixture; model this real directory.
        self.bad_metadata[self.alias] = {'st_mode': 0o40755}
        before = [self.module.lock_root_tool.inventory(root) for root in (self.logical, self.durable)]
        record = self.acquire()
        self.assertNotIn('legacy_binding', record)
        self.assertIn(str(self.logical / 'SERIAL1.guard'), record['guard_identity'])
        self.module.verify(self.home, 't1', self.registry, self.durable)
        self.module.release(self.home, 't1', self.registry, self.durable)
        self.assertEqual(before, [self.module.lock_root_tool.inventory(root) for root in (self.logical, self.durable)])

    def test_existing_bound_alias_replaced_by_real_directory_is_rejected(self):
        import shutil
        record = self.acquire()
        self.alias.unlink()
        shutil.copytree(self.runtime, self.alias)
        self.bad_metadata[self.alias] = {'st_mode': 0o40755}
        with self.assertRaisesRegex(ValueError, 'binding|alias|identity'):
            with self.module.guards(record):
                self.fail('bound alias cannot downgrade to canonical directory')
        self.assert_guards_free()

    def test_unknown_intent_is_never_rewritten(self):
        intent = self.home / '.local/share/zenithjoy/phone-transactions/t1/maintenance.json'
        intent.write_text('{"unknown":"preserve me"}')
        with self.assertRaisesRegex(ValueError, 'identity'):
            self.acquire()
        self.assertEqual(intent.read_text(), '{"unknown":"preserve me"}')


if __name__ == '__main__':
    unittest.main()
