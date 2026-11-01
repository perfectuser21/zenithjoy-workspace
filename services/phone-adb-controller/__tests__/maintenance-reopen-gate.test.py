"""新固定 SHA 候选必须由 Brain 当前 release 与本机原字节共同证明。"""

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SOURCE = Path(__file__).resolve().parents[1] / 'maintenance-reopen-gate.py'
SPEC = importlib.util.spec_from_file_location('maintenance_reopen_gate', SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class CandidateGateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name).resolve()
        self.sha = 'b' * 40
        self.release_id = '93e2511d-aa96-439a-9132-e64c38dc363b'
        self.observation_id = 'aa70a0da-99cf-494b-b693-36ef397d0b87'
        self.candidate = self.home / '.local/share/zenithjoy/phone-candidates' / self.sha
        (self.home / '.local/share/zenithjoy/phone-candidate-runs').mkdir(parents=True)
        runtime = self.candidate / 'runtime'
        runtime.mkdir(parents=True)
        self.code = b'#!/bin/zsh\necho candidate\n'
        (runtime / 'leadgen-run.sh').write_bytes(self.code)
        self.wrapper = ('#!/bin/bash\nset -euo pipefail\nunset WF_RELEASE_ID WF_DEPLOYMENT_MANIFEST\n'
                        'export WFR_HOME="$HOME/.local/share/zenithjoy/phone-candidate-runs/' + self.sha + '"\n'
                        'exec zsh "$(cd "$(dirname "$0")" && pwd)/runtime/leadgen-run.sh" "$@"\n')
        (self.candidate / 'run.sh').write_text(self.wrapper)
        self.repo = 'perfectuser21/zenithjoy-workspace'
        self.file = {'path': 'services/phone-adb-controller/leadgen-run.sh',
                     'deployed_path': 'leadgen-run.sh', 'content_sha256': hashlib.sha256(self.code).hexdigest()}
        self.components = [{'kind': 'code', 'repo': self.repo, 'path': self.file['path'],
                            'revision': self.sha, 'digest': 'sha256:' + self.file['content_sha256']},
                           {'kind': 'repo', 'repo': self.repo, 'revision': self.sha}]
        self.payload = {'components': self.components}
        self.release = {'id': self.release_id, 'environment': 'staging:' + self.sha,
                        'target': 'xian-m4', 'payload': self.payload}
        self.release['manifest_sha256'] = digest({key: self.release[key]
                                                   for key in ('environment', 'target', 'payload')})
        self.observed = {'source_repo': self.repo, 'source_commit': self.sha,
                         'files': [self.file], 'observed_hostname': 'xian-m4'}
        self.manifest = {**self.observed, 'release_id': self.release_id,
                         'observation_id': self.observation_id,
                         'environment': 'staging:' + self.sha, 'target': 'xian-m4'}
        (runtime / 'deployment-manifest.json').write_text(json.dumps(self.manifest))
        (self.candidate / 'candidate-identity.json').write_text(json.dumps({
            'source_commit': self.sha, 'release_id': self.release_id,
            'manifest_sha256': self.release['manifest_sha256']}))
        (self.candidate / 'candidate-identity.json').chmod(0o600)
        self.gate = {'release_id': self.release_id, 'manifest_sha256': self.release['manifest_sha256'],
                     'deployed': True, 'actual_matches': True, 'gaps': [],
                     'current_status': 'deployed', 'current_observation_id': self.observation_id,
                     'verification': {'status': 'verified', 'ci_status': 'verified',
                                      'definition_status': 'verified', 'step_coverage_status': 'verified'}}
        self.observation = {'id': self.observation_id, 'release_id': self.release_id,
                            'payload': {'environment': 'staging:' + self.sha, 'target': 'xian-m4',
                                        'components': self.components,
                                        'evidence_ref': 'deployment-sha256:' + digest(self.observed)}}

    def verify(self):
        return MODULE.verify_candidate_gate(self.home, self.sha, self.release,
                                            self.gate, self.observation)

    def test_exact_current_gate_and_live_bytes_admit(self):
        self.assertEqual(self.verify()['source_commit'], self.sha)

    def test_stale_gate_or_wrong_release_rejects(self):
        self.gate['current_observation_id'] = 'other'
        with self.assertRaisesRegex(ValueError, 'OBSERVATION'):
            self.verify()
        self.gate['current_observation_id'] = self.observation_id
        self.release['target'] = 'mmv'
        with self.assertRaisesRegex(ValueError, 'RELEASE'):
            self.verify()

    def test_file_or_manifest_drift_rejects(self):
        (self.candidate / 'runtime/leadgen-run.sh').write_text('tamper')
        with self.assertRaisesRegex(ValueError, 'BYTE'):
            self.verify()
        (self.candidate / 'runtime/leadgen-run.sh').write_bytes(self.code)
        self.manifest['source_commit'] = 'c' * 40
        (self.candidate / 'runtime/deployment-manifest.json').write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(ValueError, 'MANIFEST'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
