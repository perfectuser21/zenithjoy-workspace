"""根属启动配置的精确恢复；适配器模拟launchd，文件实际落临时目录。"""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'deployment-service.py'


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'service.json'
        spec = importlib.util.spec_from_file_location('phone_service', SOURCE)
        self.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)
        self.old = {'kind':'file','bytes':'b2xk','mode':0o644,'uid':0,'gid':0}
        self.new = {'kind':'file','bytes':'bmV3','mode':0o644,'uid':0,'gid':0}
        self.value = {'file':self.old.copy(),'loaded':True,'disabled':False}
        self.calls = []

    def get(self):
        return {**self.value, 'file':self.value['file'].copy()}

    def set_file(self, expected, wanted):
        self.assertEqual(self.value['file'], expected)
        self.calls.append('file')
        self.value['file'] = wanted.copy()

    def load(self, wanted):
        self.calls.append('load' if wanted else 'unload')
        self.value['loaded'] = wanted

    def prepare(self):
        self.mod.prepare(self.path, self.new, self.get)

    def change(self, direction):
        return self.mod.change(self.path, direction, self.get, self.set_file, self.load)

    def test_file_and_original_loaded_state_restore_after_partial_apply(self):
        self.prepare()
        self.change('after')
        self.change('before')
        self.assertEqual(self.value, {'file':self.old,'loaded':True,'disabled':False})
        self.assertEqual(self.calls, ['unload','file','load','unload','file','load'])

    def test_crash_after_bootout_recovers_and_never_enables_previously_disabled_service(self):
        self.value.update(loaded=False, disabled=True)
        self.prepare()
        self.value['file'] = self.new
        self.change('before')
        self.assertFalse(self.value['loaded'])
        self.assertTrue(self.value['disabled'])

    def test_unrelated_root_file_or_disabled_change_refuses_all_mutations(self):
        self.prepare()
        self.value['file'] = {**self.new,'bytes':'b3RoZXI='}
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.change('before')
        self.assertEqual(self.calls, [])
        self.value['file'] = self.old
        self.value['disabled'] = True
        with self.assertRaisesRegex(ValueError, 'disabled'):
            self.change('before')
        self.assertEqual(self.calls, [])

    def test_original_missing_file_is_removed_without_creating_service(self):
        self.value.update(file={'kind':'missing'}, loaded=False)
        self.prepare()
        self.change('after')
        self.change('before')
        self.assertEqual(self.value['file'], {'kind':'missing'})
        self.assertFalse(self.value['loaded'])

    def test_root_owner_permissions_and_snapshot_digest_are_required(self):
        for wrong in ({'uid':501},{'gid':20},{'mode':0o666}):
            self.value['file'] = {**self.old, **wrong}
            with self.assertRaisesRegex(ValueError, 'root'):
                self.prepare()
        self.value['file'] = self.old
        self.prepare()
        self.path.write_bytes(self.path.read_bytes().replace(b'b2xk',b'c2Ft'))
        with self.assertRaisesRegex(ValueError, 'digest'):
            self.change('before')

    def test_reload_failure_keeps_snapshot_and_can_resume_recovery(self):
        self.prepare()
        def fail_load(wanted):
            if wanted:
                raise OSError('launchd lost')
            self.load(wanted)
        with self.assertRaises(OSError):
            self.mod.change(self.path,'after',self.get,self.set_file,fail_load)
        self.assertTrue(self.path.exists())
        self.change('before')
        self.assertEqual(self.value['file'], self.old)
        self.assertTrue(self.value['loaded'])


if __name__ == '__main__':
    unittest.main()
