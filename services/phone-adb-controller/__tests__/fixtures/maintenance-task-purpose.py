"""隔离真实子进程；合成带宽故障不代表历史网络根因。"""
import base64
import copy
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
FIELDS = ('id', 'status', 'task_type', 'claimed_by', 'claimed_at', 'payload')

def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / (name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def rows():
    return [{'id': 'maintenance-task', 'status': 'in_progress', 'task_type': 'dev',
             'claimed_by': 'codex:fixture', 'claimed_at': '2026-10-27T00:00:00Z',
             'payload': {'nested': [{'keep': ['完整', 1, None, False]}]}, 'result': {'unused': 'large'}}]

def document(tasks, limit=200):
    return {'schema_version': 1, 'purpose': 'adb-host-maintenance-tasks-v1',
            'source': {'host': 'mmv', 'path': '/api/brain/tasks', 'status': 'in_progress', 'limit': limit},
            'row_count': len(tasks), 'tasks': [{k: row[k] for k in FIELDS} for row in tasks]}

def rejects(fn):
    try:
        fn()
    except (ValueError, RuntimeError, subprocess.SubprocessError):
        return
    raise AssertionError('unsafe authority accepted')

def validation(case):
    mod = load('maintenance-task-authority')
    doc = document(rows())
    assert mod.validate_document(doc, 200) == doc['tasks']
    if case == 'fidelity':
        assert json.dumps(doc['tasks'][0]['payload'], ensure_ascii=False) == json.dumps(rows()[0]['payload'], ensure_ascii=False)
        assert set(doc['tasks'][0]) == set(FIELDS)
        return
    bad = copy.deepcopy(doc)
    if case == 'purpose': bad['purpose'] = 'full-task-list'
    elif case == 'source': bad['source']['path'] = '/api/brain/other'
    elif case == 'schema': bad['schema_version'] = True
    elif case == 'count': bad['row_count'] = 0
    elif case == 'count-bool': bad['row_count'] = True
    elif case == 'missing-payload': del bad['tasks'][0]['payload']
    elif case == 'payload-type': bad['tasks'][0]['payload'] = 'not-json-object'
    elif case == 'owner-type': bad['tasks'][0]['claimed_by'] = []
    elif case == 'claimed-time-type': bad['tasks'][0]['claimed_at'] = 1
    elif case == 'duplicate': bad['tasks'].append(copy.deepcopy(bad['tasks'][0])); bad['row_count'] = 2
    elif case == 'raw': bad = bad['tasks']
    elif case == 'status': bad['tasks'][0]['status'] = 'queued'
    else: raise AssertionError(case)
    rejects(lambda: mod.validate_document(bad, 200))

def transport(case):
    m = load('adb-host-maintenance')
    original_run = subprocess.run
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        data = rows()
        if case == 'large':
            data[0]['result'] = base64.b64encode(random.Random(917).randbytes(700000)).decode()
        if case == 'malicious':
            data.append({**rows()[0], 'id': 'other-task', 'payload': {'deep': [{'phone_serial': m.SERIALS[0]}]}})
        if case == 'owner': data[0]['claimed_by'] = 'other-owner'
        if case == 'duplicate': data.append(copy.deepcopy(data[0]))
        if case == 'page':
            data = [{**rows()[0], 'id': 'row-' + str(i)} for i in range(200)]
            data[0] = rows()[0]
        (d / 'tasks.json').write_text(json.dumps(data))
        expiry = datetime.datetime.fromtimestamp(time.time() + 900, datetime.timezone.utc).isoformat()
        (d / 'central.json').write_text(json.dumps({'success': True, 'locks': [
            {'device_name': serial, 'locked_by': 'maintenance-task', 'expired': False, 'expires_at': expiry}
            for serial in m.SERIALS]}))
        curl = d / 'curl'
        curl.write_text('#!' + sys.executable + '\nimport sys,pathlib\np=pathlib.Path(' + repr(str(d)) + ')\n'
                        "url=sys.argv[-1]\n"
                        "if 'device-locks' in url:sys.stdout.write((p/'central.json').read_text())\n"
                        "else:\n import json\n with (p/'calls').open('a') as f:f.write(url+'\\n')\n"
                        " sys.stdout.write((p/'tasks.json').read_text())\n")
        curl.chmod(0o700)
        ssh = d / 'ssh'
        ssh.write_text('#!' + sys.executable + '\nimport os,subprocess,sys,time\n'
                       'r=subprocess.run(["/bin/sh","-c",sys.argv[-1]],capture_output=True)\n'
                       'sys.stderr.buffer.write(r.stderr)\n'
                       'if r.returncode:sys.exit(r.returncode)\n'
                       'if len(r.stdout)>196608:\n sys.stdout.buffer.write(r.stdout[:196608]);sys.stdout.buffer.flush();time.sleep(17)\n'
                       'else:sys.stdout.buffer.write(r.stdout)\n')
        ssh.chmod(0o700)
        m.LOCK_ROOT = d / 'locks'
        m.LOCK_ROOT.mkdir(mode=0o700)
        for serial in m.SERIALS:
            lock = m.LOCK_ROOT / (serial + '.lock'); lock.mkdir()
            (lock / 'owner').write_text('fixture-owner\n')
            (lock / 'acquired_at').write_text(str(int(time.time())))
        def isolated(argv, **kwargs):
            if argv[0] == '/usr/bin/ssh': argv = [str(ssh), *argv[1:]]
            return original_run(argv, **kwargs)
        subprocess.run = isolated
        previous = os.environ.copy()
        os.environ['PATH'] = str(d) + os.pathsep + previous['PATH']
        os.environ['DOUYIN_LOCK_SSH_BIN'] = '/must-not-be-used'
        start = time.monotonic()
        try:
            run = lambda: m.read_authority('maintenance-task', 'codex:fixture', 'fixture-owner')
            if case in ('malicious', 'owner', 'duplicate'): rejects(run)
            else:
                assert run() == {k: rows()[0][k] for k in ('id', 'claimed_by', 'claimed_at')}
                if case == 'large': assert time.monotonic() - start < 15
                if case == 'page':
                    calls = (d / 'calls').read_text().splitlines()
                    assert len(calls) == 2 and calls[0].endswith('limit=200') and calls[1].endswith('limit=400'), calls
            assert os.environ['DOUYIN_LOCK_SSH_BIN'] == '/must-not-be-used'
        finally:
            subprocess.run = original_run
            os.environ.clear(); os.environ.update(previous)

def manifest():
    m = load('adb-host-maintenance')
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp); files = []
        for name in m.REQUIRED_FILES:
            if name == 'maintenance-task-authority.py': continue
            (root / name).write_text(name)
            files.append({'path': 'services/phone-adb-controller/' + name, 'deployed_path': name,
                          'content_sha256': hashlib.sha256(name.encode()).hexdigest()})
        path = root / 'manifest.json'
        path.write_text(json.dumps({'source_repo': m.REPO, 'source_commit': 'a' * 40, 'files': files}))
        rejects(lambda: m.verify_manifest(path, root))

case = sys.argv[1]
if case.startswith('validation:'): validation(case.split(':')[1])
elif case.startswith('transport:'): transport(case.split(':')[1])
elif case == 'manifest': manifest()
else: raise AssertionError(case)
