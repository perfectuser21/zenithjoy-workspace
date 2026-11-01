import importlib.util
from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[1] / 'maintenance-install-transaction.py'
spec = importlib.util.spec_from_file_location('maintenance_install_transaction', SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeSite:
    def __init__(self, fail=None):
        self.events = []
        self.state = {'cron': 'open', 'adb': 'candidate', 'recovery': 'enabled',
                      'roots': ['open', 'open'], 'review': 'legacy'}
        self.fail = fail

    def step(self, name):
        if self.fail == name:
            self.fail = None
            raise OSError('interrupted ' + name)
        if name == 'close_review_cron':
            self.state['cron'] = 'closed'
        elif name == 'relocate_adb':
            self.state['adb'] = 'stable'
        elif name == 'disable_recovery':
            self.state['recovery'] = 'disabled'
        elif name == 'seal_candidates':
            self.state['roots'][0] = 'sealed'
            if self.fail == 'second_root':
                self.fail = None
                raise OSError('interrupted second_root')
            self.state['roots'][1] = 'sealed'
        elif name == 'migrate_review':
            self.state['review'] = 'dual'
        else:
            raise AssertionError(name)
        self.events.append(name)

    def verify(self, name):
        expected = {'close_review_cron': self.state['cron'] == 'closed',
                    'relocate_adb': self.state['adb'] == 'stable',
                    'disable_recovery': self.state['recovery'] == 'disabled',
                    'seal_candidates': self.state['roots'] == ['sealed', 'sealed'],
                    'migrate_review': self.state['review'] == 'dual'}
        return expected[name]


class MaintenanceInstallTransactionTests(unittest.TestCase):
    def test_interrupt_after_first_root_stays_auto_quiescent_and_replays_same_transaction(self):
        site = FakeSite(fail='second_root')
        journal = {'transaction': 'safety-1', 'source_commit': 'a' * 40, 'completed': []}
        with self.assertRaisesRegex(OSError, 'second_root'):
            module.run_steps(site.step, site.verify, journal)
        self.assertEqual(journal['completed'], ['close_review_cron', 'relocate_adb', 'disable_recovery', 'migrate_review'])
        self.assertEqual(site.state['cron'], 'closed')
        self.assertEqual(site.state['recovery'], 'disabled')
        self.assertEqual(site.state['adb'], 'stable')
        self.assertEqual(site.state['roots'], ['sealed', 'open'], 'manual direct path remains; do not claim physical seal')
        module.run_steps(site.step, site.verify, journal)
        self.assertEqual(site.state['roots'], ['sealed', 'sealed'])
        self.assertEqual(site.state['review'], 'dual')
        self.assertEqual(journal['completed'][-1], 'seal_candidates')

    def test_missing_previous_proof_or_changed_identity_rejects_replay(self):
        site = FakeSite()
        journal = {'transaction': 'safety-1', 'source_commit': 'a' * 40,
                   'completed': ['close_review_cron']}
        with self.assertRaisesRegex(ValueError, 'prior'):
            module.run_steps(site.step, site.verify, journal)
        journal['source_commit'] = 'bad'
        with self.assertRaisesRegex(ValueError, 'identity'):
            module.run_steps(site.step, site.verify, journal)


if __name__ == '__main__':
    unittest.main()
