#!/usr/bin/env python3
"""固定录音producer私有日志；只读检查不发信号，不启动ADB或录音。"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import uuid

HERE = Path(__file__).resolve().parent

def need(ok):
    if not ok:
        raise ValueError('OFFICIAL_RECORDING_UNKNOWN')

def private(path):
    path = Path(path)
    need(path.is_absolute() and not path.is_symlink())
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        st = os.fstat(fd)
        need(stat.S_ISREG(st.st_mode) and st.st_uid == os.getuid() and stat.S_IMODE(st.st_mode) == 0o600 and st.st_size <= 1024*1024)
        raw = os.read(fd, 1024*1024+1)
        need(len(raw) <= 1024*1024)
        return raw
    finally:
        os.close(fd)

def identity_module():
    spec = importlib.util.spec_from_file_location('fixed_recording_identity', HERE / 'qualification-maintenance-processes.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def persist(path, value, exclusive=False):
    target = Path(path)
    tmp = target if exclusive else Path(str(target)+'.'+uuid.uuid4().hex+'.tmp')
    fd = os.open(tmp, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    try:
        raw = json.dumps(value, sort_keys=True).encode()
        with os.fdopen(fd, 'wb', closefd=False) as out:
            out.write(raw)
            out.flush()
            os.fsync(fd)
    finally:
        os.close(fd)
    if not exclusive:
        os.replace(tmp, target)
    fd = os.open(target.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def intent(path):
    raw = private(path)
    value = json.loads(raw)
    need(value['protocol'] == 'official-recording-intent/v1' and value['uid'] == os.getuid())
    need(Path(path).name == value['evidence_id']+'.official-recording-intent.json')
    return value, hashlib.sha256(raw).hexdigest()

def reserve(path):
    value, sha = intent(path)
    receipt = str(path)+'.producer.'+uuid.uuid4().hex+'.json'
    persist(receipt, {'protocol':'official-recording-process/v1','intent_sha256':sha,'status':'reserved'}, True)
    return receipt, sha

def bind(receipt, sha, pid, launch_argv=None):
    row = identity_module().kernel(pid)
    need(row is not None and row['uid'] == os.getuid())
    if row['terminal']:
        need(launch_argv is not None)
        argv = [str(x) for x in launch_argv]
    else:
        _, argv = identity_module().args(pid)
    row['argv_sha256'] = hashlib.sha256(json.dumps(argv, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    persist(receipt, {'protocol':'official-recording-process/v1','intent_sha256':sha,'status':'bound',**row})
    return row

def register_current(path):
    receipt, sha = reserve(path)
    return bind(receipt, sha, os.getpid())

def owned_popen(argv, **kwargs):
    path = os.environ.get('ZJ_OFFICIAL_RECORDING_INTENT')
    if not path:
        return subprocess.Popen(argv, **kwargs)
    # A durable unresolved reservation is made BEFORE Popen. An interrupted
    # launch therefore cannot disappear merely because its PID was not saved.
    receipt, sha = reserve(path)
    child = subprocess.Popen(argv, **kwargs)
    try:
        bind(receipt, sha, child.pid, argv)
    except BaseException:
        # Never authorize further work; unresolved reservation remains sticky.
        try:
            child.kill()
            child.wait(timeout=1)
        except BaseException:
            pass
        raise
    return child

def inspect(path):
    _, sha = intent(path)
    module = identity_module()
    rows = []
    for file in sorted(Path(path).parent.glob(Path(path).name+'.producer.*.json')):
        row = json.loads(private(file))
        need(row.get('protocol') == 'official-recording-process/v1' and row.get('intent_sha256') == sha and row.get('status') == 'bound')
        need(type(row.get('pid')) is int and row['pid'] > 1 and isinstance(row.get('start_identity'), str) and row.get('uid') == os.getuid())
        current = module.kernel(row['pid'])
        # Reuse is not silently accepted: this adapter never signals a PID.
        state = 'absent' if current is None else 'reused' if current['start_identity'] != row['start_identity'] else 'terminal' if current['terminal'] else 'alive'
        rows.append({**row,'state':state,'receipt_sha256':hashlib.sha256(private(file)).hexdigest()})
    return {'protocol':'official-recording-observation/v1','intent_sha256':sha,'processes':rows}

if __name__ == '__main__':
    try:
        need(len(sys.argv) == 3 and sys.argv[1] == 'inspect')
        print(json.dumps(inspect(sys.argv[2])))
    except Exception:
        print(json.dumps({'protocol':'official-recording-observation/v1','unknown':True}))
        sys.exit(1)
