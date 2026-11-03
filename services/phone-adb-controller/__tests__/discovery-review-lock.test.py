import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('discovery_lock', HERE / 'discovery-review-maintenance-lock.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class ExactDurableTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name).resolve()
        self.old, self.new = self.base / 'old', self.base / 'new'
        self.old.mkdir(mode=0o700); self.new.mkdir(mode=0o700)
        for root in (self.old, self.new):
            for serial in (mod.SERIAL, 'ANGYVB4227006983', 'ANGYVB4402004137'):
                (root / (serial + '.guard')).touch(mode=0o600)
        for root in (self.old, self.new):
            for serial in ('ANGYVB4227006983', 'ANGYVB4402004137'):
                self.owner(root, serial, 'old-' + serial)
        self.owner(self.new, mod.SERIAL, mod.OWNER)
        (self.new / mod.locks.MARKER).write_text(json.dumps({'schema_version': 1,
            'state': 'complete', 'source_sha256': 'a' * 64, 'legacy_root': str(self.old)}))
        self.journal = self.base / 'journal.json'
        self.before = mod.locks.inventory(self.old)
        self.marker = (self.new / mod.locks.MARKER).read_bytes()

    def owner(self, root, serial, owner):
        p = root / (serial + '.lock'); p.mkdir(mode=0o700)
        for n, v in {'owner': owner + '\n', 'standalone_review_required': owner + '\n', 'acquired_at': '123\n', 'pid': '47476\n'}.items():
            (p / n).write_text(v)

    def retire(self, **kw):
        return mod.retire(self.old, self.new, self.journal, 'b' * 64, **kw)

    def test_only_target_retired_and_retry_idempotent(self):
        self.assertTrue(self.retire()['released'])
        self.assertTrue(self.retire()['released'])
        self.assertEqual(mod.locks.inventory(self.old), self.before)
        self.assertEqual((self.new / mod.locks.MARKER).read_bytes(), self.marker)
        self.assertFalse((self.new / (mod.SERIAL + '.lock')).exists())

    def test_foreign_and_legacy_owner_rejected(self):
        (self.new / (mod.SERIAL + '.lock') / 'owner').write_text('foreign\n')
        with self.assertRaises(ValueError): self.retire()
        (self.new / (mod.SERIAL + '.lock') / 'owner').write_text(mod.OWNER + '\n')
        self.owner(self.old, mod.SERIAL, mod.OWNER)
        with self.assertRaises(ValueError): self.retire()

    def test_crash_after_rename_retry_and_unrelated_drift_rejected(self):
        def crash(_): raise RuntimeError('crash')
        with self.assertRaises(RuntimeError): self.retire(after_step=crash)
        self.assertTrue(self.retire()['released'])
        (self.old / 'ANGYVB4227006983.lock' / 'owner').write_text('changed\n')
        with self.assertRaises(ValueError): self.retire()


if __name__ == '__main__': unittest.main()
