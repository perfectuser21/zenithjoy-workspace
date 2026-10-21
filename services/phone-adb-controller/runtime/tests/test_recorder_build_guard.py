"""SDK33 rebuild must bind the patched recorder, not only the logger."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from test_runtime import load


class RecorderBuildGuard(unittest.TestCase):
    def exercise(self, mode):
        builder = load(self, 'build-scrcpy-runtime.py')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, build = root / 'source', root / 'build'
            (source / 'app/src/util').mkdir(parents=True)
            (source / 'app/src/util/log.c').write_bytes(b'logger')
            (source / 'app/src/recorder.c').write_bytes(b'tampered' if mode == 'tampered' else b'recorder')
            patch_file = root / 'scrcpy-v3.3.4-log-flush.patch'
            patch_file.write_bytes(b'patch')
            server = root / 'server'
            server.write_bytes(b'server')
            sha = lambda value: hashlib.sha256(value).hexdigest()
            policy = dict(schema='scrcpy-sdk33-pinned-v1', version='3.3.4',
                          source_commit='a' * 40, source_archive_sha256=sha(b'archive'),
                          patch_sha256=sha(b'patch'), server_sha256=sha(b'server'),
                          patched_log_sha256=sha(b'logger'),
                          patched_recorder_sha256=sha(b'recorder'), client_sha256=sha(b'client'))
            if mode == 'missing-pin':
                del policy['patched_recorder_sha256']
            (root / 'runtime-policy-sdk33.json').write_text(json.dumps(policy))
            calls = []

            def run(args, **kwargs):
                calls.append(args)
                if args[:2] == ['meson', 'setup']:
                    (build / 'app').mkdir(parents=True)
                    (build / 'app/scrcpy').write_bytes(b'client')

            with patch.object(builder, '__file__', str(root / 'build-scrcpy-runtime.py')), \
                 patch.object(builder.subprocess, 'check_output', side_effect=['a' * 40, '', b'archive']), \
                 patch.object(builder.subprocess, 'run', side_effect=run):
                if mode != 'valid':
                    with self.assertRaisesRegex(ValueError, 'patched recorder digest mismatch'):
                        builder.rebuild_candidate(source, build, server, 'meson', 'ninja', 'pkgconf', 'sdk33')
                    self.assertFalse(any(c[:2] == ['meson', 'setup'] for c in calls))
                else:
                    result = builder.rebuild_candidate(source, build, server, 'meson', 'ninja', 'pkgconf', 'sdk33')
                    self.assertTrue(result['candidate_only'])
                    self.assertTrue(any(any(str(a).endswith('test_recorder_media.py') for a in c) for c in calls),
                                    'full-source real-mutex/media regression must run before candidate receipt')

    def test_tampered_patched_recorder_rejected_before_build(self):
        self.exercise('tampered')

    def test_missing_patched_recorder_pin_rejected_before_build(self):
        self.exercise('missing-pin')

    def test_valid_build_requires_actual_recorder_media_regression(self):
        self.exercise('valid')
