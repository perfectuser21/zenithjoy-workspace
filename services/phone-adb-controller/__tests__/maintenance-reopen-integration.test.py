"""隔离文件系统演练：安全封存→新候选→原生终止→单机精确解锁。"""

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tx = load('deployment-transaction.py')
fence = load('deployment-candidate-fence.py')
locks = load('phone-lock-root.py')
roots = load('maintenance-reopen-roots.py')
host = load('maintenance-reopen-host.py')


def digest(value):
    return hashlib.sha256(tx.canonical(value)).hexdigest()


class ReopenIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.sha = 'b' * 40
        self.safety_sha = 'a' * 40
        self.safety_tx = 'phone-safety-' + self.safety_sha[:24]
        self.release_id = '93e2511d-aa96-439a-9132-e64c38dc363b'
        self.obs_id = 'aa70a0da-99cf-494b-b693-36ef397d0b87'
        self.parent = self.home / '.local/share/zenithjoy'
        old_candidates = self.parent / 'phone-candidates'
        old_candidates.mkdir(parents=True)
        (old_candidates / host.OLD_SOURCE).mkdir()
        (old_candidates / host.OLD_SOURCE / 'run.sh').write_text('frozen old candidate')
        receipts = (self.parent / 'phone-candidate-runs' / host.OLD_SOURCE / 'ledger' /
                    host.OLD_RUN.removesuffix('__a1') / 'native-operations')
        receipts.mkdir(parents=True)
        for n in range(6):
            operation = f'00000000-0000-4000-8000-{n:012d}'
            row = {'version': 1, 'operation_id': operation, 'run_id': host.OLD_RUN,
                   'owner': host.OLD_OWNER, 'source_commit': host.OLD_SOURCE,
                   'serial': host.OLD_SERIAL, 'task_id': host.OLD_TASK,
                   'created_at': '2026-11-01T02:19:33.776Z',
                   'ended_at': '2026-11-01T02:19:34.670Z',
                   'execution_stopped': False, 'process_coverage': 'observed_only',
                   'start_identity': '1793499573:783603',
                   'processes': [{'pid': n + 2000, 'start_identity': '1793499573:783603'}]}
            (receipts / (operation + '.json')).write_text(json.dumps(row))
        legacy = self.home / 'legacy-locks'
        legacy.mkdir()
        for serial, owner in [(host.OLD_SERIAL, host.OLD_OWNER),
                              ('YELLOW2', 'other-review'), ('THIRD3', 'third-review')]:
            (legacy / (serial + '.guard')).touch()
            lock = legacy / (serial + '.lock')
            lock.mkdir()
            for name, value in [('owner', owner), ('standalone_review_required', owner),
                                ('acquired_at', '1793499573'), ('pid', '2001')]:
                (lock / name).write_text(value + '\n')
        claims = legacy / 'standalone-claims' / host.OLD_SERIAL
        claims.mkdir(parents=True)
        (claims / host.OLD_OWNER).write_text('once\n')
        locks.migrate(legacy, self.parent / 'phone-locks')
        tx.atomic_bytes(tx.active_file(self.home), tx.canonical({'transaction': self.safety_tx}))
        manifest = self.home / 'bin-harvest/deployment-manifest.json'
        tx.atomic_bytes(manifest, b'{"production":"old"}')
        safety = {'schema_version': 1, 'transaction': self.safety_tx,
                  'source_commit': self.safety_sha, 'home': str(self.home),
                  'completed': ['close_review_cron', 'relocate_adb', 'disable_recovery',
                                'migrate_review', 'seal_candidates'],
                  'manifest_sha256': hashlib.sha256(manifest.read_bytes()).hexdigest(),
                  'review_serials': [host.OLD_SERIAL, 'YELLOW2', 'THIRD3'],
                  'cron_after': '# review closed\n'}
        journal = self.home / '.config/zenithjoy/maintenance-only' / self.safety_tx / 'journal.json'
        tx.atomic_bytes(journal, tx.canonical({**safety, 'sha256': tx.digest(tx.canonical(safety))}))
        fence.seal(self.home, self.safety_tx)
        self.observed = {'cron_raw': '# review closed\n', 'recovery_disabled': True,
                         'recovery_loaded': False, 'process_table': ''}
        roots.prepare_fresh_roots(self.home, self.safety_tx, self.sha, self.observed)
        self._stage_candidate()

    def _stage_candidate(self):
        candidate = self.parent / 'phone-candidates' / self.sha
        runtime = candidate / 'runtime'
        runtime.mkdir(parents=True)
        code = b'#!/bin/zsh\necho candidate\n'
        (runtime / 'leadgen-run.sh').write_bytes(code)
        source = 'services/phone-adb-controller/leadgen-run.sh'
        file = {'path': source, 'deployed_path': 'leadgen-run.sh',
                'content_sha256': hashlib.sha256(code).hexdigest()}
        components = [{'kind': 'code', 'repo': 'perfectuser21/zenithjoy-workspace',
                       'path': source, 'revision': self.sha,
                       'digest': 'sha256:' + file['content_sha256']},
                      {'kind': 'repo', 'repo': 'perfectuser21/zenithjoy-workspace',
                       'revision': self.sha}]
        payload = {'components': components}
        self.release = {'id': self.release_id, 'environment': 'staging:' + self.sha,
                        'target': 'xian-m4', 'payload': payload}
        self.release['manifest_sha256'] = digest({k: self.release[k]
                                                   for k in ('environment', 'target', 'payload')})
        observed = {'source_repo': 'perfectuser21/zenithjoy-workspace',
                    'source_commit': self.sha, 'files': [file], 'observed_hostname': 'xian-m4'}
        (runtime / 'deployment-manifest.json').write_text(json.dumps({**observed,
            'release_id': self.release_id, 'observation_id': self.obs_id,
            'environment': 'staging:' + self.sha, 'target': 'xian-m4'}))
        (candidate / 'candidate-identity.json').write_text(json.dumps({
            'source_commit': self.sha, 'release_id': self.release_id,
            'manifest_sha256': self.release['manifest_sha256']}))
        (candidate / 'candidate-identity.json').chmod(0o600)
        (candidate / 'run.sh').write_text(
            '#!/bin/bash\nset -euo pipefail\nunset WF_RELEASE_ID WF_DEPLOYMENT_MANIFEST\n'
            'export WFR_HOME="$HOME/.local/share/zenithjoy/phone-candidate-runs/' + self.sha + '"\n'
            'exec zsh "$(cd "$(dirname "$0")" && pwd)/runtime/leadgen-run.sh" "$@"\n')
        self.gate = {'release_id': self.release_id, 'manifest_sha256': self.release['manifest_sha256'],
                     'deployed': True, 'actual_matches': True, 'gaps': [],
                     'current_status': 'deployed', 'current_observation_id': self.obs_id,
                     'verification': {key: 'verified' for key in
                        ('status', 'ci_status', 'definition_status', 'step_coverage_status')}}
        self.observation = {'id': self.obs_id, 'release_id': self.release_id,
                            'payload': {'environment': 'staging:' + self.sha, 'target': 'xian-m4',
                                        'components': components,
                                        'evidence_ref': 'deployment-sha256:' + digest(observed)}}

    def brain(self, path):
        if path.endswith('/gate'):
            return self.gate
        if '/observations/' in path:
            return {'observation': self.observation}
        return {'release': self.release}

    def phone(self, kind):
        return ('packageName=com.hihonor.android.launcher\n' if kind == 'home' else
                'mCurrentFocus=Window{a u0 com.hihonor.android.launcher/.Launcher}\n')

    def finalize(self, boot=1793499700):
        return host.finalize_reopen(self.home, self.safety_tx, self.sha,
                                    self.release_id, self.observed,
                                    brain_request=self.brain, phone_read=self.phone,
                                    boot_seconds=boot)

    def test_full_rehearsal_preserves_old_bytes_other_reviews_and_manifest(self):
        before = (self.home / 'bin-harvest/deployment-manifest.json').read_bytes()
        result = self.finalize()
        self.assertTrue(result['released'])
        self.assertTrue((self.parent / ('phone-candidates.sealed.' + self.safety_tx) /
                         host.OLD_SOURCE / 'run.sh').is_file())
        self.assertFalse((self.parent / 'phone-candidates' / host.OLD_SOURCE).exists())
        self.assertEqual((self.home / 'bin-harvest/deployment-manifest.json').read_bytes(), before)
        self.assertEqual(locks.verify_review(self.home / 'legacy-locks',
                                             self.parent / 'phone-locks')['review_owners'], 2)
        self.assertTrue((self.home / 'legacy-locks/standalone-claims' /
                         host.OLD_SERIAL / host.OLD_OWNER).is_file())

    def test_pre_reboot_evidence_keeps_all_three_reviews(self):
        with self.assertRaisesRegex(ValueError, 'BOOT_NOT_AFTER_NATIVE'):
            self.finalize(boot=1793499500)
        self.assertEqual(locks.verify_review(self.home / 'legacy-locks',
                                             self.parent / 'phone-locks')['review_owners'], 3)


if __name__ == '__main__':
    unittest.main()
