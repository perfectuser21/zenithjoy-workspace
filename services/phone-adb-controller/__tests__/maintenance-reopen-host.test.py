"""统一准入必须先核安全安装、Brain、旧执行与手机桌面，再解精确锁。"""

from contextlib import ExitStack
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / 'maintenance-reopen-host.py'
SPEC = importlib.util.spec_from_file_location('maintenance_reopen_host', SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ReopenHostTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name).resolve()
        self.safety_tx = 'phone-safety-' + 'a' * 24
        self.sha = 'b' * 40
        self.release_id = '12345678-1234-4234-8234-123456789012'
        self.calls = []
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        def fake(module, name, result):
            self.stack.enter_context(patch.object(module, name, side_effect=lambda *args, **kwargs:
                self.calls.append(name) or (result() if callable(result) else result)))
        fake(MODULE.roots, 'verify_prepared_roots', {'candidate_sha': self.sha})
        fake(MODULE, 'verify_safety_barrier', {'review_serials': [MODULE.OLD_SERIAL],
                                               'manifest_sha256': 'a' * 64})
        fake(MODULE.gate, 'verify_candidate_gate', {'source_commit': self.sha,
                                                   'release_id': self.release_id})
        fake(MODULE.proof, 'verify_native_termination', {'receipt_count': 6,
                                                        'receipt_sha256': 'd' * 64})
        fake(MODULE.proof, 'verify_safe_desktop', {'launcher': 'com.hihonor.android.launcher'})
        fake(MODULE.locks, 'verify', {'legacy_root': str(self.home / 'legacy-locks')})
        fake(MODULE.lock, 'retire_exact_review', {'released': True, 'serial': MODULE.OLD_SERIAL})
        self.observed = {'cron_raw': '# closed\n', 'recovery_disabled': True,
                         'recovery_loaded': False, 'process_table': ''}
        self.brain = lambda path: {'release': {'id': self.release_id}} if path.endswith('/' + self.release_id) else (
            {'observation': {'id': 'obs'}} if '/observations/' in path else {'current_observation_id': 'obs'})
        self.phone = lambda kind: 'read-only evidence'

    def finalize(self):
        return MODULE.finalize_reopen(self.home, self.safety_tx, self.sha,
                                      self.release_id, self.observed,
                                      brain_request=self.brain, phone_read=self.phone,
                                      boot_seconds=1793499700)

    def test_all_proofs_precede_exact_retirement_and_old_identity_is_fixed(self):
        result = self.finalize()
        self.assertTrue(result['released'])
        self.assertLess(self.calls.index('verify_candidate_gate'),
                        self.calls.index('retire_exact_review'))
        self.assertLess(self.calls.index('verify_native_termination'),
                        self.calls.index('retire_exact_review'))
        self.assertLess(self.calls.index('verify_safe_desktop'),
                        self.calls.index('retire_exact_review'))

    def test_candidate_or_native_failure_never_calls_release(self):
        with patch.object(MODULE.gate, 'verify_candidate_gate', side_effect=ValueError('gate failed')):
            with self.assertRaisesRegex(ValueError, 'gate failed'):
                self.finalize()
        self.assertNotIn('retire_exact_review', self.calls)

    def test_brain_gate_drift_after_phone_probe_prevents_release(self):
        seen = 0
        def changed(path):
            nonlocal seen
            if path.endswith('/gate'):
                seen += 1
                return {'current_observation_id': 'obs' if seen == 1 else 'new-observation'}
            return self.brain(path)
        with self.assertRaisesRegex(ValueError, 'BRAIN_GATE_DRIFT'):
            MODULE.finalize_reopen(self.home, self.safety_tx, self.sha,
                self.release_id, self.observed, brain_request=changed,
                phone_read=self.phone, boot_seconds=1793499700)
        self.assertNotIn('retire_exact_review', self.calls)
        self.calls.clear()
        with patch.object(MODULE.proof, 'verify_native_termination', side_effect=ValueError('boot old')):
            with self.assertRaisesRegex(ValueError, 'boot old'):
                self.finalize()
        self.assertNotIn('retire_exact_review', self.calls)

    def test_old_101f_scope_cannot_be_changed_by_call_inputs(self):
        self.assertEqual(MODULE.OLD_SERIAL, 'ANGYVB4227006983')
        self.assertEqual(MODULE.OLD_SOURCE, '2fbb306f1d9929e9b8a572ecf99e344c07596ad0')
        self.assertEqual(MODULE.OLD_RUN,
                         'douyin_video_discovery-accept2fbb_jinuo101f_20261101t1018__a1')


if __name__ == '__main__':
    unittest.main()
