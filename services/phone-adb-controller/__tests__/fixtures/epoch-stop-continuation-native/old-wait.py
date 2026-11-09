"""Offline fixture: reproduce nested Popen.wait without any field daemon."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import select
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import types

SOURCE = Path(__file__).resolve().parents[3]


def load(path):
    module = types.ModuleType('native_fixture')
    module.__file__ = str(path)
    exec(compile(path.read_bytes(), str(path), 'exec'), module.__dict__)
    return module


with tempfile.TemporaryDirectory(prefix='epoch-stop-native-') as directory:
    root = Path(directory).resolve()
    home = root / 'home'
    locks = home / '.config/zenithjoy'
    locks.mkdir(parents=True)
    (root / 'config').mkdir()
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    assert port not in (5037, 5041, 5042)
    binary = root / 'fixture-adb'
    code = '#include <sys/socket.h>\n#include <netinet/in.h>\n#include <stdlib.h>\n#include <unistd.h>\nint main(int c,char**v){int s=socket(AF_INET,SOCK_STREAM,0);struct sockaddr_in a={0};a.sin_family=AF_INET;a.sin_addr.s_addr=htonl(0x7f000001);a.sin_port=htons(atoi(v[2]+4));if(bind(s,(void*)&a,sizeof(a))||listen(s,2))return 2;for(;;)pause();}\n'
    subprocess.run(['cc', '-x', 'c', '-o', str(binary), '-'], input=code, text=True, capture_output=True, check=True)
    digest = lambda raw: hashlib.sha256(raw).hexdigest()
    policy = {'schema_version': 2, 'instance_id': 'mmv-cloud-epoch2', 'host_id': 'mmv', 'transport': 'tcp', 'endpoint': 'tcp:127.0.0.1:' + str(port), 'forbidden_ports': [], 'adb_bin': str(binary), 'adb_realpath': str(binary), 'adb_sha256': digest(binary.read_bytes())}
    path = root / 'policy.json'
    path.write_text(json.dumps(policy)); path.chmod(0o600)
    receipt = root / 'receipt.json'
    receipt.write_text('{}'); receipt.chmod(0o600)
    registry = {'schema_version': 1, 'startup_verifier': {'module': 'device-epoch-fence-review.mjs', 'node': {'path': '/fixture/node', 'sha256': 'b'*64}}, 'instances': [{'instance_id': policy['instance_id'], 'kind': 'managed', 'policy_path': str(path), 'policy': policy, 'coexists_with': []}]}
    (root / 'config/adb-host-instances.json').write_text(json.dumps(registry))
    for name in ('adb-host-instance-policy.py', 'adb-existing-route.py', 'adb-managed-client.py', 'adb-process-observation.py', 'adb-private-supervisor.py'):
        shutil.copyfile(SOURCE / name, root / name)
    service = root / 'adb-host-service.py'
    service.write_text('''import os,sys,json,pathlib,subprocess,signal,fcntl,threading,time
p=json.load(open(sys.argv[3]));base=pathlib.Path(os.environ['HOME'])/'.config/zenithjoy';port=int(p['endpoint'].rsplit(':',1)[1]);fds=[]
for n in ['adb-host.instance-'+p['instance_id']+'.lock','adb-host.port-'+str(port)+'.lock']:
 f=os.open(base/n,os.O_RDWR|os.O_CREAT,0o600);fcntl.flock(f,fcntl.LOCK_EX);fds.append(f)
c=subprocess.Popen([p['adb_realpath'],'-L','tcp:'+str(port),'server','nodaemon']);os.write(fds[0],json.dumps({'supervisor_pid':os.getpid(),'child_pid':c.pid}).encode());os.fsync(fds[0])
def stop(sig,frame):
 print('FORWARDED',flush=True);c.send_signal(sig);c.wait(timeout=10)
def watch():
 while not c._waitpid_lock.locked():time.sleep(.001)
 print('WAITING',flush=True)
signal.signal(signal.SIGTERM,stop);threading.Thread(target=watch,daemon=True).start();c.wait()
''')
    files = [{'path': 'services/phone-adb-controller/' + str(p.relative_to(root)), 'deployed_path': str(p.relative_to(root)), 'content_sha256': digest(p.read_bytes())} for p in root.rglob('*') if p.is_file()]
    (root / 'deployment-manifest.json').write_text(json.dumps({'source_repo': 'perfectuser21/zenithjoy-workspace', 'source_commit': 'f'*40, 'target': 'mmv', 'files': files}))
    helper = load(root / 'adb-private-supervisor.py')
    helper.pwd.getpwuid = lambda uid: types.SimpleNamespace(pw_dir=str(home))
    document = {'action': 'inspect', 'instance_id': policy['instance_id'], 'endpoint': policy['endpoint'], 'source_commit': 'f'*40, 'policy_path': str(path), 'policy_sha256': digest(path.read_bytes()), 'supervisor_source': {'runtime_root': str(root), 'source_commit': 'f'*40, 'service_sha256': digest(service.read_bytes())}}
    owned = subprocess.Popen([str(Path(sys.executable).resolve()), str(service), 'run', '--config', str(path), '--maintenance-receipt', str(receipt)], env={**os.environ, 'HOME': str(home)}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert select.select([owned.stdout], [], [], 5)[0]
        assert owned.stdout.readline().strip() == 'WAITING'
        actual = None
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                actual = helper.run(document)['actual']; break
            except (ValueError, OSError):
                time.sleep(.02)
        assert actual is not None
        # Exactly one old stop. No retry, no helper-invented terminal facts.
        owned.send_signal(signal.SIGTERM)
        assert select.select([owned.stdout], [], [], 2)[0]
        assert owned.stdout.readline().strip() == 'FORWARDED'
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline and not helper.identity_terminal(actual['child']):
            time.sleep(.02)
        assert helper.identity_terminal(actual['child']) and not helper.listeners(port)
        assert owned.poll() is None
        try:
            helper.run({**document, 'action': 'terminal', 'expected': actual})
        except ValueError:
            rejected = True
        else:
            raise AssertionError('live parent must not prove terminal')
        assert all(helper.lock_state(p)[0]['held'] for p in locks.iterdir())
        # Independent fixture Ops reaps this exact held parent once.
        owned.kill(); owned.wait(timeout=3)
        proof = helper.run({**document, 'action': 'terminal', 'expected': actual})
        assert proof['selected_identities_absent'] and proof['listener_absent'] and proof['instance_locks_released']
        print(json.dumps({'private_terminal_unknown': rejected, 'old_stop_signals': 1, 'ops_parent_reclaims': 1, 'proof': proof, 'field_actions': 0}))
    finally:
        if owned.poll() is None:
            owned.kill(); owned.wait(timeout=3)
