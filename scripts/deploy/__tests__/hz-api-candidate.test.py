import gzip
import importlib.util
import json
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / 'hz-api-candidate.py'
SPEC = importlib.util.spec_from_file_location('hz_api_candidate', MODULE)
candidate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(candidate)

SHA = 'a' * 40
RUN_ID = '4242'
ATTEMPT = '2'


class CandidatePublication(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.raw = self.folder / 'staging-image.tar'
        self.raw.write_bytes(b'uncompressed test archive')
        (self.folder / 'staging-image.tar.gz').write_bytes(gzip.compress(self.raw.read_bytes()))
        (self.folder / 'staging-image.sha256').write_text(candidate.file_sha256(self.raw))
        (self.folder / 'staging-image-identity.json').write_text(
            json.dumps({'config': 'sha256:' + 'b' * 64, 'layers_hash': 'c' * 64})
        )
        (self.folder / 'staging-image-sizes.json').write_text(
            json.dumps({'archive': self.raw.stat().st_size, 'unpacked': 35})
        )
        self.release = self.folder / 'release'
        tracked = b'20261125_change.sql\nhelper.ts\n'
        with patch.object(candidate.subprocess, 'check_output', return_value=tracked.decode()) as git:
            candidate.publish(self.folder, self.release, SHA, RUN_ID, ATTEMPT)
        self.assertEqual(git.call_args.args[0][-1], f'{SHA}:apps/api/db/migrations')

    def test_accepts_exact_run_attempt_and_bundle(self):
        identity, migrations = candidate.read_bundle(self.release, SHA, RUN_ID, ATTEMPT)
        self.assertEqual(identity['config'], 'sha256:' + 'b' * 64)
        self.assertEqual(migrations, '20261125_change.sql\n')

    def test_refuses_different_sha_run_or_attempt(self):
        for args in [('d' * 40, RUN_ID, ATTEMPT), (SHA, '111', ATTEMPT), (SHA, RUN_ID, '1')]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                candidate.read_bundle(self.release, *args)

    def test_refuses_modified_image_or_migration_list(self):
        for file in ['image.tar.gz', 'migration-filenames.txt']:
            item = self.release / file
            original = item.read_bytes()
            item.write_bytes(original + b'altered')
            with self.subTest(file=file), self.assertRaises(ValueError):
                candidate.read_bundle(self.release, SHA, RUN_ID, ATTEMPT)
            item.write_bytes(original)

    def test_refuses_image_outside_artifact(self):
        archive = self.release / 'image.tar.gz'
        archive.unlink()
        archive.symlink_to(self.folder / 'staging-image.tar.gz')
        with self.assertRaises(ValueError):
            candidate.read_bundle(self.release, SHA, RUN_ID, ATTEMPT)


class TransportContract(unittest.TestCase):
    def test_nested_ssh_forwards_secret_stdin_to_fixed_host(self):
        archive_command = "bash -c 'cat > /unused'"
        outer = ['ssh', '-T', 'example@test', archive_command]
        original = 'url = "https://example.test/private"\n'
        with patch.object(candidate.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
            candidate.run_via_hangzhou(outer, input=original, text=True, check=True)
        args = run.call_args.args[0]
        self.assertEqual(args[:-1], outer[:-1])
        command = shlex.split(args[-1])
        self.assertEqual(command[-2:], ['aliyun-cn', archive_command])
        self.assertIn('StrictHostKeyChecking=yes', command)
        self.assertNotIn('private', args[-1])
        self.assertEqual(run.call_args.kwargs['input'], original)


if __name__ == '__main__':
    unittest.main()
