import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]/'deployment-host.py'


class HostTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        spec = importlib.util.spec_from_file_location('phone_host',SOURCE)
        self.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)

    def test_durable_coordinator_record_is_immutable_and_decision_cas_protected(self):
        value={'source_commit':'a'*40,'transaction':'test'}
        self.mod.record(self.home,'test','coordinator',value,None)
        self.assertEqual(self.mod.record(self.home,'test','coordinator'),value)
        with self.assertRaisesRegex(ValueError,'immutable'):
            self.mod.record(self.home,'test','coordinator',{'different':True},value)
        self.mod.record(self.home,'test','decision','install',None)
        with self.assertRaisesRegex(ValueError,'CAS'):
            self.mod.record(self.home,'test','decision','restore',None)
        self.mod.record(self.home,'test','decision','commit','install')
        self.assertEqual(self.mod.record(self.home,'test','decision'),'commit')

    def test_unknown_paths_and_symlink_record_are_rejected(self):
        for name in ['../secrets','other','active']:
            with self.assertRaises(ValueError):
                self.mod.record(self.home,'test',name)
        path=self.home/'.local/share/zenithjoy/phone-transactions/test'
        path.parent.mkdir(parents=True)
        path.symlink_to(self.home,target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'symlink'):
            self.mod.record(self.home,'test','coordinator',{},None)

    def test_process_census_distinguishes_frozen_runs_and_live_writers(self):
        ps=''' 11 /opt/homebrew/bin/node /Users/test/bin-harvest/leadgen-rpc.mjs
 12 /bin/zsh /Users/test/bin-harvest/log-stream-push.sh
 13 /opt/homebrew/bin/node /Users/test/wf-runs/id/runtime/leadgen-workflow.mjs
 14 /usr/bin/python3 /Users/test/.local/share/zenithjoy/phone-deploy-tools/abc/deployment-host.py
'''
        self.assertEqual(self.mod.live_writers(Path('/Users/test'),ps),[11])


if __name__ == '__main__':
    unittest.main()
