"""守卫：仅传本事件真图，远端hash错拒绝，传输失败不重做手机输入。"""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge import State
from test_cs_phone import PhoneDouble
import cs_phone


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('artifact_transport'), '图片节点传输尚未实现')
        self.module = __import__('artifact_transport')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = State(self.root / 'state.db')
        self.addCleanup(self.state.close)
        self.event = 'a' * 64
        self.state.claim(dict(event_id=self.event, sender='苏小妖', text='你好'))
        self.state.set_draft(self.event, dict(reply='您好', message_id=17))
        event_root = self.root / self.event
        event_root.mkdir()
        self.phone = PhoneDouble(event_root)
        self.controller = cs_phone.Controller(self.state, self.event, self.phone)
        self.transport = dict(ssh_config=str(self.root / 'ssh.conf'), host='session-runner',
                              remote_root=str(self.root / 'remote'))
        self.calls = []
        self.hash_mismatch = False

    def runner(self, args, **kwargs):
        self.calls.append((args, kwargs))
        self.assertEqual(kwargs['timeout'], 120 if args[0] == 'scp' else 30)
        self.assertIsInstance(args, list)
        self.assertIn('BatchMode=yes', args)
        if args[0] == 'ssh':
            if self.hash_mismatch and args[-1].startswith('shasum '):
                return subprocess.CompletedProcess(args, 0, '0' * 64 + ' file.png\n', '')
            return subprocess.run(['/bin/sh', '-c', args[-1]], capture_output=True, text=True)
        self.assertEqual(args[0], 'scp')
        source, destination = args[-2:]
        host, remote = destination.split(':', 1)
        self.assertEqual(host, 'session-runner')
        shutil.copy2(source, remote)
        return subprocess.CompletedProcess(args, 0, '', '')

    def screenshot(self):
        result = self.controller.execute('screenshot', [])
        path = Path(result['after']['screenshot'])
        path.chmod(0o600)
        return path

    def test_registered_event_png_reaches_model_node_with_matching_hash(self):
        source = self.screenshot()
        view = self.module.transfer(source, self.event, self.state, self.transport, self.runner)
        target = Path(view['path'])
        self.assertEqual(target.read_bytes(), source.read_bytes())
        self.assertEqual(view['node'], 'session-runner')
        self.assertEqual(view['sha256'], __import__('hashlib').sha256(source.read_bytes()).hexdigest())
        self.assertEqual(target.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_default_entry_uses_scp_budget_for_transfer_slower_than_30_seconds(self):
        source = self.screenshot()
        def delayed_runner(args, **kwargs):
            if args[0] == 'scp' and kwargs['timeout'] <= 31:
                raise subprocess.TimeoutExpired(args, kwargs['timeout'])
            return self.runner(args, **kwargs)
        with patch.object(self.module, 'run_transport_command', side_effect=delayed_runner):
            result = self.module.transfer(source, self.event, self.state, self.transport)
        self.assertEqual(Path(result['path']).read_bytes(), source.read_bytes())
        self.assertEqual([args[0] for args, _ in self.calls], ['ssh', 'ssh', 'scp', 'ssh'])

    def test_remote_hash_mismatch_is_not_reported_as_model_view(self):
        source = self.screenshot()
        self.hash_mismatch = True
        with self.assertRaises(ValueError):
            self.module.transfer(source, self.event, self.state, self.transport, self.runner)

    def test_unregistered_or_wrong_event_or_unsafe_remote_path_never_copies(self):
        source = self.screenshot()
        for path, event, config in [(self.root / 'not-registered.png', self.event, self.transport),
                                   (source, 'b' * 64, self.transport),
                                   (source, self.event, self.transport | dict(remote_root='/tmp/x;touch injected'))]:
            with self.assertRaises((ValueError, OSError)):
                self.module.transfer(path, event, self.state, config, self.runner)
        self.assertEqual(self.calls, [])

    def test_transport_failure_after_input_does_not_repeat_phone_action(self):
        execute = getattr(cs_phone, 'execute_and_transport', None)
        self.assertTrue(callable(execute), '动作后图片传输接入尚未实现')
        calls = []
        def fail(*args):
            calls.append(args)
            raise RuntimeError('transport down')
        with self.assertRaisesRegex(RuntimeError, 'image_transport_failed'):
            execute(self.controller, 'text-from-draft', [], dict(image_transport=self.transport), fail)
        self.assertEqual(self.state.action(self.event, 'input'), 'completed')
        self.assertEqual(len(self.phone.calls), 1)
        with self.assertRaises(ValueError):
            execute(self.controller, 'text-from-draft', [], dict(image_transport=self.transport), fail)
        self.assertEqual(len(self.phone.calls), 1)
        self.assertEqual(len(calls), 1)


class CommandLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.module = __import__('artifact_transport')

    def test_default_transfer_runner_supports_bounded_scp_without_retry(self):
        run = getattr(self.module, 'run_transport_command', None)
        self.assertTrue(callable(run), '传图进程组生命周期尚未实现')
        process = Mock(pid=4312, returncode=0)
        process.communicate.return_value = ('digest', '')
        with patch.object(self.module.subprocess, 'Popen', return_value=process) as spawn:
            result = run(['scp', 'original.png', 'node:/proof.png'], capture_output=True,
                         text=True, timeout=120)
        self.assertEqual(result.stdout, 'digest')
        self.assertTrue(spawn.call_args.kwargs['start_new_session'])
        process.communicate.assert_called_once_with(timeout=120)
        self.assertEqual(spawn.call_count, 1)

    def test_timeout_kills_process_group_reaps_and_never_retries(self):
        run = getattr(self.module, 'run_transport_command', None)
        self.assertTrue(callable(run), '传图超时尚未回收进程组')
        process = Mock(pid=4312)
        process.communicate.side_effect = [subprocess.TimeoutExpired(['scp'], 120), ('', '')]
        with patch.object(self.module.subprocess, 'Popen', return_value=process) as spawn, \
                patch.object(self.module.os, 'killpg') as kill:
            with self.assertRaises(subprocess.TimeoutExpired):
                run(['scp', 'original.png', 'node:/proof.png'], capture_output=True,
                    text=True, timeout=120)
        kill.assert_called_once_with(4312, self.module.signal.SIGKILL)
        self.assertEqual(process.communicate.call_args_list, [unittest.mock.call(timeout=120),
                                                           unittest.mock.call(timeout=2)])
        self.assertEqual(spawn.call_count, 1)

    def test_interruption_also_reaps_without_retry(self):
        run = getattr(self.module, 'run_transport_command', None)
        self.assertTrue(callable(run), '中断回收尚未实现')
        process = Mock(pid=4312)
        process.communicate.side_effect = [KeyboardInterrupt(), ('', '')]
        with patch.object(self.module.subprocess, 'Popen', return_value=process) as spawn, \
                patch.object(self.module.os, 'killpg') as kill:
            with self.assertRaises(KeyboardInterrupt):
                run(['ssh', 'node', 'mkdir'], capture_output=True, text=True, timeout=30)
        kill.assert_called_once_with(4312, self.module.signal.SIGKILL)
        self.assertEqual(process.communicate.call_args_list[-1], unittest.mock.call(timeout=2))
        self.assertEqual(spawn.call_count, 1)
