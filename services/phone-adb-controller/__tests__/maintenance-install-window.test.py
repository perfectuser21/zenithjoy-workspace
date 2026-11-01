import importlib.util
from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[1] / 'maintenance-install-window.py'
spec = importlib.util.spec_from_file_location('maintenance_install_window', SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MaintenanceWindowTests(unittest.TestCase):
    def setUp(self):
        self.harvest = (
            '15 22 * * * pgrep -f "^/bin/zsh .*(wf-run|harvest-cron)\\.sh .*ANGYVB4227006983" '
            '>/dev/null || /bin/zsh /Users/jinnuoshengyuan/bin-harvest/harvest-cron.sh '
            'jinoshengyuan-work ANGYVB4227006983 AI人工智能训练师 6 1 >/dev/null 2>&1\n'
        )
        self.outreach = '*/30 * * * * /bin/zsh /Users/jinnuoshengyuan/bin-harvest/outreach-tick.sh >/dev/null 2>&1\n'
        self.other = '50 * * * * /bin/date > /tmp/bridge-heartbeat\n'

    def test_only_review_harvest_schedule_is_removed(self):
        raw = self.harvest + self.outreach + self.other
        filtered, removed = module.select_cron(raw, {'ANGYVB4227006983'}, outreach_retired=True)
        self.assertEqual(filtered, self.outreach + self.other)
        self.assertEqual(removed, [self.harvest.rstrip('\n')])

    def test_unknown_auto_entry_or_nonretired_outreach_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'outreach'):
            module.select_cron(self.harvest + self.outreach, {'ANGYVB4227006983'}, outreach_retired=False)
        with self.assertRaisesRegex(ValueError, 'unknown'):
            module.select_cron(self.harvest + '0 * * * * /bin/zsh /tmp/leadgen-run.sh\n',
                               {'ANGYVB4227006983'}, outreach_retired=True)
        with self.assertRaisesRegex(ValueError, 'unknown|review'):
            module.select_cron(self.harvest, {'OTHER'}, outreach_retired=True)

    def test_interrupted_second_seal_is_not_auto_runnable_when_schedulers_closed_and_processes_end(self):
        filtered, _ = module.select_cron(self.harvest + self.outreach, {'ANGYVB4227006983'}, outreach_retired=True)
        module.verify_automatic_quiescence(filtered, {'ANGYVB4227006983'},
                                           recovery_disabled=True, recovery_loaded=False,
                                           process_table='342 /usr/bin/python3 /stable/adb-host-service.py run\n')
        with self.assertRaisesRegex(ValueError, 'recovery'):
            module.verify_automatic_quiescence(filtered, {'ANGYVB4227006983'},
                                               recovery_disabled=False, recovery_loaded=False,
                                               process_table='')
        with self.assertRaisesRegex(ValueError, 'process'):
            module.verify_automatic_quiescence(filtered, {'ANGYVB4227006983'},
                                               recovery_disabled=True, recovery_loaded=False,
                                               process_table='101 /bin/zsh /old/phone-candidate-runs/run.sh\n')

    def test_adb_relocation_preserves_active_source_bytes_and_stable_path(self):
        module.verify_adb_relocation({'adb-host-service.py': b'old-code', 'adb-existing-route.py': b'old-dep'},
                                     {'adb-host-service.py': b'old-code', 'adb-existing-route.py': b'old-dep'},
                                     '/Users/jinnuoshengyuan/.config/zenithjoy/adb-host-stable/old/adb-host-service.py',
                                     '/Users/jinnuoshengyuan/.local/share/zenithjoy/phone-candidates')
        with self.assertRaisesRegex(ValueError, 'bytes'):
            module.verify_adb_relocation({'adb-host-service.py': b'old-code', 'adb-existing-route.py': b'old-dep'},
                                         {'adb-host-service.py': b'new-code', 'adb-existing-route.py': b'old-dep'},
                                         '/Users/jinnuoshengyuan/.config/zenithjoy/adb-host-stable/old/adb-host-service.py',
                                         '/Users/jinnuoshengyuan/.local/share/zenithjoy/phone-candidates')


if __name__ == '__main__':
    unittest.main()
