"""私有同ABI依赖、末端环境装载与启动自检；不连接手机或ADB。"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from test_runtime import load


class PrivateRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.module = load(self, 'scrcpy-private-runtime.py')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        (self.base / 'scrcpy-private-runtime.py').write_text(Path(self.module.__file__).read_text())
        self.root = self.base / 'package'
        (self.root / 'lib').mkdir(parents=True)
        for name, data in [('scrcpy', b'fixed client'), ('scrcpy-server', b'fixed server'),
                           ('lib/libavformat.62.dylib', b'fixed ABI62 library')]:
            (self.root / name).write_bytes(data)
        (self.root / 'scrcpy').chmod(0o755)
        self.lock = {'schema': 'scrcpy-private-dylibs-v1', 'platform': 'darwin',
                     'architecture': 'arm64', 'client_sha256': self.sha('scrcpy'),
                     'client_dependencies': ['libavformat.62.dylib'],
                     'libraries': [{'name': 'libavformat.62.dylib', 'sha256': self.sha('lib/libavformat.62.dylib'),
                                    'bytes': len(b'fixed ABI62 library'), 'dependencies': []}]}
        self.policy = {'schema': 'scrcpy-sdk33-pinned-v1', 'version': '3.3.4',
                       'client_sha256': self.sha('scrcpy'), 'server_sha256': self.sha('scrcpy-server')}
        (self.base / 'runtime-policy-sdk33.json').write_text(json.dumps(self.policy))
        self.save_lock()
        location = patch.object(self.module, '__file__', str(self.base / 'scrcpy-private-runtime.py'))
        location.start()
        self.addCleanup(location.stop)

    def sha(self, name):
        return hashlib.sha256((self.root / name).read_bytes()).hexdigest()

    def save_lock(self):
        raw = json.dumps(self.lock).encode()
        (self.base / 'runtime-private-deps-sdk33.darwin-arm64.json').write_bytes(raw)
        (self.root / 'private-dependencies.json').write_bytes(raw)

    def test_frozen_closure_and_late_environment_replace_inherited_dyld(self):
        before = (self.sha('scrcpy'), self.sha('scrcpy-server'))
        verified = self.module.verify_dependencies(self.root)
        self.assertEqual(verified['library_count'], 1)
        env = self.module.runtime_environment(self.root, 'sdk33', {
            'HOME': 'fixture', 'DYLD_LIBRARY_PATH': '/wrong', 'DYLD_INSERT_LIBRARIES': '/wrong',
            'DYLD_FRAMEWORK_PATH': '/wrong'})
        self.assertEqual(env['DYLD_LIBRARY_PATH'], str(self.root / 'lib'))
        self.assertEqual(env['DYLD_FALLBACK_LIBRARY_PATH'], '')
        self.assertNotIn('DYLD_INSERT_LIBRARIES', env)
        self.assertNotIn('DYLD_FRAMEWORK_PATH', env)
        self.assertEqual(before, (self.sha('scrcpy'), self.sha('scrcpy-server')))

    def test_missing_or_wrong_abi_library_never_falls_back_to_host(self):
        for data in [None, b'incompatible ABI63 library']:
            with self.subTest(data=data):
                p = self.root / 'lib/libavformat.62.dylib'
                if p.exists(): p.unlink()
                if data is not None: p.write_bytes(data)
                with self.assertRaises(ValueError):
                    self.module.runtime_environment(self.root, 'sdk33', {'DYLD_LIBRARY_PATH': '/system'})

    def test_symlink_extra_library_and_tampered_lock_are_rejected(self):
        lib = self.root / 'lib/libavformat.62.dylib'
        source = self.base / 'outside'
        source.write_bytes(lib.read_bytes())
        lib.unlink(); lib.symlink_to(source)
        with self.assertRaises(ValueError): self.module.verify_dependencies(self.root)
        lib.unlink(); lib.write_bytes(source.read_bytes())
        (self.root / 'lib/extra.dylib').write_bytes(b'unknown')
        with self.assertRaises(ValueError): self.module.verify_dependencies(self.root)
        (self.root / 'lib/extra.dylib').unlink()
        (self.root / 'private-dependencies.json').write_text('{}')
        with self.assertRaises(ValueError): self.module.verify_dependencies(self.root)

    def test_unclosed_dependency_and_client_changes_are_rejected(self):
        self.lock['libraries'][0]['dependencies'] = ['missing.dylib']; self.save_lock()
        with self.assertRaises(ValueError): self.module.verify_dependencies(self.root)
        self.lock['libraries'][0]['dependencies'] = []; self.save_lock()
        (self.root / 'scrcpy').write_bytes(b'different client')
        with self.assertRaises(ValueError): self.module.verify_dependencies(self.root)

    def test_startup_probe_is_only_fixed_binary_version_with_verified_environment(self):
        with patch.object(self.module.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'scrcpy 3.3.4\n', '')) as run:
            result = self.module.startup_check(self.root)
        self.assertTrue(result['startup_verified'])
        args, kwargs = run.call_args
        self.assertEqual(args[0], [str(self.root / 'scrcpy'), '--version'])
        self.assertEqual(kwargs['env']['DYLD_LIBRARY_PATH'], str(self.root / 'lib'))
        self.assertLessEqual(kwargs['timeout'], 5)
        for code, stdout in [(1, ''), (0, 'scrcpy 5.0.1\n')]:
            with self.subTest(code=code, stdout=stdout), patch.object(self.module.subprocess, 'run', return_value=subprocess.CompletedProcess([], code, stdout, 'dyld: missing library')):
                with self.assertRaises(ValueError): self.module.startup_check(self.root)

    def test_builder_copies_only_frozen_dependencies_and_self_checks_before_publication(self):
        builder = load(self, 'build-scrcpy-runtime.py')
        target = self.base / 'adopted'
        with patch.object(builder, '__file__', str(self.base / 'build-scrcpy-runtime.py')), patch.object(self.module.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'scrcpy 3.3.4\n', '')):
            result = builder.adopt_runtime(self.root / 'scrcpy', self.root / 'scrcpy-server', target, runtime_kind='sdk33', dependencies_dir=self.root / 'lib')
        self.assertTrue(result['startup_verified'])
        self.assertEqual((target / 'lib/libavformat.62.dylib').read_bytes(), (self.root / 'lib/libavformat.62.dylib').read_bytes())
        failed = self.base / 'failed-startup'
        with patch.object(builder, '__file__', str(self.base / 'build-scrcpy-runtime.py')), patch.object(self.module.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'dyld missing library')):
            with self.assertRaises(ValueError):
                builder.adopt_runtime(self.root / 'scrcpy', self.root / 'scrcpy-server', failed, runtime_kind='sdk33', dependencies_dir=self.root / 'lib')
        self.assertFalse(failed.exists())

class ExistingVerifierDependencyRegression(unittest.TestCase):
    def test_pinned_client_with_broken_declared_private_dependency_is_not_verified(self):
        runtime = load(self, 'scrcpy-runtime.py')
        from test_runtime import HERE
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); root = base / 'package'; (root / 'lib').mkdir(parents=True)
            client, server = b'pinned client', b'pinned server'
            (root / 'scrcpy').write_bytes(client); (root / 'scrcpy').chmod(0o755)
            (root / 'scrcpy-server').write_bytes(server)
            policy = {'schema': 'scrcpy-sdk33-pinned-v1', 'version': '3.3.4',
                      'client_sha256': hashlib.sha256(client).hexdigest(), 'server_sha256': hashlib.sha256(server).hexdigest()}
            (base / 'runtime-policy-sdk33.json').write_text(json.dumps(policy))
            lock = {'schema': 'scrcpy-private-dylibs-v1', 'platform': 'darwin', 'architecture': 'arm64',
                    'client_sha256': policy['client_sha256'], 'client_dependencies': ['libavformat.62.dylib'],
                    'libraries': [{'name': 'libavformat.62.dylib', 'sha256': hashlib.sha256(b'correct ABI62').hexdigest(), 'bytes': len(b'correct ABI62'), 'dependencies': []}]}
            raw = json.dumps(lock)
            (base / 'runtime-private-deps-sdk33.darwin-arm64.json').write_text(raw)
            (root / 'private-dependencies.json').write_text(raw)
            (root / 'lib/libavformat.62.dylib').write_bytes(b'incompatible ABI63')
            helper = HERE / 'scrcpy-private-runtime.py'
            if helper.is_file(): (base / helper.name).write_bytes(helper.read_bytes())
            with patch.object(runtime, '__file__', str(base / 'scrcpy-runtime.py')):
                with self.assertRaises(runtime.RuntimeFailure):
                    runtime.verify_runtime(root, runtime_kind='sdk33')
