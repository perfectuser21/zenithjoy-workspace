"""旧 sealed 根永不复原；只为新 SHA 原子建立空候选根。"""

import importlib.util
import json
import tempfile
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
                  'review_serials': ['SERIAL1', 'SERIAL2', 'SERIAL3'],
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


if __name__ == '__main__':
    unittest.main()
