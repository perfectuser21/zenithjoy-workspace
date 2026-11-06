"""真实隔离目录/Unix flock；不调用ADB、网络或生产锁根。"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'phone-lock-root.py'
spec = importlib.util.spec_from_file_location('phone_lock_root', SOURCE)
root = importlib.util.module_from_spec(spec)
spec.loader.exec_module(root)


class CleanBootstrap(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='phone-root-clean-')
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name).resolve()
        self.old, self.dest = self.base / 'legacy', self.base / 'persistent'
        self.old.mkdir(mode=0o755)
        self.guard = self.old / '47.100.213.173:10001.guard'
        self.guard.touch(mode=0o600)
        (self.old / 'standalone-claims' / '47.100.213.173:10001').mkdir(parents=True)

    def invoke(self):
        return root.bootstrap_clean(self.old, self.dest)

    def test_real_cli_initializes_clean_root_preserving_inventory_and_same_guard(self):
        before = root.inventory(self.old)
        result = subprocess.run([sys.executable, str(SOURCE), 'bootstrap-clean', str(self.old), str(self.dest)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        marker = root.verify(self.dest)
        self.assertEqual(marker['bootstrap_type'], 'clean')
        self.assertEqual(marker['review_owners'], 0)
        self.assertEqual(marker['source_sha256'], hashlib.sha256(json.dumps(before, separators=(',', ':')).encode()).hexdigest())
        self.assertEqual(before, root.inventory(self.old))
        self.assertEqual(before, [r for r in root.inventory(self.dest) if r[0] != root.MARKER])
        self.assertEqual(self.guard.stat().st_ino, (self.dest / self.guard.name).stat().st_ino)
        with self.guard.open('r+') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            probe = subprocess.run([sys.executable, '-c', 'import fcntl,sys; f=open(sys.argv[1],"r+"); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)', str(self.dest / self.guard.name)], capture_output=True)
            self.assertNotEqual(probe.returncode, 0)
        self.assertEqual(self.dest.stat().st_mode & 0o777, 0o700)
        self.assertFalse(list(self.dest.glob('*.lock')))

    def test_migrate_remains_review_only(self):
        with self.assertRaisesRegex(ValueError, 'no legacy review owners'):
            root.migrate(self.old, self.dest)
        self.assertFalse(self.dest.exists())

    def test_busy_real_guard_rejects_and_keeps_recovery_evidence(self):
        with self.guard.open('r+') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(ValueError, 'guard busy'):
                self.invoke()
        self.assertFalse(self.dest.exists())
        records = list(self.base.glob('.phone-lock-bootstrap-failure-*.json'))
        self.assertEqual(len(records), 1)
        self.assertEqual(json.loads(records[0].read_text())['state'], 'failed')

    def test_nonempty_claim_unknown_owner_and_other_entries_reject(self):
        for relative in ['standalone-claims/47.100.213.173:10001/claim', 'unrecognized', 'cloud.lock']:
            with self.subTest(relative=relative):
                path = self.old / relative
                if relative.endswith('.lock'):
                    path.mkdir()
                else:
                    path.write_text('')
                with self.assertRaises(ValueError):
                    self.invoke()
                self.assertFalse(self.dest.exists())
                if path.is_dir(): path.rmdir()
                else: path.unlink()

    def test_symlink_fifo_and_unguarded_claim_namespace_reject(self):
        for kind in ['symlink', 'fifo', 'unguarded']:
            with self.subTest(kind=kind):
                path = self.old / ('standalone-claims/OTHER' if kind == 'unguarded' else 'unknown')
                if kind == 'symlink': path.symlink_to(self.base / 'missing')
                elif kind == 'fifo': os.mkfifo(path)
                else: path.mkdir()
                with self.assertRaises(ValueError): self.invoke()
                if path.is_dir(): path.rmdir()
                else: path.unlink()
                self.assertFalse(self.dest.exists())

    def test_existing_target_is_never_overwritten(self):
        self.dest.mkdir()
        with self.assertRaises(ValueError): self.invoke()
        self.assertEqual(list(self.dest.iterdir()), [])

    def test_guard_replacement_during_staging_rejects_with_stage_preserved(self):
        original = root.sync_tree
        def replace(path):
            original(path)
            self.guard.unlink()
            self.guard.touch(mode=0o600)
        with patch.object(root, 'sync_tree', side_effect=replace):
            with self.assertRaises(ValueError): self.invoke()
        self.assertFalse(self.dest.exists())
        self.assertTrue(list(self.base.glob('.phone-lock-bootstrap-stage-*')))

    def test_new_claim_during_staging_rejects_without_deleting_it(self):
        original = root.sync_tree
        claim = self.old / 'standalone-claims/47.100.213.173:10001/new-claim'
        def change(path):
            original(path)
            claim.write_text('owner')
        with patch.object(root, 'sync_tree', side_effect=change):
            with self.assertRaises(ValueError): self.invoke()
        self.assertEqual(claim.read_text(), 'owner')
        self.assertFalse(self.dest.exists())

    def test_publication_failure_retains_stage_and_fixed_recovery_record(self):
        with patch.object(root, '_publish_clean_root', side_effect=OSError('PRIVATE_SENTINEL')):
            with self.assertRaises(OSError): self.invoke()
        self.assertFalse(self.dest.exists())
        stages = list(self.base.glob('.phone-lock-bootstrap-stage-*'))
        self.assertEqual(len(stages), 1)
        record = json.loads(next(self.base.glob('.phone-lock-bootstrap-failure-*.json')).read_text())
        self.assertEqual(record['phase'], 'publish')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(record))
        self.assertEqual(record['stage'], str(stages[0]))

    def test_all_guards_are_owned_and_hardlinked(self):
        other = self.old / 'USB_2.guard'
        other.touch(mode=0o600)
        with other.open('r+') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(ValueError, 'guard busy'): self.invoke()
        self.invoke()
        for guard in [self.guard, other]:
            self.assertEqual(guard.stat().st_ino, (self.dest / guard.name).stat().st_ino)

    def test_missing_guard_and_unsafe_permissions_reject(self):
        self.guard.unlink()
        with self.assertRaises(ValueError): self.invoke()
        self.guard.touch(mode=0o600)
        self.guard.chmod(0o666)
        with self.assertRaises(ValueError): self.invoke()
        self.assertFalse(self.dest.exists())

    def test_dangling_target_symlink_is_not_followed(self):
        self.dest.symlink_to(self.base / 'absent')
        with self.assertRaises(ValueError): self.invoke()
        self.assertTrue(self.dest.is_symlink())
        self.assertFalse((self.base / 'absent').exists())

    def test_source_directory_replacement_rejects(self):
        original = root.sync_tree
        def replace(path):
            original(path)
            self.old.rename(self.base / 'original-legacy')
            self.old.mkdir(mode=0o755)
        with patch.object(root, 'sync_tree', side_effect=replace):
            with self.assertRaises(ValueError): self.invoke()
        self.assertFalse(self.dest.exists())
        self.assertTrue((self.base / 'original-legacy' / self.guard.name).exists())

    def test_parent_fsync_failure_after_publish_is_unknown_not_success(self):
        original = root.os.fsync
        def fail_parent(fd):
            info = os.fstat(fd)
            if (info.st_dev, info.st_ino) == (self.base.stat().st_dev, self.base.stat().st_ino):
                raise OSError('SENSITIVE_DIAGNOSTIC_SENTINEL')
            return original(fd)
        with patch.object(root.os, 'fsync', side_effect=fail_parent):
            with self.assertRaises(OSError): self.invoke()
        self.assertTrue(self.dest.exists(), 'do not delete a possibly committed root')
        record = json.loads(next(self.base.glob('.phone-lock-bootstrap-failure-*.json')).read_text())
        self.assertTrue(record['commit_unknown'])
        self.assertEqual(record['phase'], 'parent_sync')
        self.assertNotIn('SENSITIVE_DIAGNOSTIC_SENTINEL', json.dumps(record))
        with self.assertRaises(ValueError): self.invoke()

    def test_competing_empty_target_publication_is_not_replaced(self):
        original = root._publish_clean_root
        def compete(stage, target):
            self.dest.mkdir()
            identity = self.dest.stat().st_ino
            try: original(stage, target)
            finally: self.assertEqual(self.dest.stat().st_ino, identity)
        with patch.object(root, '_publish_clean_root', side_effect=compete):
            with self.assertRaises(OSError): self.invoke()
        self.assertEqual(list(self.dest.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
