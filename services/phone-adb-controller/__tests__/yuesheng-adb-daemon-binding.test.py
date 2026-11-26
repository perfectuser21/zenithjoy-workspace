from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import socket
import signal
import subprocess
import sys
from tempfile import TemporaryDirectory
import types
import unittest

SOURCE = Path(__file__).resolve().parent.parent / 'yuesheng-adb-daemon-binding.py'
binding = types.ModuleType('binding')
binding.__file__ = str(SOURCE)
exec(compile(SOURCE.read_bytes(), str(SOURCE), 'exec'), binding.__dict__)

ADB_FIXTURE = """
#include <arpa/inet.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
int main(int argc, char **argv) {
    if (argc < 3) return 1;
    char *p = strrchr(argv[2], ':');
    struct sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons(atoi(p + 1));
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (bind(fd, (void*)&addr, sizeof addr) || listen(fd, 1)) return 2;
    printf("ready\\n"); fflush(stdout);
    while (1) pause();
}
"""

def build_listener(root):
    program = root / 'adb'
    source = root / 'listener.c'
    source.write_text('#include <string.h>\n' + ADB_FIXTURE)
    subprocess.run(['/usr/bin/cc', str(source), '-o', str(program)], check=True)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    policy = {'adb_realpath': str(program), 'adb_sha256': binding.process.sha(program.read_bytes())}
    return program, port, policy


@unittest.skipUnless(sys.platform == 'darwin', 'operator kernel binding runs on macOS')
class DaemonBindingTest(unittest.TestCase):
    def test_binds_os_listener_owner_executable_and_kernel_birth(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            program, port, policy = build_listener(root)
            cmd = ['adb', '-L', 'tcp:localhost:' + str(port), 'fork-server', 'server', '--reply-fd', '5']
            child = subprocess.Popen(cmd, executable=program, stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), 'ready')
                external = binding.external_identity(port, policy)
                self.assertEqual(external['child']['pid'], child.pid)
                self.assertEqual(binding.external_identity(port, policy, external), external)
                forged = json.loads(json.dumps(external))
                forged['child']['kernel_start'][1] += 1
                with self.assertRaises(ValueError):
                    binding.external_identity(port, policy, forged)
                with self.assertRaises(ValueError):
                    binding.external_identity(port+1, policy, external)
                with self.assertRaises(ValueError):
                    binding.external_identity(port, {**policy, 'adb_sha256': '0'*64})
            finally:
                child.terminate()
                child.wait(timeout=5)
                child.stdout.close()
            with self.assertRaises(ValueError):
                binding.external_identity(port, policy, external)

    def test_binds_real_supervisor_descriptors_and_child(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            program, port, policy = build_listener(root)
            supervisor_path = root / 'supervisor.py'
            supervisor_path.write_text(
                'import fcntl,json,os,signal,subprocess,sys\n'
                'adb,port,*paths=sys.argv[1:]\n'
                'fds=[os.open(path,os.O_RDWR|os.O_CREAT|os.O_EXCL,0o600) for path in paths]\n'
                'for fd in fds: fcntl.flock(fd,fcntl.LOCK_EX)\n'
                'child=subprocess.Popen([adb,"-L","tcp:"+port,"server","nodaemon"],stdout=subprocess.PIPE,text=True)\n'
                'os.write(fds[0],json.dumps(dict(supervisor_pid=os.getpid(),child_pid=child.pid)).encode())\n'
                'print(child.stdout.readline().strip(),flush=True)\n'
                'child.wait()\n')
            locks = [root / x for x in ('instance.lock', 'port.lock', 'host.lock')]
            supervisor = subprocess.Popen([sys.executable, str(supervisor_path), str(program), str(port), *map(str, locks)],
                                          text=True, stdout=subprocess.PIPE, start_new_session=True)
            try:
                self.assertEqual(supervisor.stdout.readline().strip(), 'ready')
                proof = lambda observer: {'observed': observer['pid']}
                observed = binding.managed_identity(port, policy, locks, proof)
                self.assertEqual(observed['supervisor']['pid'], supervisor.pid)
                self.assertEqual(observed['child']['ppid'], supervisor.pid)
                self.assertEqual(binding.managed_identity(port, policy, locks, proof, observed), observed)
                displaced = locks[1].rename(root / 'displaced')
                locks[1].write_bytes(displaced.read_bytes())
                locks[1].chmod(0o600)
                with self.assertRaises(ValueError):
                    binding.managed_identity(port, policy, locks, proof, observed)
            finally:
                os.killpg(supervisor.pid, signal.SIGKILL)
                supervisor.wait(timeout=5)
                supervisor.stdout.close()

    def test_readback_requires_current_candidate_policy_and_the_receipt_used_at_process_birth(self):
        with TemporaryDirectory() as tmp:
            home = Path(tmp).resolve()
            commit = '7' * 40
            root = home / '.local/share/zenithjoy/phone-candidates' / commit / 'runtime'
            root.mkdir(parents=True)
            script = 'adb-host-service.py'
            for name in binding.instance.SOURCE_FILES:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('' if name != script else 'import time; print("ready",flush=True); time.sleep(60)\n')
            manifest = dict(source_repo='perfectuser21/zenithjoy-workspace', source_commit=commit, target='mmv',
                            files=[dict(path='services/phone-adb-controller/' + name, deployed_path=name,
                                        content_sha256=binding.process.sha((root / name).read_bytes())) for name in binding.instance.SOURCE_FILES])
            (root / 'deployment-manifest.json').write_text(json.dumps(manifest))
            policy_path = home / 'registered-policy.json'
            policy_path.write_text('{}')
            policy_path.chmod(0o600)
            row = {'policy_path': str(policy_path), 'policy': {'endpoint': 'tcp:127.0.0.1:5045'}}
            receipt_path = home / 'startup.json'
            receipt_path.touch(mode=0o600)
            now = datetime.now(timezone.utc)
            receipt = {'protocol': 'device-epoch-clean-startup/v1', 'action': 'start_private_server',
                       'issued_at': (now - timedelta(seconds=1)).isoformat(),
                       'expires_at': (now + timedelta(seconds=30)).isoformat(),
                       'scope': {'serial': 'B114E2190975', 'adb_serial': '127.0.0.1:15555', 'instance_id': binding.INSTANCE,
                                 'endpoint': row['policy']['endpoint'], 'source_commit': commit,
                                 'policy_sha256': binding.process.sha(policy_path.read_bytes()),
                                 'registry_sha256': binding.process.sha((root / binding.instance.REGISTRY).read_bytes())}}
            receipt_path.write_text(json.dumps(receipt))
            supervisor = subprocess.Popen([sys.executable, '-B', str(root / script), 'run', '--config', str(policy_path),
                                           '--maintenance-receipt', str(receipt_path)], cwd=root, text=True, stdout=subprocess.PIPE)
            try:
                self.assertEqual(supervisor.stdout.readline().strip(), 'ready')
                role = binding.process.process_identity(supervisor.pid)
                proof = binding.startup_source(role, root, row, manifest, home)
                self.assertEqual(proof['source_commit'], commit)
                self.assertEqual(proof['startup_receipt_sha256'], binding.process.sha(receipt_path.read_bytes()))
                with self.assertRaises(ValueError):
                    binding.startup_source(role, root, row, {**manifest, 'source_commit': '8' * 40}, home)
                receipt['scope']['endpoint'] = 'tcp:127.0.0.1:5044'
                receipt_path.write_text(json.dumps(receipt))
                with self.assertRaises(ValueError):
                    binding.startup_source(role, root, row, manifest, home)
            finally:
                supervisor.terminate()
                supervisor.wait(timeout=5)
                supervisor.stdout.close()

if __name__ == '__main__':
    unittest.main()
