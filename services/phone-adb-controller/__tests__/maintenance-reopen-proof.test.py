"""受控 reopen 只承认重启后的原生终止和当前安全桌面原件。"""

import importlib.util
import json
import math
import tempfile
import unittest
from pathlib import Path


SOURCE = Path(__file__).resolve().parents[1] / 'maintenance-reopen-proof.py'
SPEC = importlib.util.spec_from_file_location('maintenance_reopen_proof', SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

RUN = 'douyin_video_discovery-accept2fbb_jinuo101f_20261101t1018__a1'
OWNER = 'accept2fbb_jinuo101f_20261101t1018'
SHA = '2fbb306f1d9929e9b8a572ecf99e344c07596ad0'
SERIAL = 'ANGYVB4227006983'
TASK = 'ff33a797-e027-45b8-baf9-45f3c9e8dbf1'


def receipt(n):
    return {
        'version': 1, 'operation_id': f'00000000-0000-4000-8000-{n:012d}',
        'run_id': RUN, 'owner': OWNER, 'source_commit': SHA,
        'serial': SERIAL, 'task_id': TASK, 'activity': 'preflight',
        'created_at': '2026-11-01T02:19:33.776Z',
        'ended_at': '2026-11-01T02:19:34.670Z',
        'execution_stopped': False, 'process_coverage': 'observed_only',
        'start_identity': '1793499573:783603', 'status': 'unknown',
        'processes': [{'pid': 2000+n, 'start_identity': '1793499573:783603',
                       'termination': {'confirmed': False}}],
    }


class ReopenProofTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'native-operations'
        self.root.mkdir()
        self.rows = [receipt(n) for n in range(6)]
        self.write_rows()
        self.expected = {'run_id': RUN, 'owner': OWNER, 'source_commit': SHA,
                         'serial': SERIAL, 'task_id': TASK}

    def write_rows(self):
        for old in self.root.glob('*.json'):
            old.unlink()
        for row in self.rows:
            (self.root / (row['operation_id'] + '.json')).write_text(json.dumps(row))

    def verify(self, boot=1793499700, processes=''):
        return MODULE.verify_native_termination(self.root, self.expected,
                                                boot_seconds=boot,
                                                process_table=processes)

    def test_reboot_after_all_six_native_receipts_proves_old_processes_ended(self):
        result = self.verify()
        self.assertEqual(result['receipt_count'], 6)
        self.assertEqual(result['run_id'], RUN)
        self.assertEqual(len(result['receipt_sha256']), 64)

    def test_old_boot_or_any_live_candidate_process_rejects(self):
        with self.assertRaisesRegex(ValueError, 'BOOT_NOT_AFTER_NATIVE'):
            self.verify(boot=1793499570)
        with self.assertRaisesRegex(ValueError, 'NATIVE_PROCESS_STILL_PRESENT'):
            self.verify(processes='123 /Users/x/.local/share/zenithjoy/phone-candidate-runs/2fbb/leadgen-run.sh')
        for unsafe in (math.nan, math.inf, -math.inf):
            with self.assertRaisesRegex(ValueError, 'BOOT_NOT_AFTER_NATIVE'):
                self.verify(boot=unsafe)

    def test_native_times_must_have_timezone_and_observed_processes(self):
        self.rows[0]['created_at'] = '2026-11-01T02:19:33'
        self.write_rows()
        with self.assertRaisesRegex(ValueError, 'RECEIPT_TIME'):
            self.verify()
        self.rows[0] = receipt(0)
        self.rows[0]['processes'] = []
        self.write_rows()
        with self.assertRaisesRegex(ValueError, 'RECEIPT_PROCESS'):
            self.verify()

    def test_missing_duplicate_or_cross_run_native_receipt_rejects(self):
        self.rows.pop()
        self.write_rows()
        with self.assertRaisesRegex(ValueError, 'RECEIPT_COUNT'):
            self.verify()
        self.rows.append(receipt(5))
        self.rows[1]['operation_id'] = self.rows[0]['operation_id']
        self.write_rows()
        with self.assertRaisesRegex(ValueError, 'RECEIPT_COUNT|RECEIPT_ID'):
            self.verify()
        self.rows[1] = receipt(1)
        self.rows[1]['run_id'] = 'other-run'
        self.write_rows()
        with self.assertRaisesRegex(ValueError, 'RECEIPT_SCOPE'):
            self.verify()

    def test_symlink_and_unbounded_native_receipt_reject(self):
        target = next(self.root.glob('*.json'))
        bytes_before = target.read_bytes()
        target.unlink()
        target.symlink_to(self.root / 'elsewhere.json')
        with self.assertRaisesRegex(ValueError, 'RECEIPT_FILE'):
            self.verify()
        target.unlink()
        target.write_bytes(bytes_before + b' ' * 1048577)
        with self.assertRaisesRegex(ValueError, 'RECEIPT_FILE'):
            self.verify()

    def test_safe_desktop_requires_current_focus_equal_resolved_home(self):
        launcher = 'packageName=com.hihonor.android.launcher\n'
        focus = 'mCurrentFocus=Window{abc u0 com.hihonor.android.launcher/.Launcher}\n'
        self.assertEqual(MODULE.verify_safe_desktop(SERIAL, launcher, focus)['launcher'],
                         'com.hihonor.android.launcher')
        with self.assertRaisesRegex(ValueError, 'DESKTOP_FOCUS'):
            MODULE.verify_safe_desktop(SERIAL, launcher,
                'mCurrentFocus=Window{abc u0 com.ss.android.ugc.aweme/.Main}\n')
        with self.assertRaisesRegex(ValueError, 'DESKTOP_LAUNCHER'):
            MODULE.verify_safe_desktop(SERIAL, '', focus)

    def test_safe_desktop_rejects_conflicting_current_app_or_wrong_serial(self):
        launcher = 'packageName=com.hihonor.android.launcher\n'
        focus = ('mCurrentFocus=Window{abc u0 com.hihonor.android.launcher/.Launcher}\n'
                 'mFocusedApp=ActivityRecord{abc u0 com.ss.android.ugc.aweme/.Main}\n')
        with self.assertRaisesRegex(ValueError, 'DESKTOP_FOCUS'):
            MODULE.verify_safe_desktop(SERIAL, launcher, focus)
        with self.assertRaisesRegex(ValueError, 'DESKTOP_SERIAL'):
            MODULE.verify_safe_desktop('wrong serial', launcher,
                'mCurrentFocus=Window{abc u0 com.hihonor.android.launcher/.Launcher}\n')


if __name__ == '__main__':
    unittest.main()
