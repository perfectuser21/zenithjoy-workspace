"""Smoke the official policy-only installation without touching a phone or real HOME."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]


class InstallSmoke(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('mmv_install', HERE / 'adb-mmv-policy-install.py')
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name).resolve()
        self.root = self.home / 'installed'
        self.root.mkdir()
        for name in self.m.FILES:
            dest = self.root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes((HERE / name).read_bytes())
        self.binary = self.home / 'adb'
        self.binary.write_bytes(b'pinned-adb')
        config = json.loads((self.root / 'config/collection-phone-hosts.json').read_text())
        self.row = next(x for x in config['hosts'] if x['target'] == 'mmv')
        self.row['policy'].update(adb_bin=str(self.binary), adb_realpath=str(self.binary),
                                  adb_sha256=hashlib.sha256(self.binary.read_bytes()).hexdigest())
        (self.root / 'config/collection-phone-hosts.json').write_text(json.dumps(config))
        self.manifest = self.root / 'deployment-manifest.json'
        self.refresh_manifest()
        self.active = self.home / '.config/zenithjoy/adb-service.json'
        self.patches = [patch.object(self.m, 'HERE', self.root),
            patch.object(self.m.socket, 'gethostname', return_value='r10-7.macminivault.com'),
            patch.object(self.m.pwd, 'getpwuid', return_value=SimpleNamespace(pw_name='administrator', pw_dir=str(self.home))),
            patch.dict(os.environ, {'HOME': str(self.home)})]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        self.inspector = patch.object(self.m, 'inspect_route', side_effect=lambda policy: {
            'host_id': 'mmv', 'endpoint': policy['endpoint'], 'port': 5041,
            'devices': [{'serial': self.row['serial'], 'state': 'device'}]})
        self.inspect = self.inspector.start()
        self.addCleanup(self.inspector.stop)

    def refresh_manifest(self):
        self.manifest.write_text(json.dumps({'source_repo': 'perfectuser21/zenithjoy-workspace',
            'source_commit': 'a' * 40, 'target': 'mmv', 'files': [
                {'path': 'services/phone-adb-controller/' + name, 'deployed_path': name,
                 'content_sha256': hashlib.sha256((self.root / name).read_bytes()).hexdigest()}
                for name in self.m.FILES]}))

    def install(self):
        return self.m.install(str(self.manifest), 'a' * 40)

    def test_first_install_and_idempotent_readback(self):
        first = self.install()
        info = self.active.lstat()
        self.assertEqual(stat.S_IMODE(info.st_mode), 0o600)
        self.assertEqual(info.st_uid, os.geteuid())
        self.assertEqual(info.st_nlink, 1)
        self.assertEqual(json.loads(self.active.read_text()), self.row['policy'])
        self.assertTrue(first['created'])
        self.assertFalse(self.install()['created'])
        self.assertEqual(self.active.stat().st_ino, info.st_ino)

    def test_conflict_permissions_and_links_preserved(self):
        self.install()
        raw = self.active.read_bytes()
        self.active.write_text('{}')
        with self.assertRaises(ValueError): self.install()
        self.assertEqual(self.active.read_text(), '{}')
        self.active.write_bytes(raw)
        self.active.chmod(0o644)
        with self.assertRaises(ValueError): self.install()
        self.active.chmod(0o600)
        os.link(self.active, self.home / 'alias')
        with self.assertRaises(ValueError): self.install()
        self.active.unlink()
        self.active.symlink_to(self.home / 'alias')
        with self.assertRaises(ValueError): self.install()

    def test_wrong_host_or_user_and_source_drift_write_nothing(self):
        for hostname in ['mmv', 'm4-xian.local', 'r10-70']:
            with patch.object(self.m.socket, 'gethostname', return_value=hostname):
                with self.assertRaises(ValueError): self.install()
        with patch.object(self.m.pwd, 'getpwuid', return_value=SimpleNamespace(pw_name='jinnuoshengyuan', pw_dir=str(self.home))):
            with self.assertRaises(ValueError): self.install()
        (self.root / 'adb-existing-route.py').write_text('# drift')
        with self.assertRaises(ValueError): self.install()
        self.assertFalse(self.active.exists())

    def test_bad_binary_or_offline_device_write_nothing(self):
        self.binary.write_bytes(b'changed')
        with self.assertRaises(ValueError): self.install()
        self.binary.write_bytes(b'pinned-adb')
        self.inspect.side_effect = ValueError('ADB_HOST_SERVER_UNAVAILABLE')
        with self.assertRaises(ValueError): self.install()
        self.assertFalse(self.active.exists())

    def test_directory_symlink_refused(self):
        target = self.home / 'elsewhere'
        target.mkdir(mode=0o700)
        (self.home / '.config').symlink_to(target)
        with self.assertRaises(ValueError): self.install()
        self.assertFalse((target / 'zenithjoy/adb-service.json').exists())

    def test_wrong_route_or_policy_shape_refused(self):
        self.inspect.side_effect = lambda policy: {'host_id': 'mmv', 'endpoint': policy['endpoint'],
            'port': 5041, 'devices': [{'serial': self.row['serial'], 'state': 'offline'}]}
        with self.assertRaises(ValueError): self.install()
        self.assertFalse(self.active.exists())


if __name__ == '__main__':
    unittest.main()
