import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url).pathname;
const setup=`import os,sys,json,pathlib,subprocess,types,tempfile,signal,hashlib,shutil,socket,time\nROOT=pathlib.Path(${JSON.stringify(root)})\np=ROOT/'adb-private-supervisor.py';m=types.ModuleType('private_supervisor');m.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),m.__dict__)\ndef rejected(fn):\n try:fn()\n except (ValueError,RuntimeError,OSError):pass\n else:raise AssertionError('expected closed failure')\n`;
function py(body){const r=spawnSync('python3',['-I','-c',setup+body],{encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr||r.stdout);}
test('真实held进程核UID微秒出生/真实exe和argv，PID复用身份不能冒充终态',()=>py(`child=subprocess.Popen(['/bin/sleep','30'])
try:
 row=m.process_identity(child.pid);assert row['pid']==child.pid and row['uid']==os.geteuid() and row['ppid']==os.getpid();assert len(row['kernel_start'])==2 and all(type(v) is int for v in row['kernel_start']);assert len(row['executable_sha256'])==64 and len(row['argv_sha256'])==64
 rejected(lambda:m.process_identity(child.pid,{**row,'kernel_start':[row['kernel_start'][0],row['kernel_start'][1]+1]}));assert m.identity_terminal(row) is False
 child.terminate();child.wait(timeout=2);assert m.identity_terminal(row) is True
finally:
 if child.poll() is None:child.kill();child.wait()
`));
