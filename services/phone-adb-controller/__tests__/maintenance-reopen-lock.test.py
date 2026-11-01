"""受控 reopen 只退休精确旧 owner，保留其他 review 与 claim。"""

import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


locks = load('phone-lock-root.py')
reopen = load('maintenance-reopen-lock.py')


class ReopenLockTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.old = self.root / 'legacy'
        self.durable = self.root / 'durable'
        self.old.mkdir()
        self.owners = {'SERIAL1': 'old-frozen-run', 'SERIAL2': 'other-review',
                       'SERIAL3': 'third-review'}
        for serial, owner in self.owners.items():
            (self.old / (serial + '.guard')).touch()
            held = self.old / (serial + '.lock')
            held.mkdir()
            for name, value in {'owner': owner, 'standalone_review_required': owner,
                                'acquired_at': '1793499573', 'pid': '2001'}.items():
                (held / name).write_text(value + '\n')
        claims = self.old / 'standalone-claims' / 'SERIAL1'
        claims.mkdir(parents=True)
        (claims / 'old-frozen-run').write_text('once\n')
        locks.migrate(self.old, self.durable)
        self.journal = self.root / 'reopen.json'
        self.tx = 'phone-reopen-' + 'a' * 24

    def retire(self):
        return reopen.retire_exact_review(self.old, self.durable, 'SERIAL1',
                                          'old-frozen-run', self.tx, self.journal)

    def test_exact_review_retired_dual_root_and_other_owners_remain(self):
        result = self.retire()
        self.assertTrue(result['released'])
        self.assertEqual(locks.verify_review(self.old, self.durable)['review_owners'], 2)
        self.assertEqual(locks.check_serial(self.durable, 'SERIAL1')['state'], 'free')
        self.assertTrue((self.old / 'standalone-claims/SERIAL1/old-frozen-run').is_file())
        for serial in ('SERIAL2', 'SERIAL3'):
            self.assertTrue((self.old / (serial + '.lock')).exists())
            self.assertTrue((self.durable / (serial + '.lock')).exists())
        self.assertTrue((self.old / ('.review-retired-' + self.tx + '-SERIAL1')).is_dir())
        self.assertEqual(self.retire(), result)

    def test_wrong_owner_or_drift_fails_without_partial_release(self):
        with self.assertRaisesRegex(ValueError, 'OWNER'):
            reopen.retire_exact_review(self.old, self.durable, 'SERIAL1',
                                       'wrong-run', self.tx, self.journal)
        self.assertTrue((self.old / 'SERIAL1.lock').exists())
        self.assertTrue((self.durable / 'SERIAL1.lock').exists())
        (self.durable / 'SERIAL1.lock/owner').write_text('tampered\n')
        with self.assertRaisesRegex(ValueError, 'review|inventory|OWNER'):
            self.retire()
        self.assertTrue((self.old / 'SERIAL1.lock').exists())

    def test_crash_after_durable_rename_keeps_legacy_lock_until_replay(self):
        def crash(step):
            if step == 'durable_retired':
                raise RuntimeError('power loss')
        with self.assertRaisesRegex(RuntimeError, 'power loss'):
            reopen.retire_exact_review(self.old, self.durable, 'SERIAL1',
                                       'old-frozen-run', self.tx, self.journal,
                                       after_step=crash)
        self.assertTrue((self.old / 'SERIAL1.lock').exists())
        with self.assertRaisesRegex(ValueError, 'legacy owner or review held'):
            locks.check_serial(self.durable, 'SERIAL1')
        self.assertTrue(self.retire()['released'])
        self.assertEqual(locks.verify_review(self.old, self.durable)['review_owners'], 2)

    def test_crash_after_marker_roll_forward_keeps_legacy_lock(self):
        def crash(step):
            if step == 'marker_updated':
                raise RuntimeError('power loss')
        with self.assertRaisesRegex(RuntimeError, 'power loss'):
            reopen.retire_exact_review(self.old, self.durable, 'SERIAL1',
                                       'old-frozen-run', self.tx, self.journal,
                                       after_step=crash)
        self.assertTrue((self.old / 'SERIAL1.lock').exists())
        self.assertTrue(self.retire()['released'])
        self.assertEqual(locks.verify_review(self.old, self.durable)['review_owners'], 2)


if __name__ == '__main__':
    unittest.main()
