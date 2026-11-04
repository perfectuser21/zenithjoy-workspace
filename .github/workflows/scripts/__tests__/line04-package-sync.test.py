import importlib.util
import pathlib
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'line04-package-sync.py'

class PackageSyncTest(unittest.TestCase):
    def test_release_sources_match_without_copying_tests(self):
        spec = importlib.util.spec_from_file_location('sync', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as folder:
            source, target = [pathlib.Path(folder) / part for part in ('source', 'target')]
            for root in (source, target):
                (root / 'voice_call').mkdir(parents=True)
                (root / 'listen_chat.py').write_text('current source')
                (root / 'voice_call' / 'call_rpa.py').write_text('voice source')
            (source / 'voice_call' / 'tests').mkdir()
            (source / 'voice_call' / 'tests' / 'test_call.py').write_text('unique authoring tests')
            self.assertEqual(module.check(source, target), [])
            (target / 'voice_call' / 'tests').mkdir()
            (target / 'voice_call' / 'tests' / 'test_call.py').write_text('duplicate')
            self.assertIn('packaged tests directory: voice_call/tests', module.check(source, target))
            (target / 'listen_chat.py').write_text('stale')
            self.assertIn('different: listen_chat.py', module.check(source, target))
            (target / 'unexpected.py').write_text('stale runtime')
            self.assertIn('extra: unexpected.py', module.check(source, target))
            (target / 'voice_call' / 'call_rpa.py').unlink()
            self.assertIn('missing: voice_call/call_rpa.py', module.check(source, target))

if __name__ == '__main__':
    unittest.main()
