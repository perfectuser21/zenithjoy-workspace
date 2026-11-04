"""正式observeDeployment落盘ABI没有observed_hostname；必须现场重新采集。"""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('discovery_candidate_host', HERE / 'collection-review-maintenance-host.py')
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class CandidateAbiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name).resolve()
        self.sha = 'b' * 40
        self.release_id = '11111111-1111-4111-8111-111111111111'
        self.observation_id = '22222222-2222-4222-8222-222222222222'
        self.base = self.home / '.local/share/zenithjoy/phone-candidates' / self.sha
        self.runtime = self.base / 'runtime'; self.runtime.mkdir(parents=True)
        self.files = []
        for name in ('leadgen-run.sh', 'adb-managed-client.py', 'adb-existing-route.py'):
            data = (name + '\n').encode(); (self.runtime / name).write_bytes(data)
            self.files.append({'path': 'services/phone-adb-controller/' + name,
                'deployed_path': name, 'content_sha256': host.m.sha(data)})
        components = [{'kind': 'repo', 'repo': host.gate.REPO, 'revision': self.sha},
                      {'kind': 'code', 'repo': host.gate.REPO, 'revision': self.sha,
                       'path': self.files[0]['path'], 'digest': 'sha256:' + self.files[0]['content_sha256']}]
        self.release = {'id': self.release_id, 'target': 'xian-m4', 'environment': 'staging:' + self.sha,
                        'payload': {'components': components}}
        self.release['manifest_sha256'] = host.gate.digest({k: self.release[k] for k in ('environment', 'target', 'payload')})
        self.gate = {'release_id': self.release_id, 'manifest_sha256': self.release['manifest_sha256'],
            'deployed': True, 'actual_matches': True, 'current_status': 'deployed', 'gaps': [],
            'verification': {k: 'verified' for k in ('status', 'ci_status', 'definition_status', 'step_coverage_status')},
            'current_observation_id': self.observation_id}
        self.measured = {'source_repo': host.gate.REPO, 'source_commit': self.sha,
                         'files': self.files, 'observed_hostname': 'm4-xian-real.local'}
        self.observation = {'id': self.observation_id, 'release_id': self.release_id,
            'payload': {'target': 'xian-m4', 'environment': 'staging:' + self.sha,
                        'components': components, 'evidence_ref': 'deployment-sha256:' + host.gate.digest(self.measured)}}
        # Exact eight-key shape returned by observeDeployment, without a host declaration.
        self.manifest = {'schema_version': 1, 'source_repo': host.gate.REPO, 'source_commit': self.sha,
            'files': self.files, 'release_id': self.release_id, 'observation_id': self.observation_id,
            'environment': 'staging:' + self.sha, 'target': 'xian-m4'}
        self.save_manifest()
        (self.base / 'candidate-identity.json').write_text(json.dumps({'source_commit': self.sha,
            'release_id': self.release_id, 'manifest_sha256': self.release['manifest_sha256']}))

    def save_manifest(self):
        (self.runtime / 'deployment-manifest.json').write_text(json.dumps(self.manifest))

    def brain(self, home, path):
        if path.endswith('/gate'): return copy.deepcopy(self.gate)
        if '/observations/' in path: return {'observation': copy.deepcopy(self.observation)}
        return {'release': copy.deepcopy(self.release)}

    def candidate(self, hostname='m4-xian-real.local'):
        with patch.object(host, 'brain', side_effect=self.brain), patch('socket.gethostname', return_value=hostname):
            return host.candidate(self.home, self.sha, self.release_id)

    def test_actual_installed_shape_passes_with_measured_hostname(self):
        self.assertNotIn('observed_hostname', self.manifest)
        self.assertEqual(self.candidate()['observation_id'], self.observation_id)

    def test_actual_file_change_rejected(self):
        (self.runtime / 'leadgen-run.sh').write_text('changed\n')
        with self.assertRaisesRegex(ValueError, 'CANDIDATE_BYTES'): self.candidate()

    def test_manifest_hostname_cannot_replace_live_measurement(self):
        self.manifest['observed_hostname'] = 'm4-xian-real.local'; self.save_manifest()
        with self.assertRaisesRegex(ValueError, 'OBSERVATION_DIGEST'): self.candidate('m4-xian-other.local')
        with self.assertRaisesRegex(ValueError, 'MEASURED_HOST'): self.candidate('foreign-host')

    def test_file_array_order_and_observation_digest_are_bound(self):
        self.manifest['files'] = list(reversed(self.files)); self.save_manifest()
        with self.assertRaisesRegex(ValueError, 'OBSERVATION_DIGEST'): self.candidate()
        self.manifest['files'] = self.files; self.save_manifest()
        self.observation['payload']['evidence_ref'] = 'deployment-sha256:' + 'a' * 64
        with self.assertRaisesRegex(ValueError, 'OBSERVATION_DIGEST'): self.candidate()

    def test_gate_release_observation_and_components_remain_strict(self):
        self.gate['actual_matches'] = False
        with self.assertRaisesRegex(ValueError, 'GATE'): self.candidate()
        self.gate['actual_matches'] = True
        self.observation['release_id'] = 'foreign'
        with self.assertRaisesRegex(ValueError, 'OBSERVATION'): self.candidate()


if __name__ == '__main__': unittest.main()
