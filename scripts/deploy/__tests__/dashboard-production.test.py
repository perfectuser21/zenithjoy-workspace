import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('dashboard_production', Path(__file__).parents[1] / 'dashboard-production.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
OLD = 'a' * 40
NEW = 'b' * 40
NEW_DIGEST = 'e' * 64


class HostFixture:
    def __init__(self):
        self.live = {region: {'sha': OLD, 'digest': digit * 64}
                     for region, digit in [('hz', 'c'), ('hk', 'd')]}
        self.versions = {region: {OLD: value} for region, value in self.live.items()}
        self.calls = []
        self.failure = None
        self.recovery_failure = None

    def __call__(self, region, mode, *args, archive=None):
        self.calls.append((region, mode, args, hashlib.sha256(archive.read_bytes()).hexdigest() if archive else None))
        if mode == 'inspect':
            return self.live[region]
        if mode == 'prepare':
            self.versions[region][args[0]] = {'sha': args[0], 'digest': NEW_DIGEST}
            return self.versions[region][args[0]]
        target, expected = args
        if self.live[region]['sha'] not in (target, expected):
            raise release.ReleaseError('wrong current SHA')
        if mode == 'restore' and self.recovery_failure == region:
            raise release.ReleaseError('restore unavailable')
        self.live[region] = self.versions[region][target]
        if mode == 'activate' and self.failure == region:
            raise release.ReleaseError('response lost after activation')
        if mode == 'activate' and self.failure == 'interrupt-' + region:
            raise KeyboardInterrupt
        return self.live[region]


class DashboardProduction(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.state = self.root / 'transaction.json'
        self.archive = self.root / 'candidate.tar.gz'
        self.archive.write_bytes(b'one build')
        self.host = HostFixture()

    def promote(self):
        return release.run_transaction(self.state, self.host, 'promote', NEW, self.archive)

    def test_prepares_one_bundle_and_rolls_back_both_with_exact_predecessor(self):
        old = self.host.live.copy()
        self.assertEqual(self.promote()['current'], self.host.live)
        calls = [c for c in self.host.calls if c[1] == 'prepare']
        self.assertEqual([c[0] for c in calls], ['hz', 'hk'])
        self.assertEqual(calls[0][2:], calls[1][2:])
        self.assertEqual(self.promote()['current'], self.host.live)
        self.assertEqual(sum(c[1]=='activate' for c in self.host.calls), 2)
        release.run_transaction(self.state, self.host, 'rollback', OLD)
        self.assertEqual(self.host.live, old)
        release.run_transaction(self.state, self.host, 'rollback', OLD)
        self.assertEqual(sum(c[1]=='restore' for c in self.host.calls), 2)

    def test_recovers_both_after_lost_response_from_second_site(self):
        old = self.host.live.copy()
        self.host.failure = 'hk'
        with self.assertRaisesRegex(release.ReleaseError, 'predecessor restored'):
            self.promote()
        self.assertEqual(self.host.live, old)
        self.assertIsNone(release.read_state(self.state)['pending'])

    def test_recovers_durable_pending_after_interruption(self):
        old = self.host.live.copy()
        self.host.failure = 'interrupt-hz'
        with self.assertRaises(KeyboardInterrupt):
            self.promote()
        self.assertEqual(self.host.live['hk'], old['hk'])
        self.assertEqual(self.host.live['hz']['sha'], NEW)
        with self.assertRaisesRegex(release.ReleaseError, 'pending'):
            self.promote()
        release.run_transaction(self.state, self.host, 'rollback', OLD)
        self.assertEqual(self.host.live, old)

    def test_keeps_pending_if_a_site_cannot_recover(self):
        self.host.failure = 'hk'
        self.host.recovery_failure = 'hz'
        with self.assertRaisesRegex(release.ReleaseError, 'recovery pending'):
            self.promote()
        self.assertIsNotNone(release.read_state(self.state)['pending'])
        self.host.recovery_failure = None
        release.run_transaction(self.state, self.host, 'rollback', OLD)
        self.assertIsNone(release.read_state(self.state)['pending'])

    def test_rejects_drift_without_activation(self):
        self.host.live['hk'] = {'sha': 'f' * 40, 'digest': 'd' * 64}
        with self.assertRaisesRegex(release.ReleaseError, 'different versions'):
            self.promote()
        self.assertFalse(self.state.exists())
        self.assertTrue(all(row[1] == 'inspect' for row in self.host.calls))

    def test_inspect_has_no_writes(self):
        self.assertEqual(release.run_transaction(self.state, self.host, 'inspect')['current'], self.host.live)
        self.assertFalse(self.state.exists())


if __name__ == '__main__':
    unittest.main()
