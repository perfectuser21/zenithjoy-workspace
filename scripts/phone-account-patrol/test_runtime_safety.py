import contextlib
import io
import json
import unittest
from unittest.mock import patch
import collector


class PhoneRuntimeSafetyTests(unittest.TestCase):
    def run_collector(self, focus, runid):
        class Device:
            calls = []
            def __init__(self, serial, runid):
                pass
            def adb(self, *args):
                self.calls.append(args)
                return focus.encode()
            def inspect(self, platform):
                self.calls.append(('inspect', platform))
                return {'state': '待确认', 'reason': 'fixture'}
        output = io.StringIO()
        with patch.object(collector, 'Probe', Device), patch('sys.argv', ['collector.py', 'sample-phone', runid, '抖音']), contextlib.redirect_stdout(output):
            collector.main()
        return json.loads(output.getvalue()), Device.calls

    def test_completed_inspection_returns_phone_to_home(self):
        result, calls = self.run_collector('mCurrentFocus=com.android.launcher/.Launcher', 'central-test')
        self.assertEqual(result['results']['抖音']['state'], '待确认')
        self.assertEqual(calls[-1], ('shell', 'input', 'keyevent', '3'))

    def test_run_name_never_bypasses_human_foreground(self):
        result, calls = self.run_collector('mCurrentFocus=com.tencent.mm/.LauncherUI', 'initial-recheck-anything')
        self.assertEqual(result['results']['抖音']['state'], '占用未查')
        self.assertFalse(any(c[0] == 'inspect' for c in calls))
        self.assertFalse(any(c[:3] == ('shell', 'input', 'keyevent') for c in calls))


if __name__ == '__main__':
    unittest.main()
