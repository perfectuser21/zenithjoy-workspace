import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('discovery_host', HERE / 'discovery-review-maintenance-host.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class HostAdmissionTest(unittest.TestCase):
    def test_dry_run_never_retires(self):
        with patch.object(mod, 'admission', return_value={'proof': True}), patch.object(mod.lock, 'retire') as retire:
            self.assertEqual(mod.execute('plan', Path('/home/service'), 'a' * 40, 'release'), {'proof': True})
            retire.assert_not_called()

    def test_unknown_action_rejected_before_any_observation(self):
        with patch.object(mod, 'admission') as admission:
            with self.assertRaises(ValueError): mod.execute('release-any', Path('/home/service'), 'a' * 40, 'release')
            admission.assert_not_called()

    def test_admission_failure_never_calls_retirement(self):
        with patch.object(mod, 'admission', side_effect=ValueError('original changed')), patch.object(mod.lock, 'retire') as retire:
            with self.assertRaisesRegex(ValueError, 'original changed'):
                mod.execute('apply', Path('/home/service'), 'a' * 40, 'release')
            retire.assert_not_called()


if __name__ == '__main__': unittest.main()
