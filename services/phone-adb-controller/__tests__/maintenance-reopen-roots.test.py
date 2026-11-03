"""旧 sealed 根永不复原；只为新 SHA 原子建立空候选根。"""

import importlib.util
import json
import tempfile
import shutil
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tx = load('deployment-transaction.py')
fence = load('deployment-candidate-fence.py')
locks = load('phone-lock-root.py')
reopen = load('maintenance-reopen-roots.py')


class ReopenRootsTest(unittest.TestCase):
    REVIEW_SERIALS = ('SERIAL1', 'SERIAL2', 'SERIAL3')

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.safety_sha = 'a' * 40
        self.candidate_sha = 'b' * 40
        self.safety_tx = 'phone-safety-' + self.safety_sha[:24]
        self.old_dir = self.home / '.local/share/zenithjoy'
        for name in ('phone-candidates', 'phone-candidate-runs'):
            old = self.old_dir / name
            old.mkdir(parents=True)
            (old / 'old101f').write_text('frozen byte')
        tx.atomic_bytes(tx.active_file(self.home), tx.canonical({'transaction': self.safety_tx}))
        self.manifest = self.home / 'bin-harvest/deployment-manifest.json'
        tx.atomic_bytes(self.manifest, b'{"production":"old"}')
        safety = {'schema_version': 1, 'transaction': self.safety_tx,
                  'source_commit': self.safety_sha, 'home': str(self.home),
                  'completed': ['close_review_cron', 'relocate_adb', 'disable_recovery',
                                'migrate_review', 'seal_candidates'],
                  'manifest_sha256': tx.digest(self.manifest.read_bytes()),
                  'review_serials': list(self.REVIEW_SERIALS),
                  'cron_after': '# review harvest closed\n'}
        journal = self.home / '.config/zenithjoy/maintenance-only' / self.safety_tx / 'journal.json'
        tx.atomic_bytes(journal, tx.canonical({**safety, 'sha256': tx.digest(tx.canonical(safety))}))
        legacy = self.home / 'legacy-locks'
        legacy.mkdir()
        for serial in safety['review_serials']:
            (legacy / (serial + '.guard')).touch()
            owner = legacy / (serial + '.lock')
            owner.mkdir()
            (owner / 'owner').write_text(serial + '-old\n')
            (owner / 'standalone_review_required').write_text(serial + '-old\n')
            (owner / 'acquired_at').write_text('1793499573\n')
        locks.migrate(legacy, self.home / '.local/share/zenithjoy/phone-locks')
        fence.seal(self.home, self.safety_tx)
        self.observed = {'cron_raw': '# review harvest closed\n', 'recovery_disabled': True,
                         'recovery_loaded': False, 'process_table': ''}

    def prepare(self, **changes):
        return reopen.prepare_fresh_roots(self.home, self.safety_tx, self.candidate_sha,
                                          {**self.observed, **changes})

    def test_new_empty_roots_preserve_sealed_old_bytes_and_production_manifest(self):
        before = self.manifest.read_bytes()
        result = self.prepare()
        self.assertEqual(result['candidate_sha'], self.candidate_sha)
        for name in ('phone-candidates', 'phone-candidate-runs'):
            current = self.old_dir / name
            sealed = self.old_dir / (name + '.sealed.' + self.safety_tx)
            self.assertTrue(current.is_dir())
            self.assertEqual(list(current.iterdir()), [])
            self.assertEqual((sealed / 'old101f').read_text(), 'frozen byte')
        self.assertEqual(self.manifest.read_bytes(), before)
        self.assertEqual(self.prepare(), result)

    def test_auto_entry_or_old_process_blocks_before_first_root(self):
        for change in ({'recovery_loaded': True},
                       {'cron_raw': '* * * * * harvest-cron.sh SERIAL1\n'},
                       {'process_table': '123 leadgen-run.sh old101f'}):
            with self.assertRaises(ValueError):
                self.prepare(**change)
            self.assertTrue((self.old_dir / 'phone-candidates').is_file())

    def test_crash_after_first_exchange_replays_without_old_root_revival(self):
        def crash(name):
            if name == 'phone-candidates':
                raise RuntimeError('power loss')
        with self.assertRaisesRegex(RuntimeError, 'power loss'):
            reopen.prepare_fresh_roots(self.home, self.safety_tx, self.candidate_sha,
                                       self.observed, after_root=crash)
        self.assertTrue((self.old_dir / 'phone-candidates').is_dir())
        self.assertTrue((self.old_dir / 'phone-candidate-runs').is_file())
        self.assertEqual((self.old_dir / ('phone-candidates.sealed.' + self.safety_tx) /
                          'old101f').read_text(), 'frozen byte')
        self.assertEqual(self.prepare()['candidate_sha'], self.candidate_sha)

    def test_manifest_drift_or_wrong_candidate_sha_fails_closed(self):
        self.manifest.write_text('{"production":"drift"}')
        with self.assertRaisesRegex(ValueError, 'MANIFEST'):
            self.prepare()
        self.assertTrue((self.old_dir / 'phone-candidates').is_file())
        self.manifest.write_text('{"production":"old"}')
        with self.assertRaisesRegex(ValueError, 'SHA'):
            reopen.prepare_fresh_roots(self.home, self.safety_tx, self.safety_sha[:-1],
                                       self.observed)


    def rewrite_scope(self, serials):
        journal = self.home / '.config/zenithjoy/maintenance-only' / self.safety_tx / 'journal.json'
        value = json.loads(journal.read_bytes())
        value.pop('sha256')
        value['review_serials'] = serials
        tx.atomic_bytes(journal, tx.canonical({**value, 'sha256': tx.digest(tx.canonical(value))}))

    def test_same_count_different_serial_is_not_the_original_review_scope(self):
        self.rewrite_scope(['FOREIGN', *self.REVIEW_SERIALS[1:]])
        with self.assertRaisesRegex(ValueError, 'REVIEW'):
            self.prepare()
        self.assertTrue((self.old_dir / 'phone-candidates').is_file())

    def assert_scope_rejected(self, scope):
        self.rewrite_scope(scope)
        with self.assertRaisesRegex(ValueError, 'REVIEW'):
            self.prepare()
        self.assertTrue((self.old_dir / 'phone-candidates').is_file())

    def test_duplicate_journal_scope_cannot_prepare_roots(self):
        self.assert_scope_rejected([self.REVIEW_SERIALS[0]] * len(self.REVIEW_SERIALS))

    def test_invalid_serial_cannot_prepare_roots(self):
        self.assert_scope_rejected(['../outside', *self.REVIEW_SERIALS[1:]])

    def test_nonstring_serial_cannot_prepare_roots(self):
        self.assert_scope_rejected([None, *self.REVIEW_SERIALS[1:]])

    def test_empty_scope_cannot_prepare_roots(self):
        self.assert_scope_rejected([])

    def test_marker_owner_or_guard_drift_never_opens_namespace(self):
        durable = self.old_dir / 'phone-locks'
        paths = [durable / locks.MARKER,
                 durable / (self.REVIEW_SERIALS[0] + '.lock') / 'owner',
                 durable / (self.REVIEW_SERIALS[0] + '.guard')]
        for path in paths:
            with self.subTest(path=path.name):
                before = path.read_bytes()
                path.write_bytes(b'drift')
                with self.assertRaises((ValueError, KeyError)):
                    self.prepare()
                self.assertTrue((self.old_dir / 'phone-candidates').is_file())
                path.write_bytes(before)

    def test_missing_or_extra_owner_is_not_accepted(self):
        durable = self.old_dir / 'phone-locks'
        owner = durable / (self.REVIEW_SERIALS[0] + '.lock')
        retired = durable / 'missing-owner'
        owner.rename(retired)
        with self.assertRaises(ValueError):
            self.prepare()
        retired.rename(owner)
        extra = durable / 'FOREIGN.lock'
        shutil.copytree(owner, extra)
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertTrue((self.old_dir / 'phone-candidates').is_file())

    def test_prepare_preserves_owner_inventory_and_original_journal(self):
        durable = self.old_dir / 'phone-locks'
        legacy = self.home / 'legacy-locks'
        journal = self.home / '.config/zenithjoy/maintenance-only' / self.safety_tx / 'journal.json'
        before = (locks.inventory(legacy), locks.inventory(durable), journal.read_bytes())
        self.prepare()
        self.assertEqual((locks.inventory(legacy), locks.inventory(durable), journal.read_bytes()), before)


class TwoOwnerReopenRootsTest(ReopenRootsTest):
    REVIEW_SERIALS = ('SERIAL1', 'SERIAL2')


if __name__ == '__main__':
    unittest.main()
