"""Execute the real controller selector, stopping at its verify boundary."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class RecorderRuntimeSelection(unittest.TestCase):
    def select(self, override=None):
        controller = Path(__file__).resolve().parents[2] / 'douyin-phone-adb'
        source = controller.read_text()
        body = 'record_sdk31_runtime() {' + source.split('record_sdk31_runtime() {', 1)[1].split('\n}\n', 1)[0] + '\n}\n'
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            verify = root / 'verify'
            verify.write_text('#!' + sys.executable + '\nimport sys,json,os\n'
                              'open(os.environ["VERIFY_ARGS"],"w").write(json.dumps(sys.argv[1:]))\n'
                              'sys.exit(64)\n')
            verify.chmod(0o700)
            env = {k: v for k, v in os.environ.items() if not k.startswith('DOUYIN_SDK')}
            env.update(HOME=str(root), VERIFY_ARGS=str(root / 'args'),
                       PYTHON_BIN=str(verify), EVIDENCE_ROOT=str(root),
                       PHONE_CONTROLLER_DIR=str(controller.parent), LOCK_OWNER='owned-fixture')
            if override is not None:
                env['DOUYIN_SDK33_RUNTIME_ROOT'] = override
            result = subprocess.run(['zsh', '-c',
                                     'die(){ print -u2 -- "$*"; exit 2; }\n' + body +
                                     '\nrecord_sdk31_runtime sample sdk33'],
                                    env=env, capture_output=True, text=True, timeout=3)
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn('RECORD_CAPTURE_STRATEGY_UNVERIFIED', result.stderr)
            args = json.loads((root / 'args').read_text())
            self.assertEqual(args[1:4], ['verify', '--runtime-kind', 'sdk33'])
            return args[args.index('--runtime-root') + 1], str(root)

    def test_sdk33_defaults_to_new_immutable_recorder_package(self):
        selected, home = self.select()
        self.assertEqual(selected, home + '/.local/share/zenithjoy/scrcpy-sdk33-v3.3.4-recorder-init-952ee084')

    def test_explicit_runtime_still_requires_verify_and_never_falls_back(self):
        selected, _ = self.select('/owned-explicit-invalid-package')
        self.assertEqual(selected, '/owned-explicit-invalid-package')
