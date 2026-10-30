import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
import warnings
import zipfile

ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('comfy_assets', ROOT/'scripts/deploy/comfy_official_assets.py')
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
PREFIX='comfyui_frontend_package/static/assets/'

class OfficialAssetsTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.wheel=self.root/'bundle.whl'
        self.out=self.root/'dist'
    def write_wheel(self, entries):
        with warnings.catch_warnings():
            warnings.simplefilter('ignore',UserWarning)
            with zipfile.ZipFile(self.wheel,'w') as z:
                for name,data in entries:
                    if isinstance(name,zipfile.ZipInfo): z.writestr(name,data)
                    else: z.writestr(name,data)
        return hashlib.sha256(self.wheel.read_bytes()).hexdigest()
    def base(self):
        return [(PREFIX+n,('content-'+n).encode()) for n in mod.REQUIRED_ASSETS]+[('comfyui_frontend_package/static/fonts/'+n,('font-'+n).encode()) for n in ('inter-latin-normal.woff2','inter-latin-italic.woff2','materialdesignicons-webfont.woff2')]
    def test_extract_exact_bytes_and_skip_sourcemaps(self):
        entries=self.base()+[(PREFIX+'nested/icon.svg',b'<svg/>'),(PREFIX+'file.js.map',b'secret source'),(PREFIX+'CREDIT.txt',b'credit')]
        h=self.write_wheel(entries)
        release=mod.extract_assets(self.wheel,self.out,h)
        self.assertEqual(release,self.out/'assets'/'comfy'/h)
        self.assertEqual((release/'assets/nested/icon.svg').read_bytes(),b'<svg/>')
        self.assertFalse((release/'assets/file.js.map').exists())
        self.assertFalse((release/'assets/CREDIT.txt').exists())
        self.assertEqual((release/'fonts/inter-latin-normal.woff2').read_bytes(),b'font-inter-latin-normal.woff2')
        data=json.loads((release/'manifest.json').read_text())
        self.assertEqual(data['wheel_sha256'],h)
        self.assertEqual(data['files']['assets/nested/icon.svg'],hashlib.sha256(b'<svg/>').hexdigest())
    def test_wrong_digest_refuses_and_creates_no_release(self):
        self.write_wheel(self.base())
        with self.assertRaises(ValueError): mod.extract_assets(self.wheel,self.out,'0'*64)
        self.assertFalse((self.out/'assets'/'comfy').exists())
    def test_paths_links_and_duplicates_fail_without_partial_release(self):
        link=zipfile.ZipInfo(PREFIX+'sym.js'); link.create_system=3;link.external_attr=(stat.S_IFLNK|0o777)<<16
        for illegal in [[(PREFIX+'../escape.js',b'bad')],[(link,b'target')],[(PREFIX+mod.REQUIRED_ASSETS[0],b'duplicate')],[(PREFIX+'nested/../escape.js',b'bad')]]:
            h=self.write_wheel(self.base()+illegal)
            with self.subTest(illegal=illegal), self.assertRaises(ValueError):mod.extract_assets(self.wheel,self.out,h)
            self.assertFalse((self.out/'assets'/'comfy'/h).exists())
    def test_incomplete_release_does_not_publish(self):
        h=self.write_wheel([(PREFIX+mod.REQUIRED_ASSETS[0],b'foo')])
        with self.assertRaises(ValueError):mod.extract_assets(self.wheel,self.out,h)
        self.assertFalse((self.out/'assets'/'comfy'/h).exists())
    def test_existing_release_must_be_identical(self):
        h=self.write_wheel(self.base())
        release=mod.extract_assets(self.wheel,self.out,h)
        (release/'assets'/mod.REQUIRED_ASSETS[0]).write_text('tampered')
        with self.assertRaises(ValueError): mod.extract_assets(self.wheel,self.out,h)
        self.assertEqual((release/'assets'/mod.REQUIRED_ASSETS[0]).read_text(),'tampered')

if __name__=='__main__': unittest.main()
