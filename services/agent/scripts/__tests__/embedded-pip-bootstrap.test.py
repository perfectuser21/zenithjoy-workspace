"""Execute the Windows branch with a fake interpreter; reject get-pip self-install."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]

class EmbeddedPipBootstrapTest(unittest.TestCase):
    def test_windows_bootstrap_uses_zipapp_before_module_install(self):
        source = (ROOT / 'scripts/build-install-pack.sh').read_text()
        function = source[source.index('install_embedded_pkgs() {'):source.index('\nINSTALL_OK=0')]
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            (root / 'python.exe').write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\ncase "$1" in *get-pip.py) exit 99;; esac\n')
            (root / 'python.exe').chmod(0o755)
            script = 'set -eu\nuname() { echo MINGW64_NT; }\ncurl() { :; }\n' + function + '\ninstall_embedded_pkgs\n'
            import os
            env = dict(os.environ, PYTHON_EMBED_DIR=folder, SITE_PKGS=folder+'/Lib/site-packages',
                       GETPIP_URL='unused', PIP_ZIPAPP_URL='https://bootstrap.pypa.io/pip/pip.pyz',
                       WHEEL_PKGS='pywinauto pywin32', CALLS=folder+'/calls')
            result = subprocess.run(['bash', '-c', script], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = (root / 'calls').read_text().splitlines()
            self.assertIn('pip.pyz install --upgrade --target', calls[0])
            self.assertTrue(calls[1].startswith('-m pip install --target '))
            self.assertIn('pywinauto pywin32', calls[1])

if __name__ == '__main__': unittest.main()
