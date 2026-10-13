import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const source=resolve('services/phone-adb-controller/commander/wf-v2.py');
function scenario(code){
 const prolog=`import importlib.util,pathlib,tempfile,time,json,shlex,subprocess
from datetime import datetime,timezone
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('runtime',${JSON.stringify(source)})
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
d=pathlib.Path(tempfile.mkdtemp(prefix='phone-no-resource-')).resolve();(d/'evidence').mkdir()
e={'protocol':'commander-v2','run_id':'wfd-offline','task_id':'1234abcd-0000-4000-8000-000000000001','attempt':1,'owner_epoch':1,'input':{},'input_sha256':r.io.digest({}),'definition':{'expected_path':[]},'contract':{'resources':{'machine':'xian-m4','profile':'xiaolongxia','device_serial':'ANGYVB4311010223','account_ref':'Ai办公室'}},'deadline_at':datetime.fromtimestamp(time.time()+600,timezone.utc).isoformat(),'cleanup_deadline_at':datetime.fromtimestamp(time.time()+660,timezone.utc).isoformat()}
e['activity_bindings']=[]
for key in ['preflight','cleanup']:
 path={'reference_id':key+'-ref','activity_id':key+'-activity','activity_definition_version_id':key+'-version'}
 e['definition']['expected_path'] += [path,dict(path,step_id=key+'-step')]
 e['activity_bindings'].append(dict(path,key=key,steps=[{'key':'evidence','step_id':key+'-step'}]))
r.io.write(d/'envelope.json',e);r.io.write(d/'events.json',[]);r.io.write(d/'runtime.json',{'phase':'preparing','parent':'agent:work-commander:test','execution_stopped':False})
r.io.replay=lambda directory:None
calls=[];owner='free';preflight='failed'
def transport(argv,**kwargs):
 global owner
 command=argv[-1];args=shlex.split(command.split('; ',1)[1]);op=args[3];calls.append(op)
 if op=='preflight':
  if preflight=='timeout':raise subprocess.TimeoutExpired(argv,25)
  return SimpleNamespace(returncode=1 if preflight=='failed' else 0,stdout=b'' if preflight=='failed' else b'serial=ANGYVB4311010223 state=device',stderr=b'phone-adb: target phone is offline after adb auto-refresh' if preflight=='failed' else b'')
 if op=='lock-status':return SimpleNamespace(returncode=0,stdout=('lock=free' if owner=='free' else 'lock=held owner='+owner).encode(),stderr=b'')
 if op=='lock-acquire':owner=e['run_id']
 if op=='lock-release':owner='free'
 return SimpleNamespace(returncode=0,stdout=b'controller receipt',stderr=b'')
r.phone_module.subprocess.run=transport
p=r.phone_module.Phone(d,e)
def fail_prepare():
 try:p.prepare();raise AssertionError('offline preparation unexpectedly succeeded')
 except ValueError:pass
`;
 const result=spawnSync('python3',['-c',prolog+code],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr+result.stdout);
}

test('离线预检未领锁：真实worker生成failed交付和no-resource清理，重入不重跑业务',()=>scenario(`
r.worker(d)
assert (d/'delivery.json').exists(),'preflight failed before acquire remains cleanup_pending instead of delivering failed'
delivery=r.io.read(d/'delivery.json');cleanup=delivery['cleanup']
assert delivery['status']=='failed' and cleanup['completed'] is True
assert cleanup['mode']=='no-resource' and cleanup['device_actions']=='none'
assert cleanup['evidence'] and all(pathlib.Path(x).exists() for x in cleanup['evidence'])
assert set(calls)=={'preflight','lock-status'},calls
assert not (d/'agent-request.json').exists() and not (d/'spawn-claimed.json').exists()
assert (d/'handoff-closed.json').exists()
facts=[x['data'] for x in r.io.read(d/'events.json') if x['type']=='activity_completed']
assert len(facts)==4 and all(x['outcome']=='fail' for x in facts if x['reference_id']=='preflight-ref')
assert all(x['outcome']=='pass' for x in facts if x['reference_id']=='cleanup-ref')
original=(d/'delivery.json').read_bytes();before=list(calls);r.worker(d)
assert calls==before and (d/'delivery.json').read_bytes()==original
`));

test('缺预检原件、旧状态或传输超时均不能推断未拿锁',()=>{
 for(const mode of ['absent','timeout'])scenario(`
if ${JSON.stringify(mode)}=='timeout':
 preflight='timeout'
 try:p.prepare()
 except subprocess.TimeoutExpired:pass
else:p.check_roots('preflight-start',establish=True)
assert p.cleanup()['completed'] is False
`);
});

test('发送领锁前持久intent；响应前crash后锁free也不得冒充无动作',()=>scenario(`
fail_prepare()
import os
before={str(x) for x in (d/'controller-receipts').rglob('*') if x.is_file()}
pid=os.fork()
if pid==0:
 def crash(argv,**kwargs):
  os._exit(73 if (d/'phone-action-intent.json').exists() else 74)
 r.phone_module.subprocess.run=crash
 p.ctl('lock-acquire',e['run_id'])
 os._exit(75)
_,status=os.waitpid(pid,0)
assert os.waitstatus_to_exitcode(status)==73,'acquire was sent before durable intent'
assert {str(x) for x in (d/'controller-receipts').rglob('*') if x.is_file()}==before,'hard exit must leave no new RPC receipt'
p=r.phone_module.Phone(d,e)
assert p.cleanup()['completed'] is False,'new process accepted unknown sent acquisition as no-resource'
`));

test('真实失败边界校验原件hash与run身份；错误证据不得no-resource',()=>{
 for(const mode of ['tamper','wrong-run','missing'])scenario(`
fail_prepare()
boundary=d/'preflight-no-resource.json'
assert boundary.exists(),'missing positive durable preflight failure boundary'
if ${JSON.stringify(mode)}=='wrong-run':
 value=r.io.read(boundary);value['run_id']='another-run';r.io.write(boundary,value)
else:
 source=next((d/'controller-receipts/preflight').glob('*.stderr'))
 if ${JSON.stringify(mode)}=='missing':source.unlink()
 else:source.write_text('changed')
assert p.cleanup()['completed'] is False
`);
});

test('他人owner或unknown不得无资源收尾，也不领锁或清理他人手机',()=>{
 for(const value of ['another-owner','unknown'])scenario(`
fail_prepare();owner=${JSON.stringify(value)};calls.clear()
receipt=p.cleanup();assert receipt['completed'] is False
assert 'lock-acquire' not in calls and '--lock-owner' not in calls
if owner=='another-owner':assert 'lock-release' not in calls
`);
});

test('已claim或绑定child禁止no-resource；launch锁保护检查及封闭',()=>{
 for(const name of ['spawn-claimed.json','agent-binding.json'])scenario(`
fail_prepare();r.io.write(d/${JSON.stringify(name)},{'run_id':e['run_id']})
assert p.cleanup()['completed'] is False
assert not (d/'handoff-closed.json').exists()
`);
 scenario(`
fail_prepare()
original=p.owner
def owner_readback():
 import fcntl
 with open(d/'.launch.lock','a') as guard:
  try:fcntl.flock(guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:pass
  else:raise AssertionError('spawn admission not held during free readback')
 return original()
p.owner=owner_readback
assert p.cleanup()['completed'] is True
assert (d/'handoff-closed.json').exists()
`);
});

test('根目录漂移不接受no-resource证据',()=>scenario(`
fail_prepare();old=d/'old-evidence';(d/'evidence').rename(old);(d/'evidence').mkdir()
assert p.cleanup()['completed'] is False
`));


test('worker失败收尾在launch锁内重查claim，不能把并发已领单的child当作停止',()=>scenario(`
from contextlib import contextmanager
original_lock=r.io.lock
@contextmanager
def race_lock(path,*args,**kwargs):
 with original_lock(path,*args,**kwargs):
  if path.name=='.launch.lock':r.io.write(d/'spawn-claimed.json',{'nonce':'concurrent-claim'})
  yield
r.io.lock=race_lock
r.worker(d)
assert not (d/'handoff-closed.json').exists(),'worker closed handoff after concurrent spawn claim'
assert not (d/'delivery.json').exists() and not (d/'cleanup.json').exists()
assert r.io.read(d/'runtime.json')['execution_stopped'] is False
`));
