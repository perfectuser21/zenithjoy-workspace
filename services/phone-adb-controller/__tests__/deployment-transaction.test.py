"""真实临时文件系统：整包回退、崩溃重入与写入者冲突，绝不连接设备。"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'deployment-transaction.py'


class TransactionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        spec = importlib.util.spec_from_file_location('phone_transaction', SOURCE)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.target = self.home / 'bin-harvest/a.js'
        self.target.parent.mkdir()
        self.target.write_bytes(b'old verified runtime')
        self.target.chmod(0o755)
        self.new = b'candidate runtime'
        self.identity = {'target': 'mmv', 'source_commit': 'b' * 40,
                         'previous_source_commit': 'a' * 40,
                         'release_id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                         'previous_release_id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}
        self.tx = 'github-123-1'

    def file(self, path='bin-harvest/a.js', data=None):
        return {'path': path, 'after': {'kind': 'file', 'sha256': hashlib.sha256(data or self.new).hexdigest(), 'mode': 0o755}}

    def prepare(self, entries=None):
        return self.module.prepare(self.home, self.tx, entries or [self.file()], self.identity)

    def test_partial_install_restores_entire_previous_bytes_and_permissions(self):
        other = self.target.with_name('b.js')
        other.write_bytes(b'previous b')
        other.chmod(0o600)
        self.prepare([self.file(), self.file('bin-harvest/b.js')])
        self.target.write_bytes(self.new)
        self.target.chmod(0o755)
        self.module.rollback(self.home, self.tx)
        self.assertEqual(self.target.read_bytes(), b'old verified runtime')
        self.assertEqual(other.read_bytes(), b'previous b')
        self.assertEqual(other.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.module.read_transaction(self.home, self.tx)['phase'], 'restored')

    def test_new_file_removed_and_restore_is_repeatable(self):
        added = self.target.with_name('new.js')
        self.prepare([self.file(), self.file('bin-harvest/new.js')])
        added.write_bytes(self.new)
        added.chmod(0o755)
        self.module.rollback(self.home, self.tx)
        self.module.rollback(self.home, self.tx)
        self.assertFalse(added.exists())

    def test_unknown_writer_is_detected_before_any_restoration(self):
        other = self.target.with_name('b.js')
        other.write_bytes(b'previous b')
        self.prepare([self.file(), self.file('bin-harvest/b.js')])
        self.target.write_bytes(self.new)
        other.write_bytes(b'other operator')
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.module.rollback(self.home, self.tx)
        self.assertEqual(self.target.read_bytes(), self.new)
        self.assertEqual(other.read_bytes(), b'other operator')

    def test_corrupt_snapshot_cannot_overwrite_installed_runtime(self):
        record = self.prepare()
        backup = self.module.transaction_directory(self.home, self.tx) / 'blobs' / record['entries'][0]['before']['sha256']
        backup.write_bytes(b'corrupted backup')
        self.target.write_bytes(self.new)
        with self.assertRaisesRegex(ValueError, 'snapshot'):
            self.module.rollback(self.home, self.tx)
        self.assertEqual(self.target.read_bytes(), self.new)

    def test_resume_restoration_after_process_dies_between_files(self):
        second = self.target.with_name('b.js')
        second.write_bytes(b'previous b')
        second.chmod(0o755)
        self.prepare([self.file(), self.file('bin-harvest/b.js')])
        self.target.write_bytes(self.new)
        second.write_bytes(self.new)
        original = self.module.restore_entry
        count = 0
        def interrupted(*args, **kwargs):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError('process lost')
            return original(*args, **kwargs)
        with patch.object(self.module, 'restore_entry', interrupted):
            with self.assertRaisesRegex(OSError, 'process lost'):
                self.module.rollback(self.home, self.tx)
        self.module.rollback(self.home, self.tx)
        self.assertEqual(self.target.read_bytes(), b'old verified runtime')
        self.assertEqual(second.read_bytes(), b'previous b')

    def test_snapshot_fsync_failure_does_not_authorize_install(self):
        with patch.object(self.module.os, 'fsync', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.prepare()
        self.assertEqual(self.target.read_bytes(), b'old verified runtime')
        with self.assertRaises((ValueError, FileNotFoundError)):
            self.module.read_transaction(self.home, self.tx)

    def test_pending_transaction_blocks_other_attempt_and_identity_reuse(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError, 'pending'):
            self.module.prepare(self.home, 'github-124-1', [self.file()], self.identity)
        with self.assertRaisesRegex(ValueError, 'identity'):
            self.module.prepare(self.home, self.tx, [self.file()], {**self.identity, 'source_commit': 'c' * 40})

    def test_commit_requires_every_expected_file_and_recover_keeps_commit(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError, 'installed'):
            self.module.commit(self.home, self.tx)
        self.target.write_bytes(self.new)
        self.module.commit(self.home, self.tx)
        with self.assertRaisesRegex(ValueError, 'explicit'):
            self.module.rollback(self.home, self.tx)
        self.module.rollback(self.home, self.tx, explicit=True)
        self.assertEqual(self.target.read_bytes(), b'old verified runtime')

    def test_path_traversal_and_symlink_parent_rejected(self):
        for path in ['../outside', '/tmp/outside', 'bin-harvest/../outside', '.credentials/token']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.prepare([self.file(path)])
        (self.target.parent / 'linked').symlink_to(self.home, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.prepare([self.file('bin-harvest/linked/other')])

    def test_journal_directory_symlink_is_not_followed(self):
        directory = self.home / '.local/share/zenithjoy/phone-transactions'
        directory.parent.mkdir(parents=True)
        directory.symlink_to(self.home, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.prepare()

    def test_dynamic_manifest_change_is_authorized_before_write_without_losing_before(self):
        self.prepare()
        final = b'official observation ACK'
        value = self.file(data=final)['after']
        self.module.authorize(self.home, self.tx, 'bin-harvest/a.js', value)
        self.target.write_bytes(final)
        self.module.rollback(self.home, self.tx)
        self.assertEqual(self.target.read_bytes(), b'old verified runtime')

    def test_authorize_cannot_add_untracked_path_or_change_after_external_write(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError, 'write set'):
            self.module.authorize(self.home, self.tx, 'bin-harvest/unrecorded.js', self.file()['after'])
        self.target.write_bytes(b'unknown writer')
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.module.authorize(self.home, self.tx, 'bin-harvest/a.js', self.file()['after'])

    def test_failed_admission_marker_persistence_can_resume_only_before_any_write(self):
        original = self.module.atomic_bytes
        def fail_marker(path, *args, **kwargs):
            if path.name == 'active.json':
                raise OSError('disk full before marker')
            return original(path, *args, **kwargs)
        with patch.object(self.module, 'atomic_bytes', fail_marker):
            with self.assertRaises(OSError):
                self.prepare()
        self.prepare()
        self.module.rollback(self.home, self.tx)

    def test_release_barrier_requires_committed_or_restored_and_matching_authority(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError, 'final'):
            self.module.release(self.home, self.tx, self.identity['release_id'])
        self.module.rollback(self.home, self.tx)
        with self.assertRaisesRegex(ValueError, 'release'):
            self.module.release(self.home, self.tx, self.identity['release_id'])
        self.module.release(self.home, self.tx, self.identity['previous_release_id'])
        self.assertFalse(self.module.active_file(self.home).exists())
        self.module.release(self.home, self.tx, self.identity['previous_release_id'])


if __name__ == '__main__':
    unittest.main()
