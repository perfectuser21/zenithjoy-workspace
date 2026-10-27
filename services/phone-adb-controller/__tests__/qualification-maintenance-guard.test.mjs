import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
const observer=fileURLToPath(new URL('../qualification-maintenance-host.py',import.meta.url));
const ctl=fileURLToPath(new URL('../douyin-phone-adb',import.meta.url));
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'qualification-guard-')),root=join(dir,'phone'),locks=join(root,'locks'),lock=join(locks,'SER1.lock');mkdirSync(lock,{recursive:true});
 const reg=join(dir,'profiles.tsv');writeFileSync(reg,'p1\tSER1\tfixture\t1080\t1920\n');
 writeFileSync(join(lock,'owner'),'original-run\n');writeFileSync(join(lock,'standalone_review_required'),'original-run\n');writeFileSync(join(locks,'SER1.guard'),'');
 const env={...process.env,DOUYIN_PHONE_TMP_ROOT:root,DOUYIN_PHONE_REGISTRY:reg,DOUYIN_PYTHON_BIN:'/usr/bin/python3',DOUYIN_ADB_BIN:'/bin/false'};
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 return {dir,root,lock,env,guard:join(locks,'SER1.guard')};
async function holder(f,t) {
 assert.ok(existsSync(observer),'缺少实际serial.guard持有器');
 const p=spawn('python3',['-B','-I',observer],{env:f.env,stdio:['pipe','pipe','pipe']});let err='';p.stderr.on('data',x=>err+=x);
 const lines=createInterface({input:p.stdout})[Symbol.asyncIterator]();
 const receive=async()=>{const line=await lines.next();assert.ok(!line.done,err);return JSON.parse(line.value);};
 p.stdin.write(JSON.stringify({serial:'SER1',profile:'p1',owner:'original-run',deadline_seconds:20})+'\n');
 t.after(()=>{p.stdin.destroy();});assert.equal((await receive()).status,'guard_held');
 return {p,receive,send:async op=>{p.stdin.write(JSON.stringify({op})+'\n');return receive();}};
}
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
