import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'deployment-effects.py'


class EffectsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        spec = importlib.util.spec_from_file_location('phone_effects', SOURCE)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.state = {'skills': ['workflow-commander'], 'allowAgents': ['old-agent']}
        self.calls = []
        self.journal = self.home / 'effects.json'

    def get(self, name):
        return json.loads(json.dumps(self.state[name]))

    def set(self, name, expected, value):
        self.calls.append((name, expected, value))
        if self.state[name] != expected:
            raise ValueError('config CAS conflict')
        self.state[name] = value.copy()

    def prepare(self):
        return self.module.prepare_config(self.journal, ['workflow-commander', 'wf-report'], self.get)

    def test_apply_and_restore_preserve_original_config_not_invent_defaults(self):
        self.prepare()
        self.module.apply_config(self.journal, self.get, self.set)
        self.assertEqual(self.state['skills'], ['workflow-commander', 'wf-report'])
        self.assertEqual(self.state['allowAgents'], ['old-agent', 'skill-factory'])
        self.module.restore_config(self.journal, self.get, self.set)
        self.assertEqual(self.state, {'skills': ['workflow-commander'], 'allowAgents': ['old-agent']})

    def test_changed_config_prevents_any_restore(self):
        self.prepare()
        self.module.apply_config(self.journal, self.get, self.set)
        self.state['allowAgents'].append('human-added')
        before = len(self.calls)
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.module.restore_config(self.journal, self.get, self.set)
        self.assertEqual(len(self.calls), before)

    def test_lost_config_write_reply_is_reconciled_without_repeated_mutation(self):
        self.prepare()
        def lost(name, expected, value):
            self.set(name, expected, value)
            raise OSError('reply lost')
        with self.assertRaises(OSError):
            self.module.apply_config(self.journal, self.get, lost)
        self.module.apply_config(self.journal, self.get, self.set)
        self.assertEqual(sum(c[0] == 'skills' for c in self.calls), 1)
        self.module.restore_config(self.journal, self.get, self.set)

    def test_same_attempt_never_recaptures_new_config_as_previous(self):
        record = self.prepare()
        self.module.apply_config(self.journal, self.get, self.set)
        again = self.prepare()
        self.assertEqual(again['before'], record['before'])
        with self.assertRaisesRegex(ValueError, 'identity'):
            self.module.prepare_config(self.journal, ['different-skill'], self.get)

    def test_config_snapshot_corruption_is_not_authority(self):
        self.prepare()
        record = json.loads(self.journal.read_text())
        record['before']['allowAgents'] = ['attacker']
        self.journal.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, 'digest'):
            self.module.restore_config(self.journal, self.get, self.set)

    def test_registry_config_values_must_be_bounded_authored_names(self):
        self.state['skills'] = 'all'
        with self.assertRaises(ValueError):
            self.prepare()
        self.state['skills'] = ['workflow-commander']
        with self.assertRaises(ValueError):
            self.module.prepare_config(self.journal, ['../escape'], self.get)


if __name__ == '__main__':
    unittest.main()
