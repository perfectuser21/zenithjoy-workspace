"""Check that manual verification cannot reach COS or production by default."""
import pathlib
import unittest
import yaml

PATH = pathlib.Path(__file__).resolve().parents[4] / '.github/workflows/agent-installpack.yml'

class BuildOnlyTest(unittest.TestCase):
    def test_default_dispatch_is_build_only_and_all_mutations_are_gated(self):
        doc = yaml.safe_load(PATH.read_text())
        triggers = doc.get('on', doc.get(True))
        self.assertIs(triggers['workflow_dispatch']['inputs']['publish']['default'], False)
        gate = "github.event_name == 'push' || inputs.publish == true"
        self.assertEqual(doc['jobs']['publish']['if'], gate)
        for job in doc['jobs'].values():
            for step in job['steps']:
                run = step.get('run', '')
                if any(marker in run for marker in ('coscmd upload', 'cos-upload.py', 'VPS_API_URL', 'VPS_INTERNAL_TOKEN')):
                    self.assertEqual(step.get('if', job.get('if')), gate, step.get('name'))
        steps = doc['jobs']['build']['steps']
        names = [step.get('name') for step in steps]
        self.assertLess(names.index('Dryrun verify (embedded-python import check)'),
                        names.index('Upload to COS (cos.accelerate CDN bypass)'))
        self.assertIn('Upload verified build-only package', names)

if __name__ == '__main__': unittest.main()
