"""安全隔离进程实证：Agent终态不能替代helper/脱离session子孙终态。"""
import importlib.util
import hashlib
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
        self.addCleanup(lambda: gateway.module('wf-v2-processes').Registry(self.e).observe(fence=True, stop=True))

    def fence(self, stop=False):
        return gateway.fence(self.e, {**{k: self.e[k] for k in ('task_id', 'run_id', 'owner_epoch')}, 'reason': 'isolated-test', 'stop_helpers': stop})

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
        self.assertTrue(self.fence()['execution_stopped'])

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

    def test_exact_stop_reads_kernel_before_confirming_detached_child_terminal(self):
        self.test_detached_child_is_not_hidden_by_completed_primary_helper()
        receipt = self.fence(stop=True)
        self.assertTrue(receipt['execution_stopped'])
        registry = json.loads((self.directory / 'helper-processes.json').read_text())
        self.assertTrue(registry['fenced'])
        self.assertTrue(all(x['kernel_stopped'] and not x['live'] for x in registry['helpers'].values()))

    def test_unread_pid_intent_and_reused_pid_never_authorize_killing_new_process(self):
        processes = gateway.module('wf-v2-processes')
        registry = processes.Registry(self.e)
        state = registry.state()
        state['helpers']['unknown'] = {'intent_at': time.time()}
        gateway.actions.write(registry.path, state)
        self.assertFalse(registry.observe(fence=True, stop=True))
        state['helpers'] = {'reused': {'root': {'pid': os.getpid(), 'birth': 'old-birth'}, 'identities': []}}
        gateway.actions.write(registry.path, state)
        with patch.object(processes, 'census', return_value=[]), patch.object(processes.os, 'kill') as kill:
            self.assertTrue(registry.observe(fence=True, stop=True))
            kill.assert_not_called()

    def test_readback_probe_registers_detached_children(self):
        script = self.home / 'probe.py'
        pidfile = self.home / 'probe-child'
        script.write_text('import subprocess,sys,json\nsubprocess.Popen([sys.executable,"-c",' + repr('import os,time,pathlib;pathlib.Path(' + repr(str(pidfile)) + ').write_text(str(os.getpid()));time.sleep(8)') + '],start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\nprint(json.dumps({"status":"none","receipt":{"actual_readback":True}}))\n')
        self.e['contract']['action_bindings'] = [{'key': 'safe-task:probe', 'action': 'publish', 'object': {'task_id': 'safe-task', 'account_ref': None}, 'scope': {},
            'readback': {'path': 'probe.py', 'digest': hashlib.sha256(script.read_bytes()).hexdigest(), 'args': []}}]
        self.store.execute('safe-task:probe', lambda: {'status': 'unknown', 'intent': 'isolated'})
        result = gateway.actions.readback_helper(self.e, 'safe-task:probe', self.home)
        self.assertEqual(result['status'], 'none')
        while not pidfile.exists():
            time.sleep(.01)
        pid = int(pidfile.read_text())
        self.addCleanup(lambda: os.kill(pid, signal.SIGKILL) if self.alive(pid) else None)
        self.assertFalse(self.fence()['execution_stopped'])
        self.assertTrue(self.fence(stop=True)['execution_stopped'])

    def test_finalize_cannot_release_phone_while_helper_kernel_terminal_unknown(self):
        worker = gateway.module('wf-v2')
        gateway.io.write(self.directory / 'agent-completion.json', {'status': 'ok'})
        gateway.io.write(self.directory / 'agent-delivery.json', {'outputs': {}, 'evidence': [], 'effects': [], 'status': 'completed'})
        processes = gateway.module('wf-v2-processes')
        registry = processes.Registry(self.e)
        state = registry.state()
        state['helpers']['unconfirmed'] = {'intent_at': time.time()}
        gateway.actions.write(registry.path, state)
        phone = __import__('unittest.mock', fromlist=['Mock']).Mock()
        with self.assertRaisesRegex(ValueError, 'helper kernel terminal'):
            worker.finalize(self.directory, self.e, phone)
        phone.cleanup.assert_not_called()
        phone.policy.assert_not_called()
        self.assertFalse((self.directory / 'cleanup.json').exists())

    def test_shared_repo_relative_probe_executes_from_exact_installed_manifest(self):
        sample_path = HERE.parent / '__tests__/fixtures/commander-contract-v1.json'
        sample = json.loads(sample_path.read_text())
        self.assertEqual(hashlib.sha256(sample_path.read_bytes()).hexdigest(), 'e76716486c44617c9f99448600cf2542383a361fc845d609c98add8c0bdd458f')
        runtime = self.home / 'installed-commander'
        runtime.mkdir()
        files = {}
        prefix = 'services/phone-adb-controller/commander/'
        for source, text in sample['source_files'].items():
            relative = source.removeprefix(prefix)
            target = runtime / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
            files[relative] = hashlib.sha256(target.read_bytes()).hexdigest()
        (runtime / 'runtime-manifest.json').write_text(json.dumps({'files': files}))
        self.e.update(task_id=sample['task']['id'], contract=sample['contract'], input=sample['task']['payload']['workflow_input'])
        self.e['action_bindings'] = gateway.actions.derive_action_bindings(self.e)
        store = gateway.actions.ActionStore(self.e)
        store.admit()
        key = self.e['action_bindings'][0]['key']
        store.execute(key, lambda: {'status': 'unknown', 'intent': 'safe-source-fixture'})
        result = gateway.actions.readback_helper(self.e, key, runtime)
        self.assertEqual({k: result[k] for k in ('status', 'receipt', 'activity_facts')}, sample['probe_readback'])

    def test_clean_environment_detached_child_cannot_be_falsely_proven_stopped(self):
        script = self.home / 'clean-env-child.py'
        pidfile = self.home / 'clean-child'
        script.write_text('import subprocess,sys\nsubprocess.Popen([sys.executable,"-c",' + repr('import os,time,pathlib;pathlib.Path(' + repr(str(pidfile)) + ').write_text(str(os.getpid()));time.sleep(8)') + '],env={},start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n')
        gateway.invoke(script, [], self.e)
        while not pidfile.exists():
            time.sleep(.01)
        pid = int(pidfile.read_text())
        self.addCleanup(lambda: os.kill(pid, signal.SIGKILL) if self.alive(pid) else None)
        self.assertFalse(self.fence()['execution_stopped'], 'empty nonce census cannot prove arbitrary helper process boundary')
        self.assertFalse(self.fence(stop=True)['execution_stopped'])
        self.assertFalse(self.store.state()['stopped'])

    @staticmethod
    def alive(pid):
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False


if __name__ == '__main__':
    unittest.main()
