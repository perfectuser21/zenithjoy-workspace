"""Execute candidate-mode guard and verify recoverable artifacts without a remote write."""
import hashlib
import json
import os
import pathlib
import subprocess
import tarfile
import tempfile
import unittest
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[4]
PATH = ROOT / '.github/workflows/agent-installpack.yml'
DOC = yaml.safe_load(PATH.read_text())
SHA = '1' * 40

class BuildOnlyTest(unittest.TestCase):
    def test_guard_rejects_publish_before_all_builds_and_without_network_setup(self):
        guard = DOC['jobs']['candidate-mode']
        self.assertEqual(len(guard['steps']), 1)
        step = guard['steps'][0]
        self.assertEqual(step['shell'], 'bash')
        self.assertNotIn('uses', step)
        for event, requested, success in [('push', '', True), ('workflow_dispatch', 'false', True), ('workflow_dispatch', 'true', False)]:
            with self.subTest(event=event, requested=requested):
                result = subprocess.run(['bash', '-euo', 'pipefail', '-c', step['run']], env={**os.environ, 'EVENT_NAME': event, 'REQUESTED_PUBLISH': requested}, capture_output=True, text=True)
                self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
                if success: self.assertIn('candidate only', result.stdout)
                else: self.assertIn('publish=true is disabled', result.stderr)
        for name in ['build', 'build-line-modules']:
            self.assertEqual(DOC['jobs'][name]['needs'], ['candidate-mode'])
        self.assertEqual(set(DOC['jobs']), {'candidate-mode', 'build', 'build-line-modules'})

    def test_main_and_false_dispatch_retain_every_candidate_package_and_manifest(self):
        triggers = DOC.get('on', DOC.get(True))
        self.assertEqual(triggers['push']['branches'], ['main'])
        self.assertIs(triggers['workflow_dispatch']['inputs']['publish']['default'], False)
        self.assertEqual(DOC['jobs']['build-line-modules']['strategy']['matrix']['lineId'], ['line04', 'line01', 'line02', 'line05'])
        for job_id, component, directory in [('build', 'core', 'dist-installpack'), ('build-line-modules', '${{ matrix.lineId }}', 'dist-modules')]:
            steps = DOC['jobs'][job_id]['steps']
            upload = [s for s in steps if s.get('uses') == 'actions/upload-artifact@v4']
            self.assertEqual(len(upload), 1)
            upload = upload[0]
            self.assertNotIn('if', upload)
            self.assertEqual(upload['with']['name'], 'zenithjoy-agent-candidate-' + component + '-${{ github.sha }}')
            self.assertEqual(upload['with']['if-no-files-found'], 'error')
            self.assertEqual(upload['with']['retention-days'], 14)
            paths = upload['with']['path'].splitlines()
            self.assertEqual(set(paths), {f'services/agent/{directory}/{name}' for name in ['*.tar.gz', 'manifest.json', 'candidate-receipt.json', 'SHA256SUMS']})
            receipt = next(s for s in steps if s.get('name') == 'Record candidate hashes')
            self.assertEqual(receipt['env']['CANDIDATE_SOURCE_SHA'], '${{ github.sha }}')
            self.assertEqual(receipt['run'], 'node scripts/write-installpack-candidate.cjs ' + component)
            self.assertLess(steps.index(receipt), steps.index(upload))
        names = [s.get('name') for s in DOC['jobs']['build']['steps']]
        for name in ['Install agent-panel web deps', 'Build install pack', 'Verify exe overlay intact and runnable', 'Verify exe app icon is ZenithJoy logo (not default node icon)', 'Dryrun verify (embedded-python import check)']:
            self.assertIn(name, names)
        self.assertLess(names.index('Dryrun verify (embedded-python import check)'), names.index('Record candidate hashes'))

    def test_no_production_writers_or_write_credentials_remain(self):
        workflow = PATH.read_text()
        for forbidden in ['coscmd', 'cos-upload', 'COS_SECRET', 'VPS_API_URL', 'VPS_INTERNAL_TOKEN', 'cos_url', 'api/agent/install-pack/manifest', 'Mirror WeChat', 'curl ', 'pip install']:
            self.assertNotIn(forbidden, workflow)
        self.assertEqual(DOC['permissions'], {'contents': 'read'})
        for script_name in ['build-install-pack.sh', 'build-line-module.sh', 'write-installpack-candidate.cjs']:
            script = (ROOT / 'services/agent/scripts' / script_name).read_text()
            for forbidden in ['api.notion.com', 'op item get', '.credentials/', 'gh secret set', 'coscmd', 'COS_SECRET', 'VPS_INTERNAL_TOKEN']:
                self.assertNotIn(forbidden, script)

    def test_receipts_recover_core_and_all_four_modules_and_fail_closed(self):
        script = ROOT / 'services/agent/scripts/write-installpack-candidate.cjs'
        for component in ['core', 'line04', 'line01', 'line02', 'line05']:
            with self.subTest(component=component), tempfile.TemporaryDirectory(prefix='zj-candidate-contract-') as scratch:
                root = pathlib.Path(scratch)
                directory = root / ('dist-installpack' if component == 'core' else 'dist-modules')
                directory.mkdir()
                if component == 'core':
                    manifest = {'version': '2.0.96', 'download_url': '/download/zenithjoy-agent-v2.0.96.tar.gz'}
                    archive_name = 'zenithjoy-agent-v2.0.96.tar.gz'
                else:
                    manifest = json.loads((ROOT / f'services/agent/modules/{component}/manifest.json').read_text())
                    source_dir = root / 'modules' / component
                    source_dir.mkdir(parents=True)
                    (source_dir / 'manifest.json').write_text(json.dumps(manifest))
                    archive_name = f"{manifest['lineId']}-v{manifest['version']}.tar.gz"
                payload = root / 'payload'; payload.mkdir()
                (payload / 'manifest.json').write_text(json.dumps(manifest))
                archive = directory / archive_name
                with tarfile.open(archive, 'w:gz') as output: output.add(payload / 'manifest.json', arcname='manifest.json')
                if component == 'core':
                    manifest.update(sha256=hashlib.sha256(archive.read_bytes()).hexdigest(), size=archive.stat().st_size)
                    (directory / 'manifest.json').write_text(json.dumps(manifest))
                env = {**os.environ, 'CANDIDATE_SOURCE_SHA': SHA}
                def run(): return subprocess.run(['node', str(script), component], cwd=root, env=env, capture_output=True, text=True)
                result = run(); self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                receipt = json.loads((directory / 'candidate-receipt.json').read_text())
                self.assertEqual(receipt['source_sha'], SHA)
                self.assertIs(receipt['candidate_only'], True)
                self.assertEqual(receipt['component'], component)
                for entry in receipt['files']:
                    self.assertEqual(entry['sha256'], hashlib.sha256((directory / entry['name']).read_bytes()).hexdigest())
                    self.assertEqual(entry['size'], (directory / entry['name']).stat().st_size)
                for line in (directory / 'SHA256SUMS').read_text().splitlines():
                    digest, filename = line.split('  ')
                    self.assertEqual(digest, hashlib.sha256((directory / filename).read_bytes()).hexdigest())
                with tarfile.open(archive) as recovered:
                    embedded = json.load(recovered.extractfile('manifest.json'))
                self.assertEqual(embedded['version'], manifest['version'])
                if component != 'core': self.assertEqual(json.loads((directory / 'manifest.json').read_text()), embedded)
                archive.unlink()
                self.assertNotEqual(run().returncode, 0, 'missing archive must fail')
                archive.write_bytes(b'changed')
                if component == 'core': self.assertNotEqual(run().returncode, 0, 'core hash mismatch must fail')
                env['CANDIDATE_SOURCE_SHA'] = 'branch-name'
                self.assertNotEqual(run().returncode, 0, 'non-immutable source ref must fail')

if __name__ == '__main__': unittest.main()
