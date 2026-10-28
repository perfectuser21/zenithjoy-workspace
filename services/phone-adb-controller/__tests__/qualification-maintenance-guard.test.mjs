import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
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
async function holder(f,t) {
 assert.ok(existsSync(observer),'缺少实际serial.guard持有器');
 const p=spawn('python3',['-B','-I',observer],{env:f.env,stdio:['pipe','pipe','pipe']});let err='';p.stderr.on('data',x=>err+=x);
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
