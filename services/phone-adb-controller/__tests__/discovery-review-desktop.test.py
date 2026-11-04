import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('discovery_desktop_host', HERE / 'discovery-review-maintenance-host.py')
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
FIXTURE = json.loads((Path(__file__).parent / 'fixtures/discovery-desktop-android15.json').read_text())


class CurrentDesktopTest(unittest.TestCase):
    def verify(self, home=None, focus=None):
        return host.verify_current_desktop(host.proof.SCOPE['serial'],
            FIXTURE['home'] if home is None else home,
            FIXTURE['focus'] if focus is None else focus)

    def test_real_android15_same_package_duplicate_is_one_home_identity(self):
        self.assertEqual(FIXTURE['home'].count('packageName='), 2)
        result = self.verify()
        self.assertEqual(result['launcher'], 'com.hihonor.android.launcher')
        self.assertEqual(result['focus_indicators'], 2)

    def test_different_nested_package_and_missing_package_rejected(self):
        home = FIXTURE['home'].replace('    packageName=com.hihonor.android.launcher', '    packageName=foreign.package')
        for changed in (home, 'ActivityInfo:\nname=MissingPackage\n', ''):
            with self.subTest(home=changed), self.assertRaises(ValueError): self.verify(home=changed)

    def test_non_home_focus_and_absent_focus_are_rejected(self):
        for focus in ('', FIXTURE['focus'].replace('com.hihonor.android.launcher/', 'com.ss.android.ugc.aweme/', 1),
                      FIXTURE['focus'].replace('mFocusedApp=ActivityRecord', 'mFocusedApp=foreign.ActivityRecord')):
            with self.subTest(focus=focus), self.assertRaises(ValueError): self.verify(focus=focus)

    def test_single_home_package_remains_valid(self):
        self.assertEqual(self.verify(home='packageName=com.hihonor.android.launcher\n')['launcher'], 'com.hihonor.android.launcher')


if __name__ == '__main__': unittest.main()
