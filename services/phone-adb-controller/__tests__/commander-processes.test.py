"""安全隔离进程实证：Agent终态不能替代helper/脱离session子孙终态。"""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import http.server
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
        self.sandboxed = sys.platform == 'darwin' and Path('/usr/bin/sandbox-exec').is_file()
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
        self.assertEqual(self.fence()['execution_stopped'], self.sandboxed)

    def test_detached_child_is_not_hidden_by_completed_primary_helper(self):
        script = self.home / 'detach.py'
        pidfile = self.home / 'escaped-pid'
        script.write_text('import subprocess,sys\nsubprocess.Popen([sys.executable,"-c",' + repr('import os,time,pathlib;pathlib.Path(' + repr(str(pidfile)) + ').write_text(str(os.getpid()));time.sleep(8)') + '],start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n')
        result = gateway.invoke(script, [], self.e)
        if self.sandboxed:
            self.assertNotEqual(result['exit_code'], 0)
            self.assertFalse(pidfile.exists(), 'kernel must reject child creation even without inherited nonce')
            self.assertTrue(self.fence()['execution_stopped'])
            return
        while not pidfile.exists():
            time.sleep(.01)
        pid = int(pidfile.read_text())
        self.addCleanup(lambda: os.kill(pid, signal.SIGKILL) if self.alive(pid) else None)
        receipt = self.fence()
        self.assertFalse(receipt['execution_stopped'] and self.alive(pid), 'detached helper child falsely disappears at root exit')

    def test_exact_stop_reads_kernel_before_confirming_detached_child_terminal(self):
        self.test_detached_child_is_not_hidden_by_completed_primary_helper()
        receipt = self.fence(stop=True)
        self.assertEqual(receipt['execution_stopped'], self.sandboxed)
        registry = json.loads((self.directory / 'helper-processes.json').read_text())
        self.assertTrue(registry['fenced'])
        self.assertTrue(all(x['known_pids_stopped'] and x['kernel_stopped'] == self.sandboxed and not x['live'] for x in registry['helpers'].values()))

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
            self.assertFalse(registry.observe(fence=True, stop=True))
            kill.assert_not_called()

    def test_readback_probe_registers_detached_children(self):
        script = self.home / 'probe.py'
        pidfile = self.home / 'probe-child'
        script.write_text('import subprocess,sys,json\nsubprocess.Popen([sys.executable,"-c",' + repr('import os,time,pathlib;pathlib.Path(' + repr(str(pidfile)) + ').write_text(str(os.getpid()));time.sleep(8)') + '],start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\nprint(json.dumps({"status":"none","receipt":{"actual_readback":True}}))\n')
        self.e['contract']['action_bindings'] = [{'key': 'safe-task:probe', 'action': 'publish', 'object': {'task_id': 'safe-task', 'account_ref': None}, 'scope': {},
            'readback': {'path': 'probe.py', 'digest': hashlib.sha256(script.read_bytes()).hexdigest(), 'args': []}}]
        self.store.execute('safe-task:probe', lambda: {'status': 'unknown', 'intent': 'isolated'})
        if self.sandboxed:
            with self.assertRaisesRegex(ValueError, 'readback helper failed'):
                gateway.actions.readback_helper(self.e, 'safe-task:probe', self.home)
            self.assertFalse(pidfile.exists())
            self.assertTrue(self.fence()['execution_stopped'])
            return
        result = gateway.actions.readback_helper(self.e, 'safe-task:probe', self.home)
        self.assertEqual(result['status'], 'none')
        while not pidfile.exists():
            time.sleep(.01)
        pid = int(pidfile.read_text())
        self.addCleanup(lambda: os.kill(pid, signal.SIGKILL) if self.alive(pid) else None)
        self.assertFalse(self.fence()['execution_stopped'])
        self.assertFalse(self.fence(stop=True)['execution_stopped'])

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
        result = gateway.invoke(script, [], self.e)
        if self.sandboxed:
            self.assertNotEqual(result['exit_code'], 0)
            self.assertFalse(pidfile.exists(), 'kernel must reject child creation even without inherited nonce')
            self.assertTrue(self.fence()['execution_stopped'])
            return
        while not pidfile.exists():
            time.sleep(.01)
        pid = int(pidfile.read_text())
        self.addCleanup(lambda: os.kill(pid, signal.SIGKILL) if self.alive(pid) else None)
        self.assertFalse(self.fence()['execution_stopped'], 'empty nonce census cannot prove arbitrary helper process boundary')
        self.assertFalse(self.fence(stop=True)['execution_stopped'])
        self.assertFalse(self.store.state()['stopped'])

    def test_mechanically_child_free_python_subset_can_close_and_seal_lifecycle(self):
        script = self.home / 'literal.py'
        script.write_text('import json\nprint(json.dumps({"actual_isolated_output": 1}))\n')
        result = gateway.invoke(script, [], self.e)
        self.assertEqual(json.loads(result['stdout']), {'actual_isolated_output': 1})
        self.assertTrue(self.fence()['execution_stopped'])
        state = json.loads((self.directory / 'helper-processes.json').read_text())
        self.assertTrue(state['sealed'])
        self.assertTrue(all(x['boundary_verified'] and x['kernel_stopped'] for x in state['helpers'].values()))
        processes = gateway.module('wf-v2-processes')
        with self.assertRaisesRegex(ValueError, 'sealed'):
            processes.Registry(self.e).run([os.sys.executable, str(script)], os.environ.copy(), 2, 'readback', source=script)
        for text in ('import subprocess\n', 'import json as os\n', 'print(__import__("os").fork())\n', 'print(json.dumps({}, default=eval))\n'):
            script.write_text(text)
            self.assertIsNone(processes.child_free_source(script))

    def test_posix_spawn_with_clean_environment_is_kernel_rejected(self):
        if not self.sandboxed:
            self.skipTest('Darwin process-fork contract unavailable; generic helper remains inconclusive')
        target = self.home / 'must-not-exist'
        script = self.home / 'posix-spawn.py'
        script.write_text('import os,sys\nos.posix_spawn(sys.executable,[sys.executable,"-c",' + repr('import pathlib;pathlib.Path(' + repr(str(target)) + ').write_text("escaped")') + '],{})\n')
        result = gateway.invoke(script, [], self.e)
        self.assertNotEqual(result['exit_code'], 0)
        self.assertFalse(target.exists())
        self.assertTrue(self.fence()['execution_stopped'])

    def test_actual_http_readback_produces_report_before_process_terminal(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"actual_report_count": 7}')
            def log_message(self, *_):
                pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join)
        self.addCleanup(server.shutdown)
        report = self.home / 'report.json'
        script = self.home / 'http-report.py'
        script.write_text('import json,urllib.request,pathlib\nx=json.load(urllib.request.urlopen(' + repr('http://127.0.0.1:' + str(server.server_port) + '/report') + '))\npathlib.Path(' + repr(str(report)) + ').write_text(json.dumps(x))\nprint(json.dumps(x))\n')
        result = gateway.invoke(script, [], self.e)
        self.assertEqual(result['exit_code'], 0, result['stderr'])
        self.assertEqual(json.loads(report.read_text()), {'actual_report_count': 7})
        self.assertEqual(json.loads(result['stdout']), json.loads(report.read_text()))
        self.assertEqual(self.fence()['execution_stopped'], self.sandboxed)

    def test_fence_seals_before_remote_roundtrip_and_consumes_remote_terminal(self):
        processes = gateway.module('wf-v2-processes')
        self.e['contract']['resources'] = {'account_ref': 'isolated'}
        original_module = gateway.module
        registry = processes.Registry(self.e)
        receipt = {k: self.e[k] for k in ('protocol', 'task_id', 'run_id', 'owner_epoch')}
        receipt.update(execution_fenced=True, execution_stopped=False)
        phone = __import__('unittest.mock', fromlist=['Mock']).Mock()
        def remote(*args, **kwargs):
            with self.assertRaisesRegex(ValueError, 'sealed'):
                registry.run([sys.executable, '-c', 'print(1)'], os.environ.copy(), 2, 'readback')
            return receipt
        phone.policy.side_effect = remote
        phone.cleanup_deadline = time.time() + 10
        module = __import__('unittest.mock', fromlist=['Mock']).Mock()
        module.Phone.return_value = phone
        with patch.object(gateway, 'module', side_effect=lambda name: module if name == 'wf-v2-phone' else original_module(name)):
            result = self.fence()
        self.assertFalse(result['execution_stopped'])
        self.assertFalse(self.store.state()['stopped'])

    def test_finalize_rejects_remote_unknown_and_wrong_identity_before_cleanup(self):
        worker = gateway.module('wf-v2')
        self.e['activity_bindings'] = [{'primary_implementation': {'implementation': {'kind': 'skill'}}}]
        gateway.io.write(self.directory / 'agent-completion.json', {'status': 'ok'})
        gateway.io.write(self.directory / 'agent-delivery.json', {'outputs': {}, 'evidence': [], 'effects': [], 'status': 'completed'})
        for mismatch in ('unknown', 'identity'):
            receipt = {k: self.e[k] for k in ('protocol', 'task_id', 'run_id', 'owner_epoch')}
            receipt.update(execution_fenced=True, execution_stopped=mismatch != 'unknown')
            if mismatch == 'identity':
                receipt['run_id'] = 'other-run'
            phone = __import__('unittest.mock', fromlist=['Mock']).Mock()
            phone.policy.return_value = receipt
            with self.assertRaisesRegex(ValueError, 'phone execution fencing'):
                worker.finalize(self.directory, self.e, phone)
            phone.cleanup.assert_not_called()
            self.assertFalse(self.store.state()['stopped'])

    def test_worker_reentry_cannot_use_old_marker_to_bypass_remote_unknown(self):
        for marker in ('execution-failure.json', 'delivery.json'):
            worker = gateway.module('wf-v2')
            self.e['contract']['resources'] = {'account_ref': 'isolated'}
            self.e['activity_bindings'] = [{'primary_implementation': {'implementation': {'kind': 'skill'}}}]
            gateway.io.write(self.directory / 'envelope.json', self.e)
            gateway.io.write(self.directory / 'runtime.json', {'parent': 'agent:isolated'})
            gateway.io.write(self.directory / marker, {'reason': 'old-local-only-marker'})
            phone = __import__('unittest.mock', fromlist=['Mock']).Mock()
            phone.directory = self.directory
            receipt = {k: self.e[k] for k in ('protocol', 'task_id', 'run_id', 'owner_epoch')}
            phone.policy.return_value = dict(receipt, execution_fenced=True, execution_stopped=False)
            with patch.object(worker.phone_module, 'Phone', return_value=phone), patch.object(worker.phone_module.shell, 'recover'), patch.object(worker.io, 'replay'):
                worker.worker(self.directory)
            phone.cleanup.assert_not_called()
            self.assertFalse(gateway.io.read(self.directory / 'runtime.json')['execution_stopped'])
            self.assertFalse(self.store.state()['stopped'])
            (self.directory / marker).unlink()

    @staticmethod
    def alive(pid):
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False


if __name__ == '__main__':
    unittest.main()
