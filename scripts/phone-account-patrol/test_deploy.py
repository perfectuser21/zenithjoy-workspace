import unittest
import deploy


class DeploymentProofTests(unittest.TestCase):
    def test_only_registered_identity_configuration_is_deployable(self):
        good = {key: '66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff' for key in ['single_workflow_id', 'batch_workflow_id', 'schedule_id', 'project_id']}
        deploy.validate_config(good)
        for bad in [{**good, 'api_key': 'fixture-key'}, {**good, 'schedule_id': 'not-an-id'}]:
            with self.assertRaises(ValueError):
                deploy.validate_config(bad)

    def test_deploy_success_requires_remote_source_and_every_file_hash(self):
        expected = {'source_revision': 'a' * 40, 'sha256': {'runner.py': 'b' * 64, 'collector.py': 'c' * 64}}
        proof = {'ok': True, **expected}
        deploy.verify_remote_proof(expected, proof)
        for bad in [{**proof, 'source_revision': 'd' * 40}, {**proof, 'sha256': {'runner.py': 'b' * 64}}, {**proof, 'ok': False}]:
            with self.assertRaises(ValueError):
                deploy.verify_remote_proof(expected, bad)


if __name__ == '__main__':
    unittest.main()
