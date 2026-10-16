"""两套固定runtime的真实函数与CLI边界；只使用临时fixture，不访问手机。"""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from test_runtime import RuntimeFixture, load


class RuntimeKindTests(RuntimeFixture):
    def setUp(self):
        super().setUp()
        self.sdk33 = self.root / 'sdk33'
        self.sdk33.mkdir()
        self.client33 = b'fixture sdk33 client 3.3.4'
        self.server33 = b'fixture sdk33 server 3.3.4\x00' * 4096
        self.policy33 = dict(self.policy, schema='scrcpy-sdk33-pinned-v1', version='3.3.4',
            client_sha256=hashlib.sha256(self.client33).hexdigest(),
            server_sha256=hashlib.sha256(self.server33).hexdigest(), server_bytes=len(self.server33))
        self.policy33.pop('patched_recorder_sha256', None)
        (self.sdk33 / 'scrcpy').write_bytes(self.client33)
        (self.sdk33 / 'scrcpy').chmod(0o755)
        (self.sdk33 / 'scrcpy-server').write_bytes(self.server33)
        (self.root / 'runtime-policy-sdk33.json').write_text(json.dumps(self.policy33))
        self.location = patch.object(self.runtime, '__file__', str(self.root / 'scrcpy-runtime.py'))
        self.location.start()
        self.addCleanup(self.location.stop)

    def verify33(self, root=None):
        return self.runtime.verify_runtime(root or self.sdk33, runtime_kind='sdk33')

    def config33(self):
        return dict(self.config, runtime_root=self.sdk33,
            client_sha256=self.policy33['client_sha256'], runtime_kind='sdk33')

    def test_default_sdk31_remains_existing_call(self):
        self.assertEqual(self.runtime.verify_runtime(self.package)['version'], self.policy['version'])

    def test_sdk33_selects_only_fixed_second_policy(self):
        result = self.verify33()
        self.assertTrue(result['verified'])
        self.assertEqual(result['version'], '3.3.4')
        self.assertEqual(result['server_sha256'], self.policy33['server_sha256'])

    def test_cli_sdk33_uses_fixed_kind(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = self.runtime.main(['verify', '--runtime-kind', 'sdk33', '--runtime-root', str(self.sdk33)])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output.getvalue())['version'], '3.3.4')

    def test_cli_unknown_kind_is_refused(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.runtime.main(['verify', '--runtime-kind', '../custom', '--runtime-root', str(self.sdk33)])

    def test_runtime_kinds_cannot_borrow_each_other_package(self):
        for kind, root in [('sdk33', self.package), ('sdk31', self.sdk33)]:
            with self.subTest(kind=kind), self.assertRaises(self.runtime.RuntimeFailure):
                self.runtime.verify_runtime(root, runtime_kind=kind)

    def test_cross_pair_server_is_refused_for_both_kinds(self):
        for kind, root, wrong in [('sdk31', self.package, self.server33), ('sdk33', self.sdk33, self.server)]:
            with self.subTest(kind=kind):
                original = (root / 'scrcpy-server').read_bytes()
                (root / 'scrcpy-server').write_bytes(wrong)
                with self.assertRaises(self.runtime.RuntimeFailure):
                    self.runtime.verify_runtime(root, runtime_kind=kind)
                (root / 'scrcpy-server').write_bytes(original)

    def test_sdk33_missing_policy_never_falls_back(self):
        (self.root / 'runtime-policy-sdk33.json').unlink()
        with self.assertRaises(self.runtime.RuntimeFailure):
            self.verify33(self.package)

    def test_sdk33_missing_package_never_falls_back(self):
        with self.assertRaises(self.runtime.RuntimeFailure):
            self.verify33(self.root / 'absent')

    def test_unknown_kind_rejected_even_when_sdk31_package_valid(self):
        for kind in ('', 'sdk32', '../runtime-policy', 'SDK33'):
            with self.subTest(kind=kind), self.assertRaises(self.runtime.RuntimeFailure):
                self.runtime.verify_runtime(self.package, runtime_kind=kind)

    def test_environment_cannot_supply_arbitrary_policy(self):
        custom = self.root / 'custom.json'
        custom.write_text(json.dumps(self.policy))
        with patch.dict(os.environ, {'ZJ_SCRCPY_POLICY': str(custom), 'ZJ_SCRCPY_RUNTIME_POLICY': str(custom)}):
            with self.assertRaises(self.runtime.RuntimeFailure):
                self.verify33(self.package)

    def test_stage_sdk33_pins_server_and_receipt(self):
        result = self.runtime.stage_server(**self.config33())
        self.assertTrue(result['verified'], result)
        self.assertEqual(result['version'], '3.3.4')
        self.assertEqual((self.remote / 'scrcpy-server.jar').read_bytes(), self.server33)
        receipt = json.loads(Path(result['stage_receipt']).read_text())
        self.assertEqual(receipt['client_sha256'], self.policy33['client_sha256'])
        self.assertEqual(receipt['server_sha256'], self.policy33['server_sha256'])

    def test_stage_sdk33_refuses_other_approved_server_without_overwrite(self):
        (self.remote / 'scrcpy-server.jar').write_bytes(self.server)
        result = self.runtime.stage_server(**self.config33())
        self.assertFalse(result['verified'])
        self.assertEqual((self.remote / 'scrcpy-server.jar').read_bytes(), self.server)
        self.assertNotIn('head -c', self.log.read_text())

    def shim_env(self, kind='sdk33'):
        config = self.config33()
        return {'ZJ_SCRCPY_RUNTIME_KIND': kind, 'ZJ_SCRCPY_RUNTIME_ROOT': str(self.sdk33),
            'ZJ_SCRCPY_CLIENT_SHA256': self.policy33['client_sha256'],
            **{'ZJ_SCRCPY_' + key: str(value) for key,value in {
                'ADB_BIN': config['adb_bin'], 'ADB_PORT': config['adb_port'], 'SERIAL': config['serial'],
                'OWNER': config['owner'], 'LOCK_DIR': config['lock_dir'],
                'EVIDENCE_ROOT': config['evidence_root'], 'EVIDENCE_ID': config['evidence_id'], 'STAGE_TIMEOUT': '4'}.items()}}

    def exact_push(self):
        return self.runtime.adb_shim(['-s', self.config['serial'], 'push',
            str(self.sdk33 / 'scrcpy-server'), '/data/local/tmp/scrcpy-server.jar'])

    def test_sdk33_shim_reuses_exact_receipt_readonly(self):
        result = self.runtime.stage_server(**self.config33())
        self.assertTrue(result['verified'], result)
        self.log.unlink()
        env = dict(self.shim_env(), ZJ_SCRCPY_STAGE_RECEIPT=result['stage_receipt'],
                   ZJ_SCRCPY_STAGE_RECEIPT_SHA256=result['stage_receipt_sha256'])
        with patch.dict(os.environ, env), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(self.exact_push(), 0)
        self.assertNotIn('head -c', self.log.read_text())

    def test_unknown_shim_kind_refuses_before_adb(self):
        with patch.dict(os.environ, self.shim_env('sdk32')), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(self.exact_push(), 64)
        self.assertFalse(self.log.exists())

    def test_sdk33_shim_refuses_sdk31_receipt(self):
        result = self.stage()
        self.assertTrue(result['verified'])
        self.log.unlink()
        env = dict(self.shim_env(), ZJ_SCRCPY_STAGE_RECEIPT=result['stage_receipt'],
                   ZJ_SCRCPY_STAGE_RECEIPT_SHA256=result['stage_receipt_sha256'])
        with patch.dict(os.environ, env), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(self.exact_push(), 64)
        self.assertFalse(self.log.exists())

    def test_sdk33_shim_only_executes_matching_server_version(self):
        def command(version):
            return ['-s', self.config['serial'], 'shell', 'CLASSPATH=/data/local/tmp/scrcpy-server.jar',
                    'app_process', '/', 'com.genymobile.scrcpy.Server', version, 'scid=12345678']
        with patch.dict(os.environ, self.shim_env()), contextlib.redirect_stderr(io.StringIO()), \
             patch.object(self.runtime.os, 'execve') as execute:
            self.assertEqual(self.runtime.adb_shim(command('5.0.1')), 64)
            execute.assert_not_called()
            self.runtime.adb_shim(command('3.3.4'))
            execute.assert_called_once()

    def test_builder_adopt_sdk33_closed_selection(self):
        builder = load(self, 'build-scrcpy-runtime.py')
        with patch.object(builder, '__file__', str(self.root / 'build-scrcpy-runtime.py')):
            result = builder.adopt_runtime(self.sdk33 / 'scrcpy', self.sdk33 / 'scrcpy-server',
                self.root / 'adopted33', runtime_kind='sdk33')
        self.assertEqual(result['version'], '3.3.4')
        self.assertEqual(result['server_sha256'], self.policy33['server_sha256'])

    def test_builder_rejects_cross_package_or_unknown_kind(self):
        builder = load(self, 'build-scrcpy-runtime.py')
        with patch.object(builder, '__file__', str(self.root / 'build-scrcpy-runtime.py')):
            for kind, client, server in [('sdk33', self.package/'scrcpy', self.package/'scrcpy-server'),
                    ('unknown', self.sdk33/'scrcpy', self.sdk33/'scrcpy-server')]:
                with self.subTest(kind=kind), self.assertRaises(ValueError):
                    builder.adopt_runtime(client, server, self.root / 'not-created', runtime_kind=kind)
        self.assertFalse((self.root / 'not-created').exists())


if __name__ == '__main__':
    unittest.main()
