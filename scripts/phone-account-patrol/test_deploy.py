import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
import deploy


class DeploymentProofTests(unittest.TestCase):
    def test_release_file_uses_fixed_deployment_reader_for_private_skill(self):
        repo = Path(__file__).resolve().parents[2]
        revision = 'a' * 40
        with patch.object(deploy.subprocess, 'check_output', return_value=b'fixed private skill') as read:
            self.assertEqual(deploy.read_release_file(repo, revision, 'SKILL.md'), b'fixed private skill')
        args = read.call_args.args[0]
        self.assertEqual(args[-2:], [revision, 'scripts/phone-account-patrol/SKILL.md'])
        self.assertIn('readArchivedDeploymentSource', args[3])
        self.assertEqual(read.call_args.kwargs['cwd'], repo)

    def test_only_registered_identity_configuration_is_deployable(self):
        good = {key: '66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff' for key in ['single_workflow_id', 'batch_workflow_id', 'schedule_id', 'project_id']}
        deploy.validate_config(good)
        for bad in [{**good, 'api_key': 'fixture-key'}, {**good, 'schedule_id': 'not-an-id'}]:
            with self.assertRaises(ValueError):
                deploy.validate_config(bad)

    def test_deploy_success_requires_remote_source_and_every_file_hash(self):
        expected = {'source_revision': 'a' * 40, 'sha256': {'runner.py': 'b' * 64, 'collector.py': 'c' * 64},
                    'schedule_id': '66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff'}
        proof = {'ok': True, **expected}
        deploy.verify_remote_proof(expected, proof)
        for bad in [{**proof, 'source_revision': 'd' * 40}, {**proof, 'sha256': {'runner.py': 'b' * 64}},
                    {**proof, 'ok': False}, {**proof, 'schedule_id': None}]:
            with self.assertRaises(ValueError):
                deploy.verify_remote_proof(expected, bad)

    def test_existing_candidate_can_be_reused_but_conflicting_bytes_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            candidate = Path(temporary) / 'releases' / ('a' * 40)
            content = {'collector.py': b'frozen candidate', 'deployment.json': b'{"fake": "fixed"}'}
            deploy.install_local_release(candidate, content)
            before = candidate.stat().st_ino
            deploy.install_local_release(candidate, {**content, 'deployment.json': b'{"fake":"fixed"}'})
            self.assertEqual(candidate.stat().st_ino, before)
            with self.assertRaisesRegex(ValueError, '不覆盖'):
                deploy.install_local_release(candidate, {**content, 'collector.py': b'replacement'})
            self.assertEqual((candidate / 'collector.py').read_bytes(), content['collector.py'])


if __name__ == '__main__':
    unittest.main()
