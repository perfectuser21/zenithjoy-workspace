import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,copyFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
const observer=fileURLToPath(new URL('../qualification-maintenance-host.py',import.meta.url));
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'qualification-guard-')),root=join(dir,'phone'),locks=join(root,'locks'),lock=join(locks,'SER1.lock');mkdirSync(lock,{recursive:true});
 const reg=join(dir,'profiles.tsv');writeFileSync(reg,'p1\tSER1\tfixture\t1080\t1920\n');
 writeFileSync(join(lock,'owner'),'original-run\n');writeFileSync(join(lock,'standalone_review_required'),'original-run\n');writeFileSync(join(locks,'SER1.guard'),'');
 const env={...process.env,DOUYIN_PHONE_TMP_ROOT:root,DOUYIN_PHONE_REGISTRY:reg,DOUYIN_PYTHON_BIN:'/usr/bin/python3',DOUYIN_ADB_BIN:'/bin/false'};
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 return {dir,root,lock,env,guard:join(locks,'SER1.guard')};
}
async function holder(f,t,path=observer) {
 assert.ok(existsSync(observer),'缺少实际serial.guard持有器');
 const p=spawn('python3',['-B','-I',path],{env:f.env,stdio:['pipe','pipe','pipe']});let err='';p.stderr.on('data',x=>err+=x);
 const lines=createInterface({input:p.stdout})[Symbol.asyncIterator]();
 const receive=async()=>{const line=await lines.next();assert.ok(!line.done,err);return JSON.parse(line.value);};
 p.stdin.write(JSON.stringify({serial:'SER1',profile:'p1',owner:'original-run',deadline_seconds:20})+'\n');
 t.after(()=>{p.stdin.destroy();});const ready=await receive();assert.equal(ready.status,'guard_held');
 return {p,ready,receive,send:async op=>{p.stdin.write(JSON.stringify({op})+'\n');return receive();}};
}
test('guard握手绑定真实内核出生与源码，不能只有可复用PID',async t=>{
 const f=fixture(t),h=await holder(f,t);
 const r=spawnSync('python3',['-B','-I','-c','import importlib.util,json,sys; s=importlib.util.spec_from_file_location("p",sys.argv[1]); m=importlib.util.module_from_spec(s);s.loader.exec_module(m); print(json.dumps(m.kernel(int(sys.argv[2]))))',fileURLToPath(new URL('../qualification-maintenance-processes.py',import.meta.url)),String(h.p.pid)],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);const actual=JSON.parse(r.stdout);
 assert.equal(h.ready.start_identity,actual.start_identity);assert.equal(h.ready.uid,actual.uid);
 assert.match(h.ready.script_sha256,/^[a-f0-9]{64}$/);
 const {createHash}=await import('node:crypto');assert.equal(h.ready.script_sha256,createHash('sha256').update(readFileSync(observer)).digest('hex'));
});
test('同一guard真实继承给原controller，不重入死锁且不调用ADB',async t=>{
 const f=fixture(t),h=await holder(f,t);assert.equal((await h.send('status')).local_owner,'original_owner');
 const blocked=spawnSync('python3',['-B','-I','-c','import fcntl,sys;f=open(sys.argv[1],"r+");fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)',f.guard]);assert.notEqual(blocked.status,0);
 const release=await h.send('release_exact');assert.equal(release.status,'released');assert.ok(!existsSync(f.lock));
 assert.equal((await h.send('status')).local_owner,'free');
 const stillBlocked=spawnSync('python3',['-B','-I','-c','import fcntl,sys;f=open(sys.argv[1],"r+");fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)',f.guard]);assert.notEqual(stillBlocked.status,0,'释放local后epoch仍持guard');
});
test('真实owner漂移不得调用exact释放清掉新owner',async t=>{
 const f=fixture(t),h=await holder(f,t);writeFileSync(join(f.lock,'owner'),'new-owner\n');
 assert.equal((await h.send('release_exact')).status,'blocked');assert.equal(readFileSync(join(f.lock,'owner'),'utf8'),'new-owner\n');
});
test('协调者EOF/崩溃只释放互斥，保原quarantine与owner',async t=>{
 const f=fixture(t),h=await holder(f,t);const exited=new Promise(resolve=>h.p.once('exit',resolve));h.p.stdin.end();await exited;
 assert.equal(readFileSync(join(f.lock,'owner'),'utf8'),'original-run\n');assert.ok(existsSync(join(f.lock,'standalone_review_required')));
 const free=spawnSync('python3',['-B','-I','-c','import fcntl,sys;f=open(sys.argv[1],"r+");fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)',f.guard]);assert.equal(free.status,0);
});
test('争用中的guard不创建第二维护epoch也不改owner',async t=>{
 const f=fixture(t),h=await holder(f,t);
 const second=spawnSync('python3',['-B','-I',observer],{env:f.env,input:JSON.stringify({serial:'SER1',profile:'p1',owner:'original-run',deadline_seconds:1})+'\n',encoding:'utf8',timeout:3000});
 assert.notEqual(second.status,0);assert.equal(JSON.parse(second.stdout).status,'blocked');assert.equal(readFileSync(join(f.lock,'owner'),'utf8'),'original-run\n');
});
test('持guard只读设备opcode不能携带任意命令/另一个serial',()=>{
 const code=`import importlib.util,sys\ns=importlib.util.spec_from_file_location('host',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nassert hasattr(m,'read_device')\nclass Reader:\n @staticmethod\n def collect_device(serial):return {'serial':serial,'status':'observed'}\nm.load_local=lambda name:Reader\nassert m.read_device({'serial':'SER1'},{'op':'device'})['serial']=='SER1'\nfor r in [{'op':'device','serial':'OTHER'},{'op':'device','command':'input tap 1 2'}]:\n try:m.read_device({'serial':'SER1'},r)\n except ValueError:pass\n else:raise AssertionError('accepted')\n`;
 const r=spawnSync('python3',['-B','-I','-c',code,observer],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('原件opcode只读固定模块，scope不可换已持有serial/owner或注入命令',()=>{
 const code=`import importlib.util,sys,json\ns=importlib.util.spec_from_file_location('host',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nassert hasattr(m,'read_original')\nclass R: returncode=0;stdout='{"status":"observed"}'\ncalls=[]\ndef fake(argv,**kw):calls.append((argv,kw));return R()\nm.subprocess.run=fake\nscope={'serial':'SER1','run_tag':'tag','consumer_source':'353b910f11ce3852b2ef69c8ead5c37e97850b4a'}\nassert m.read_original({'serial':'SER1','owner':'tag'},{'op':'original','scope':scope})['status']=='observed'\nassert calls[0][0][0]=='/opt/homebrew/bin/node';assert json.loads(calls[0][1]['input'])==scope\nfor r in [{'op':'original','scope':dict(scope,serial='OTHER')},{'op':'original','scope':scope,'code':'bad'}]:\n try:m.read_original({'serial':'SER1','owner':'tag'},r)\n except ValueError:pass\n else:raise AssertionError('accepted')\nassert len(calls)==1\n`;
 const r=spawnSync('python3',['-B','-I','-c',code,observer],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('domain opcode只执行已安装本地固定literal，不接受请求code/伪guard出生',()=>{
 const code=`import importlib.util,sys,json,os,tempfile,pathlib,base64,hashlib\ns=importlib.util.spec_from_file_location('host',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nassert hasattr(m,'read_domain')\nwith tempfile.TemporaryDirectory() as tmp:\n m.HERE=pathlib.Path(tmp)/('a'*40)/'runtime';m.HERE.mkdir(parents=True)\n literal=b'def collect_domain(scope,context):\\n return {"status":"observed","collector_sha256":__collector_sha256__,"pid":context["guard_pid"]}\\n'\n (m.HERE/'qualification-maintenance-domain.mjs').write_text("export const DOMAIN_COLLECTOR_BASE64='"+base64.b64encode(literal).decode()+"';")\n epoch={'maintenance_task_id':'11111111-1111-4111-8111-111111111111','intent_id':'22222222-2222-4222-8222-222222222222','candidate_sha':'a'*40,'guard_pid':os.getpid(),'guard_start_identity':'123:4','guard_script_path':str(m.HERE/'qualification-maintenance-host.py'),'guard_script_sha256':'b'*64}\n identity={'pid':os.getpid(),'start_identity':'123:4','script_sha256':'b'*64}\n scope={'serial':'SER1','run_tag':'tag','uid':os.getuid()}\n request={'op':'domain','scope':scope,'epoch':epoch}\n result=m.read_domain({'serial':'SER1','owner':'tag'},request,identity)\n assert result['pid']==os.getpid();assert result['collector_sha256']==hashlib.sha256(literal).hexdigest()\n for r in [dict(request,code='arbitrary'),dict(request,epoch=dict(epoch,guard_pid=os.getpid()+1)),dict(request,scope=dict(scope,serial='OTHER'))]:\n  try:m.read_domain({'serial':'SER1','owner':'tag'},r,identity)\n  except ValueError:pass\n  else:raise AssertionError('accepted')\n`;
 const r=spawnSync('python3',['-B','-I','-c',code,observer],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('真实private fixture guard握手直接组epoch，固定literal正链不靠人工identity mock',async t=>{
 const f=fixture(t),sha='a'.repeat(40),root=join(f.dir,sha,'runtime');mkdirSync(root,{recursive:true});
 for(const name of ['qualification-maintenance-host.py','qualification-maintenance-processes.py','adb-process-observation.py'])copyFileSync(fileURLToPath(new URL('../'+name,import.meta.url)),join(root,name));
 const literal=Buffer.from('import os\ndef collect_domain(scope,context):\n return {"status":"observed","pid":os.getpid(),"collector_sha256":__collector_sha256__}\n');
 writeFileSync(join(root,'qualification-maintenance-domain.mjs'),"export const DOMAIN_COLLECTOR_BASE64='"+literal.toString('base64')+"';\n");
 const path=realpathSync(join(root,'qualification-maintenance-host.py')),h=await holder(f,t,path);
 const epoch={maintenance_task_id:'11111111-1111-4111-8111-111111111111',intent_id:'22222222-2222-4222-8222-222222222222',candidate_sha:sha,guard_pid:h.ready.pid,guard_start_identity:h.ready.start_identity,guard_script_path:path,guard_script_sha256:h.ready.script_sha256};
 h.p.stdin.write(JSON.stringify({op:'domain',scope:{serial:'SER1',run_tag:'original-run',uid:h.ready.uid},epoch})+'\n');
 const r=await h.receive();assert.equal(r.status,'observed');assert.equal(r.pid,h.p.pid);
 assert.equal((await h.send('status')).local_owner,'original_owner');
});
