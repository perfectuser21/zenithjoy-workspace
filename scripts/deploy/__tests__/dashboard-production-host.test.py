import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / 'dashboard-production-host.py'
SPEC = importlib.util.spec_from_file_location('dashboard_production_host', SOURCE)
host = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = host
SPEC.loader.exec_module(host)

OLD = '1' * 40
NEW = '2' * 40
OTHER = '3' * 40


def content(sha):
    return {
        'index.html': b'<script src="/assets/index.js"></script>',
        'release-sha.json': json.dumps({'sha': sha}).encode(),
        'assets/index.js': f'// bundle {sha}\n'.encode()
    }


def archive(files):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as tar:
        for path, data in files.items():
            entry = tarfile.TarInfo('./' + path)
            entry.size = len(data)
            tar.addfile(entry, io.BytesIO(data))
    return buf.getvalue()


class HostRelease(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.live = self.root / 'dist'
        for name, data in content(OLD).items():
            target = self.live / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        self.target = host.Target(self.live, 'fixture-only', 'http://127.0.0.1')
        self.release = host.ReleaseHost(self.target)
        self.mounted_sha = OLD
        self.fail_restart = False

        def verify(target, bundle):
            if bundle.sha != self.mounted_sha:
                raise host.ReleaseError('fixture did not mount expected SHA')

        def restart(target, lock_fd):
            self.assertEqual(target, self.target)
            self.assertGreater(lock_fd, 0)
            if self.fail_restart:
                raise host.ReleaseError('fixture restart uncertainty')
            self.mounted_sha = host.read_tree(self.live.resolve()).sha

        def exchange(left, right):
            # The behavioral fixture runs on macOS too; Linux bind reopening has
            # a separate real-host exercise.
            temp = self.root / 'exchange-temp'
            left.rename(temp)
            right.rename(left)
            temp.rename(right)

        for name, func in [('verify_live', verify), ('restart', restart), ('exchange', exchange)]:
            p = patch.object(host, name, side_effect=func)
            p.start()
            self.addCleanup(p.stop)

    def prepare(self, sha=NEW, files=None, digest=None):
        data = archive(content(sha) if files is None else files)
        return self.release.prepare(sha, digest or hashlib.sha256(data).hexdigest(), len(data), io.BytesIO(data))

    def test_read_only_inspect_and_verified_bootstrap(self):
        self.assertEqual(self.release.inspect()['sha'], OLD)
        self.assertFalse(self.release.state.exists())
        candidate = self.prepare()
        self.assertEqual(candidate['sha'], NEW)
        self.assertEqual(self.release.inspect()['sha'], OLD)
        self.assertTrue(self.release.read_record(OLD)['verified'])
        self.assertFalse(self.release.read_record(NEW)['verified'])

    def test_activate_then_rollback_twice(self):
        candidate = self.prepare()
        self.assertEqual(self.release.activate(NEW, OLD), candidate)
        self.assertEqual(self.release.activate(NEW, OLD), candidate)
        self.assertEqual(self.release.inspect(), candidate)
        restored = self.release.restore(OLD, NEW)
        self.assertEqual(self.release.restore(OLD, NEW), restored)
        self.assertEqual(self.release.inspect(), restored)
        self.assertEqual(restored['sha'], OLD)
        self.assertTrue((self.release.state / 'original-bind').is_dir())

    def test_switch_requires_expected_previous_and_verified_rollback(self):
        self.prepare()
        with self.assertRaises(host.ReleaseError):
            self.release.activate(NEW, OTHER)
        with self.assertRaises(host.ReleaseError):
            self.release.restore(NEW, OLD)
        self.assertEqual(self.release.inspect()['sha'], OLD)

    def test_pending_switch_after_restart_uncertainty_can_recover(self):
        self.prepare()
        self.fail_restart = True
        with self.assertRaises(host.ReleaseError):
            self.release.activate(NEW, OLD)
        status = self.release.inspect()
        self.assertEqual(status['sha'], NEW)
        self.assertEqual(status['pending'], {'before': OLD, 'target': NEW})
        self.assertEqual(self.mounted_sha, OLD)
        with self.assertRaises(host.ReleaseError):
            self.prepare(OTHER)
        self.fail_restart = False
        self.release.restore(OLD, NEW)
        self.assertEqual(self.release.inspect()['sha'], OLD)
        self.assertNotIn('pending', self.release.inspect())

    def test_same_sha_refuses_byte_replacement_and_bad_archive_digest(self):
        with self.assertRaises(host.ReleaseError):
            self.prepare(digest='0' * 64)
        self.prepare()
        changed = content(NEW)
        changed['assets/index.js'] = b'changed without a SHA change'
        with self.assertRaises(host.ReleaseError):
            self.prepare(files=changed)
        self.assertEqual(self.release.inspect()['sha'], OLD)


if __name__ == '__main__':
    unittest.main()
