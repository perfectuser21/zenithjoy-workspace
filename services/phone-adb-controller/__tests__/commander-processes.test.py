"""安全隔离进程实证：Agent终态不能替代helper/脱离session子孙终态。"""
import importlib.util
import json
import os
from pathlib import Path
import signal
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1] / 'commander'
spec = importlib.util.spec_from_file_location('lifecycle_gateway', HERE / 'wf-v2-gateway.py')
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class LifecycleTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.home_patch = patch.dict(os.environ, HOME=str(self.home))
        self.home_patch.start()
        self.addCleanup(self.home_patch.stop)
        self.e = {'protocol': 'commander-v2', 'task_id': 'safe-task', 'run_id': 'safe-run', 'attempt': 1, 'owner_epoch': 1,
                  'input_sha256': 'a' * 64, 'input': {}, 'contract': {'resources': {}},
                  'deadline_at': time.time() + 10, 'cleanup_deadline_at': time.time() + 15}
        self.directory = self.home / 'wf-agent-runs/safe-run'
        self.directory.mkdir(parents=True)
        gateway.io.write(self.directory / 'envelope.json', self.e)
        gateway.io.write(self.directory / 'agent-binding.json', {'child_run_id': 'official-safe'})
        gateway.io.write(self.directory / 'agent-terminal.json', {'runId': 'official-safe', 'endedAt': 1})
        self.store = gateway.actions.ActionStore(self.e)
        self.store.admit()

    def fence(self):
        return gateway.fence(self.e, {**{k: self.e[k] for k in ('task_id', 'run_id', 'owner_epoch')}, 'reason': 'isolated-test'})

    def test_official_agent_terminal_with_live_helper_cannot_claim_stopped(self):
        script = self.home / 'sleep.py'
        pidfile = self.home / 'pid'
        script.write_text('import os,time,pathlib\npathlib.Path(' + repr(str(pidfile)) + ').write_text(str(os.getpid()))\ntime.sleep(3)\n')
        result = []
        thread = threading.Thread(target=lambda: result.append(gateway.invoke(script, [], self.e)))
        thread.start()
        self.addCleanup(thread.join)
        while not pidfile.exists():
            time.sleep(.01)
        receipt = self.fence()
        alive = self.alive(int(pidfile.read_text()))
        self.assertFalse(receipt['execution_stopped'] and alive, 'official Agent terminal falsely closes live helper')
        self.assertFalse(self.store.state()['stopped'] and alive)
        thread.join()

    def test_detached_child_is_not_hidden_by_completed_primary_helper(self):
        script = self.home / 'detach.py'
        pidfile = self.home / 'escaped-pid'
        script.write_text('import subprocess,sys\nsubprocess.Popen([sys.executable,"-c",' + repr('import os,time,pathlib;pathlib.Path(' + repr(str(pidfile)) + ').write_text(str(os.getpid()));time.sleep(8)') + '],start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n')
        gateway.invoke(script, [], self.e)
        while not pidfile.exists():
            time.sleep(.01)
        pid = int(pidfile.read_text())
        self.addCleanup(lambda: os.kill(pid, signal.SIGKILL) if self.alive(pid) else None)
        receipt = self.fence()
        self.assertFalse(receipt['execution_stopped'] and self.alive(pid), 'detached helper child falsely disappears at root exit')

    @staticmethod
    def alive(pid):
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False


if __name__ == '__main__':
    unittest.main()
