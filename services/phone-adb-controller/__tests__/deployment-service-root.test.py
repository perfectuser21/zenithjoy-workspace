"""以root在唯一临时目录验证真正的owner/mode/fsync；不加载任何LaunchDaemon。"""
import base64
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


@unittest.skipUnless(os.geteuid() == 0, 'run with sudo to test real root ownership')
class RootServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='phone-root-permission-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        source = Path(__file__).resolve().parents[1]/'deployment-service.py'
        spec = importlib.util.spec_from_file_location('root_service',source)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.module.PLIST = self.root/'isolated.plist'
        self.old = self.value(b'old isolated service')
        self.new = self.value(b'new isolated service')
        self.module.root_write({'kind':'missing'},self.old)

    def value(self, data):
        return {'kind':'file','bytes':base64.b64encode(data).decode(),'uid':0,'gid':0,'mode':0o644}

    def test_real_root_restore_keeps_owner_and_exact_permissions(self):
        self.module.root_write(self.old,self.new)
        self.module.root_write(self.new,self.old)
        self.assertEqual(self.module.file_state(),self.old)
        info = self.module.PLIST.stat()
        self.assertEqual((info.st_uid,info.st_gid,info.st_mode & 0o777),(0,0,0o644))

    def test_disk_full_before_rename_does_not_replace_root_file(self):
        with patch.object(self.module.tx.os,'fsync',side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.module.root_write(self.old,self.new)
        self.assertEqual(self.module.file_state(),self.old)
        self.assertFalse(list(self.root.glob('.phone-recovery-*')))

    def test_symlink_target_and_wrong_owner_description_rejected(self):
        original = self.module.PLIST
        self.module.PLIST = self.root/'link'
        self.module.PLIST.symlink_to(original)
        with self.assertRaisesRegex(ValueError,'symlink'):
            self.module.root_write(self.old,self.new)
        self.module.PLIST = original
        with self.assertRaisesRegex(ValueError,'root'):
            self.module.root_write(self.old,{**self.new,'uid':501})
        self.assertEqual(self.module.file_state(),self.old)


if __name__ == '__main__':
    unittest.main()
