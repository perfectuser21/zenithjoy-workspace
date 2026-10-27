"""隔离真实宿主子进程；不调用ADB、不枚举USB、不触达手机。"""
import ctypes
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / (name + '.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

def reject(fn, text=None):
    try: fn()
    except (ValueError, RuntimeError) as e:
        if text: assert text in str(e), str(e)
        return
    raise AssertionError('unsafe process observation accepted')

def service():
    m = load('adb-host-service'); policy = {**m.POLICY, 'port': 5037}
    with tempfile.TemporaryDirectory() as tmp:
        parser = Path(tmp) / 'listen-parser'
        parser.write_text('#!' + sys.executable + '\nimport sys\n'
                          "assert sys.argv[1:]==['-L','tcp:5037','server','nodaemon'], 'hostname listener unsupported'\n")
        parser.chmod(0o700)
        argv = m.foreground_command({**policy, 'adb_bin': str(parser)})
        r = subprocess.run(argv, capture_output=True, text=True, timeout=2)
        assert r.returncode == 0, r.stderr
    assert policy['endpoint'] == 'tcp:127.0.0.1:5037'
    assert policy['forbidden_ports'] == [5041, 5042]
    assert '-a' not in argv and not any('0.0.0.0' in x for x in argv)

def native(mode):
    m = load('adb-host-maintenance')
    child = subprocess.Popen([sys.executable, '-c',
        "import signal,time,sys,os\ndef done(*a):\n time.sleep(.12);os._exit(0)\n"
        "signal.signal(signal.SIGTERM,done)\nprint('ready',flush=True)\ntime.sleep(5)"], stdout=subprocess.PIPE, text=True)
    try:
        assert child.stdout.readline().strip() == 'ready'
        expected = m.public_identity(m.process_identity(child.pid))
        if mode == 'exit-window':
            original = m.process_executable
            def exit_in_exe(pid):
                os.kill(pid, signal.SIGTERM)
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    r = subprocess.run(['/bin/ps','-p',str(pid),'-o','stat='],capture_output=True,text=True)
                    if r.returncode == 1 or r.stdout.strip().startswith('Z'): break
                    time.sleep(.01)
                else: raise AssertionError('child did not terminate')
                return original(pid)
            m.process_executable = exit_in_exe
        start=time.monotonic()
        m.terminate_exact(expected)
        assert time.monotonic()-start<2, 'must observe requested exit, not wait for five-second TTL'
        # 不以观察器自述证明停：实际wait回收本Popen，禁止吞unknown冒完成。
        child.wait(timeout=1)
        assert child.returncode is not None
    finally:
        if child.poll() is None: child.kill()
        child.wait(timeout=2)
        child.stdout.close()

def kernel(mode):
    m = load('adb-process-observation')
    m.sys.platform = 'darwin'  # only the isolated fake-loader fixture
    assert ctypes.sizeof(m.BSDInfo) == 136
    assert m.BSDInfo.pbi_start_tvsec.offset == 120 and m.BSDInfo.pbi_start_tvusec.offset == 128
    class Fn:
        def __call__(self,pid,flavor,arg,buffer,size):
            assert pid == 123 and flavor == 3 and size == 136
            if mode in ('denied','esrch','zero-errno'):
                ctypes.set_errno({'denied':errno.EACCES,'esrch':errno.ESRCH,'zero-errno':0}[mode]); return 0
            info = m.BSDInfo(); info.pbi_pid=123;info.pbi_uid=501;info.pbi_status=2
            info.pbi_start_tvsec=1000; info.pbi_start_tvusec=42
            if mode == 'wrong-pid': info.pbi_pid=124
            if mode == 'bad-usec': info.pbi_start_tvusec=1000000
            ctypes.memmove(buffer, ctypes.byref(info), size)
            return size-1 if mode == 'short' else size
    class Library: proc_pidinfo=Fn()
    # 陈旧errno不得把本次0/unknown误当ESRCH。
    ctypes.set_errno(errno.ESRCH)
    run=lambda:m.kernel_snapshot(123,loader=lambda *a,**kw:Library())
    if mode=='esrch': assert run() is None
    elif mode=='valid': assert run()=={'pid':123,'uid':501,'status':2,'start':[1000,42]}
    else: reject(run)

def synthetic(mode):
    m = load('adb-process-observation')
    live={'pid':123,'uid':501,'status':2,'start':[1000,42]}
    expected={'pid':123,'uid':501,'lstart':'same second','kernel_start':[1000,42],
              'executable':'/valid/python','argv_sha256':'irrelevant'}
    final={**live,'status':5} if mode in ('zombie','new-zombie','unbound-zombie') else live.copy()
    if mode in ('reuse','new-zombie'): final['start']=[1000,43]
    if mode=='gone': final=None
    snapshots=iter([live,final,final,final])
    def command(args,**kwargs):
        key=args[-1];value={'uid=':'501','lstart=':'same second','args=':'python fixture'}[key]
        return subprocess.CompletedProcess(args,0,value+'\n','')
    def unreadable(pid): raise ValueError('ADB_MAINTENANCE_PROCESS_EXECUTABLE_UNAVAILABLE')
    run=lambda:m.observe(123,command,unreadable,expected=None if mode=='unbound-zombie' else expected,
                         kernel_reader=lambda pid:next(snapshots))
    if mode in ('gone','zombie'): assert run() is None
    else: reject(run)

def manifest(mode):
    m=load('adb-host-maintenance')
    with tempfile.TemporaryDirectory() as tmp:
        root=Path(tmp); rows=[]
        for name in m.REQUIRED_FILES:
            if name=='adb-process-observation.py' and mode=='missing': continue
            (root/name).write_bytes((ROOT/name).read_bytes())
            rows.append({'path':'services/phone-adb-controller/'+name,'deployed_path':name,
                         'content_sha256':hashlib.sha256((root/name).read_bytes()).hexdigest()})
        target=root/'adb-process-observation.py'
        if mode=='hash': target.write_text('modified')
        if mode=='symlink':
            target.rename(root/'elsewhere');target.symlink_to(root/'elsewhere')
        if mode=='path':
            for row in rows:
                if row['deployed_path']==target.name:row['deployed_path']='../'+target.name
        path=root/'manifest.json';path.write_text(json.dumps({'source_repo':m.REPO,'source_commit':'a'*40,'files':rows}))
        reject(lambda:m.verify_manifest(path,root))

def native_kernel():
    m=load('adb-process-observation')
    child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(5)'])
    try:
        value=m.kernel_snapshot(child.pid)
        assert value['pid']==child.pid and value['uid']==os.geteuid() and value['status']!=5
        assert abs(value['start'][0]-time.time())<5 and 0<=value['start'][1]<1000000
    finally:
        if child.poll() is None: child.kill()
        child.wait(timeout=2)

case=sys.argv[1]
if case=='service': service()
elif case.startswith('native:'): native(case.split(':')[1])
elif case.startswith('kernel:'): kernel(case.split(':')[1])
elif case.startswith('synthetic:'): synthetic(case.split(':')[1])
elif case=='native-kernel': native_kernel()
elif case.startswith('manifest:'): manifest(case.split(':')[1])
else: raise AssertionError(case)
