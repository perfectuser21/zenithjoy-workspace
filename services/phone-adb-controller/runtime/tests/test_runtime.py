"""真实本地 shell 模拟远端：stdin 在传完字节后保持打开，复现 EOF 等待。"""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import socket
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent.parent


def load(test, filename):
    path = HERE / filename
    test.assertTrue(path.is_file(), 'runtime implementation is missing: ' + filename)
    spec = importlib.util.spec_from_file_location(filename.replace('-', '_'), path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class RuntimeFixture(unittest.TestCase):
    def setUp(self):
        self.runtime = load(self, 'scrcpy-runtime.py')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.package = self.root / 'runtime'
        self.package.mkdir()
        self.client = b'isolated client fixture'
        self.server = b'fixed-byte-server\x00' * 4096
        self.client_sha = hashlib.sha256(self.client).hexdigest()
        self.server_sha = hashlib.sha256(self.server).hexdigest()
        self.policy = dict(self.runtime.POLICY)
        self.policy.update(client_sha256=self.client_sha, server_sha256=self.server_sha)
        self.patcher = patch.object(self.runtime, 'POLICY', self.policy)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        # Network boundary is fake; never contact a real local ADB server.
        self.bridge = patch.object(self.runtime, 'require_existing_server', lambda *args: None)
        self.bridge.start()
        self.addCleanup(self.bridge.stop)
        (self.package / 'scrcpy').write_bytes(self.client)
        (self.package / 'scrcpy').chmod(0o755)
        (self.package / 'scrcpy-server').write_bytes(self.server)
        self.remote = self.root / 'remote'
        self.remote.mkdir()
        self.lock = self.root / 'phone.lock'
        self.lock.mkdir()
        (self.lock / 'owner').write_text('test-owner\n')
        self.evidence = self.root / 'evidence'
        self.evidence.mkdir()
        self.log = self.root / 'adb.jsonl'
        self.env = patch.dict(os.environ, {
            'FAKE_ADB_REMOTE_ROOT': str(self.remote),
            'FAKE_ADB_LOG': str(self.log),
            'FAKE_ADB_MODE': '',
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.config = dict(runtime_root=self.package, client_sha256=self.client_sha,
            adb_bin=Path(__file__).with_name('fake_adb.py'), adb_port=5041,
            serial='47.100.213.173:10001', owner='test-owner', lock_dir=self.lock,
            evidence_root=self.evidence, evidence_id='sample1', timeout=4)

    def stage(self):
        return self.runtime.stage_server(**self.config)


class RuntimeTests(RuntimeFixture):
    def test_verify_hashes_files_and_rejects_tampered_client(self):
        result = self.runtime.verify_runtime(self.package, self.client_sha)
        self.assertTrue(result['verified'])
        self.assertEqual(result['server_sha256'], self.server_sha)
        (self.package / 'scrcpy').write_bytes(b'changed')
        with self.assertRaises(self.runtime.RuntimeFailure):
            self.runtime.verify_runtime(self.package, self.client_sha)

    def test_symlink_package_file_is_refused(self):
        (self.package / 'scrcpy-server').unlink()
        other = self.root / 'other'
        other.write_bytes(self.server)
        (self.package / 'scrcpy-server').symlink_to(other)
        with self.assertRaises(self.runtime.RuntimeFailure):
            self.runtime.verify_runtime(self.package, self.client_sha)

    def test_fixed_byte_receive_completes_without_remote_stdin_eof(self):
        result = self.stage()
        self.assertTrue(result['verified'])
        self.assertFalse(result['execution_stop_unknown'])
        self.assertEqual((self.remote / 'scrcpy-server.jar').read_bytes(), self.server)
        self.assertEqual(list(self.remote.glob('*.stage-*')), [])
        receipt = json.loads(Path(result['stage_receipt']).read_text())
        self.assertEqual(receipt['phase'], 'verified')
        self.assertEqual(receipt['received_bytes'], len(self.server))

    def test_existing_foreign_destination_is_not_overwritten(self):
        destination = self.remote / 'scrcpy-server.jar'
        destination.write_bytes(b'foreign')
        result = self.stage()
        self.assertFalse(result['verified'])
        self.assertEqual(destination.read_bytes(), b'foreign')
        self.assertEqual(list(self.remote.glob('*.stage-*')), [])

    def test_matching_destination_is_reused_without_upload(self):
        (self.remote / 'scrcpy-server.jar').write_bytes(self.server)
        result = self.stage()
        self.assertTrue(result['verified'])
        calls = self.log.read_text()
        self.assertNotIn('head -c', calls)
        self.assertEqual(result['mode'], 'reused')

    def test_wrong_owner_makes_no_adb_call(self):
        (self.lock / 'owner').write_text('foreign\n')
        result = self.stage()
        self.assertFalse(result['verified'])
        self.assertFalse(self.log.exists())

    def test_corrupt_receive_never_publishes(self):
        os.environ['FAKE_ADB_MODE'] = 'corrupt'
        result = self.stage()
        self.assertFalse(result['verified'])
        self.assertFalse((self.remote / 'scrcpy-server.jar').exists())

    def test_concurrent_publication_is_not_overwritten(self):
        os.environ['FAKE_ADB_MODE'] = 'publish-race'
        result = self.stage()
        self.assertFalse(result['verified'])
        self.assertEqual((self.remote / 'scrcpy-server.jar').read_bytes(), b'foreign-race')

    def test_receive_timeout_is_unknown_and_retains_evidence(self):
        os.environ['FAKE_ADB_MODE'] = 'hang-upload'
        self.config['timeout'] = 0.4
        result = self.stage()
        self.assertFalse(result['verified'])
        self.assertTrue(result['execution_stop_unknown'])
        receipt = json.loads(Path(result['stage_receipt']).read_text())
        self.assertTrue(receipt['execution_stop_unknown'])
        self.assertFalse((self.remote / 'scrcpy-server.jar').exists())

    def test_existing_temporary_file_is_not_clobbered_or_deleted(self):
        temporary = self.remote / 'zj-scrcpy.stage-collision'
        temporary.write_bytes(b'foreign-temporary')
        with patch.object(self.runtime.uuid, 'uuid4', return_value=SimpleNamespace(hex='collision')):
            result = self.stage()
        self.assertFalse(result['verified'])
        self.assertTrue(result['execution_stop_unknown'])
        self.assertEqual(temporary.read_bytes(), b'foreign-temporary')
        self.assertFalse((self.remote / 'scrcpy-server.jar').exists())


class ShimTests(RuntimeFixture):
    def setUp(self):
        super().setUp()
        self.shimenv = patch.dict(os.environ, {
            'ZJ_SCRCPY_RUNTIME_ROOT': str(self.package),
            'ZJ_SCRCPY_CLIENT_SHA256': self.client_sha,
            'ZJ_SCRCPY_ADB_BIN': str(self.config['adb_bin']),
            'ZJ_SCRCPY_ADB_PORT': '5041',
            'ZJ_SCRCPY_SERIAL': self.config['serial'],
            'ZJ_SCRCPY_OWNER': self.config['owner'],
            'ZJ_SCRCPY_LOCK_DIR': str(self.lock),
            'ZJ_SCRCPY_EVIDENCE_ROOT': str(self.evidence),
            'ZJ_SCRCPY_EVIDENCE_ID': 'shim-test',
            'ZJ_SCRCPY_STAGE_TIMEOUT': '4',
        })
        self.shimenv.start()
        self.addCleanup(self.shimenv.stop)

    def shim(self, args):
        function = getattr(self.runtime, 'adb_shim', None)
        self.assertTrue(callable(function), 'exact pinned ADB push shim is missing')
        with contextlib.redirect_stderr(io.StringIO()):
            return function(args)

    def test_exact_push_uses_fixed_byte_stage(self):
        code = self.shim(['-s', self.config['serial'], 'push',
                          str(self.package / 'scrcpy-server'),
                          '/data/local/tmp/scrcpy-server.jar'])
        self.assertEqual(code, 0)
        self.assertEqual((self.remote / 'scrcpy-server.jar').read_bytes(), self.server)

    def test_other_serial_and_arbitrary_push_are_refused(self):
        self.assertEqual(self.shim(['-s', 'foreign', 'push',
            str(self.package / 'scrcpy-server'), '/data/local/tmp/scrcpy-server.jar']), 64)
        self.assertEqual(self.shim(['-s', self.config['serial'], 'push',
            str(self.package / 'scrcpy-server'), '/data/local/tmp/arbitrary']), 64)
        self.assertFalse(self.log.exists())

    def test_server_start_request_only_checks_existing_bridge(self):
        self.assertEqual(self.shim(['start-server']), 0)
        self.assertFalse(self.log.exists())

    def test_destructive_or_unexpected_shell_commands_are_refused(self):
        for args in (['kill-server'], ['keygen', 'anything'],
                     ['-s', self.config['serial'], 'shell', 'rm', '-rf', '/']):
            self.assertEqual(self.shim(args), 64)
        self.assertFalse(self.log.exists())


class BuildTests(unittest.TestCase):
    def test_adopt_is_hash_pinned_and_no_clobber(self):
        module = load(self, 'build-scrcpy-runtime.py')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            client, server, output = root / 'client', root / 'server', root / 'package'
            client.write_bytes(b'client')
            server.write_bytes(b'server')
            client.chmod(0o755)
            policy = dict(module.POLICY, client_sha256=hashlib.sha256(b'client').hexdigest(),
                          server_sha256=hashlib.sha256(b'server').hexdigest())
            with patch.object(module, 'POLICY', policy):
                result = module.adopt_runtime(client, server, output)
                self.assertEqual((output / 'scrcpy').read_bytes(), b'client')
                self.assertTrue(result['verified'])
                self.assertEqual(output.stat().st_mode & 0o777, 0o555)
                self.assertEqual((output / 'scrcpy').stat().st_mode & 0o777, 0o555)
                self.assertEqual((output / 'scrcpy-server').stat().st_mode & 0o777, 0o444)
                with self.assertRaises(Exception):
                    module.adopt_runtime(client, server, output)
                empty = root / 'preexisting-empty'
                empty.mkdir()
                with self.assertRaises(Exception):
                    module.adopt_runtime(client, server, empty)
                self.assertEqual(list(empty.iterdir()), [])
                client.write_bytes(b'unapproved')
                with self.assertRaises(Exception):
                    module.adopt_runtime(client, server, root / 'other-package')
                self.assertFalse((root / 'other-package').exists())


class ProtocolTests(unittest.TestCase):
    def test_protocol_mismatch_is_refused_before_adb_can_restart_server(self):
        runtime = load(self, 'scrcpy-runtime.py')
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            def serve():
                connection, _ = listener.accept()
                with connection:
                    connection.recv(16)
                    connection.sendall(b'OKAY0004002a')  # 42 differs from pinned 41
            thread = threading.Thread(target=serve)
            thread.start()
            try:
                with self.assertRaises(runtime.RuntimeFailure):
                    runtime.require_existing_server(listener.getsockname()[1])
            finally:
                thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
