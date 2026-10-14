"""Failure evidence must survive the remote and recovery boundaries."""
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
import contextlib
import io
import hashlib
import sys
from unittest.mock import patch

ROOT = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('failure_runner', ROOT / 'runner.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class FailureEvidenceTests(unittest.TestCase):
    def test_preflight_adb_error_retains_device_error_and_checks_runner_hash(self):
        spec = importlib.util.spec_from_file_location('failure_preflight', ROOT / 'preflight.py')
        preflight = importlib.util.module_from_spec(spec); spec.loader.exec_module(preflight)
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            files = ['runner.py', 'collector.py', 'dispatch.py', 'preflight.py', 'publish.mjs', 'ocr.swift', 'SKILL.md', 'mirror.mjs']
            for name in files: (root / name).write_bytes((ROOT / name).read_bytes())
            manifest = {'sha256': {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in files}}
            (root / 'deployment.json').write_text(json.dumps(manifest))
            output = io.StringIO()
            with patch.object(preflight, '__file__', str(root / 'preflight.py')), patch.object(sys, 'argv', ['preflight', '--serial', 'phone-a']), \
                    patch.object(preflight.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'error: device phone-a not found')), contextlib.redirect_stdout(output):
                self.assertEqual(preflight.main(), 1)
            receipt = json.loads(output.getvalue())
            self.assertEqual(receipt['failure']['code'], 'adb_unreachable')
            self.assertIn('device phone-a not found', receipt['failure']['stderr'])
            (root / 'runner.py').write_text('changed dependency')
            output = io.StringIO()
            with patch.object(preflight, '__file__', str(root / 'preflight.py')), patch.object(sys, 'argv', ['preflight', '--serial', 'phone-a']), \
                    patch.object(preflight.subprocess, 'run') as adb, contextlib.redirect_stdout(output):
                self.assertEqual(preflight.main(), 1)
                adb.assert_not_called()
            self.assertEqual(json.loads(output.getvalue())['failure']['code'], 'source_version_mismatch')

    def test_quoted_secrets_basic_auth_and_url_userinfo_are_redacted(self):
        for text, secrets in [('{"password":"alpha beta gamma"}', ['alpha', 'beta', 'gamma']),
                              ('Authorization: Basic ZmFrZTpwYXNz', ['ZmFrZTpwYXNz']),
                              ('https://alice:fake-pass@example.test/path', ['alice', 'fake-pass']),
                              ('API_KEY="secret with spaces"', ['secret with spaces'])]:
            cleaned = runner.safe_error_text(text)
            for secret in secrets:
                self.assertNotIn(secret, cleaned)

    def test_remote_error_preserves_evidence_without_guessing_adb(self):
        output = subprocess.CompletedProcess([], 255, '', 'Permission denied (publickey).')
        with patch.object(runner.subprocess, 'run', return_value=output):
            with self.assertRaises(runner.PatrolFailure) as caught:
                runner.ssh('xian-m4', 'preflight', stage='preflight')
        failure = caught.exception.failure
        self.assertEqual(failure['code'], 'remote_execution_failed')
        self.assertEqual(failure['stage'], 'preflight')
        self.assertEqual(failure['exit_code'], 255)
        self.assertIn('Permission denied', failure['stderr'])

    def test_timeout_keeps_stage_and_partial_output(self):
        with patch.object(runner.subprocess, 'run', side_effect=subprocess.TimeoutExpired([], 60, output=b'partial', stderr=b'waiting')):
            with self.assertRaises(runner.PatrolFailure) as caught:
                runner.ssh('xian-m4', 'dispatch', stage='collect')
        self.assertEqual(caught.exception.failure['code'], 'remote_timeout')
        self.assertEqual(caught.exception.failure['stdout'], 'partial')
        self.assertEqual(caught.exception.failure['stage'], 'collect')

    def test_failed_preflight_json_is_saved_before_raising(self):
        check = {'ok': False, 'serial': 'phone-a', 'checks': {'adb_online': False},
                 'failure': {'stage': 'preflight', 'code': 'adb_unreachable', 'message': 'ADB无法连接设备',
                             'stderr': "error: device 'phone-a' not found", 'exit_code': 1}}
        output = subprocess.CompletedProcess([], 1, json.dumps(check), 'preflight failed')
        with tempfile.TemporaryDirectory() as directory, patch.object(runner, 'STATE', pathlib.Path(directory)), \
                patch.object(runner, 'api', return_value={'phones': [{'serial': 'phone-a', 'enabled': True, 'host': 'xian-m4'}]}), \
                patch.object(runner.subprocess, 'run', return_value=output):
            with self.assertRaises(runner.PatrolFailure) as caught:
                runner.phone_run('phone-a', 'task-a', {'remote_release': '/fixed'})
            self.assertEqual(caught.exception.failure['code'], 'adb_unreachable')
            self.assertEqual(json.loads((pathlib.Path(directory) / 'task-a.preflight.json').read_text()), check)

    def test_ssh_255_cannot_be_reclassified_from_partial_preflight_stdout(self):
        check = {'ok': False, 'serial': 'phone-a', 'checks': {'adb_online': False}}
        output = subprocess.CompletedProcess([], 255, json.dumps(check), 'connection reset')
        with patch.object(runner, 'api', return_value={'phones': [{'serial': 'phone-a', 'enabled': True, 'host': 'xian-m4'}]}), \
                patch.object(runner.subprocess, 'run', return_value=output):
            with self.assertRaises(runner.PatrolFailure) as caught:
                runner.phone_run('phone-a', 'task-a', {'remote_release': '/fixed'})
        self.assertEqual(caught.exception.failure['code'], 'remote_execution_failed')
        self.assertIn('connection reset', caught.exception.failure['stderr'])

    def test_failure_receipt_has_attempt_identity_and_redacted_bounded_logs(self):
        task = '11111111-1111-4111-8111-111111111111'
        error = runner.PatrolFailure('collect', 'remote_execution_failed', '远端失败', stderr='Authorization: Bearer SECRET\npassword=PASS\n' + 'x' * 12000)
        receipt = runner.failure_receipt(error, task, 'phone-a', {'single_workflow_id': 'wf', 'source_revision': 'rev'}, '/tmp/script-' + task + '-a2.sh')
        self.assertEqual(receipt['run_id'], 'script-' + task + '-a2')
        self.assertEqual(receipt['serial'], 'phone-a')
        self.assertNotIn('SECRET', json.dumps(receipt))
        self.assertNotIn('PASS', json.dumps(receipt))
        self.assertLessEqual(len(receipt['failure']['stderr']), 2000)


if __name__ == '__main__':
    unittest.main()
