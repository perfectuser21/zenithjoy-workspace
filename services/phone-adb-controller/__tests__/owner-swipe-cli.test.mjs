import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {phoneLockFixtureEnv} from './helpers/phone-lock-fixture.mjs';
import {fixtureAdb} from './adb-existing-route.test.mjs';

const controller=fileURLToPath(new URL('../douyin-phone-adb',import.meta.url));
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'owner-swipe-cli-')),root=join(dir,'phone'),lock=join(root,'locks','SER1.lock');
 mkdirSync(lock,{recursive:true});
 const registry=join(dir,'profiles.tsv'),log=join(dir,'adb.jsonl'),adb=join(dir,'adb'),python=join(dir,'python');
 writeFileSync(registry,'private-profile\tSER1\tfixture\t1080\t1920\n');
 writeFileSync(join(lock,'owner'),'pdd-r21c-owner\n');
 writeFileSync(join(lock,'acquired_at'),String(Math.floor(Date.now()/1000))+'\n');
 writeFileSync(adb,`#!/usr/bin/python3
import os,sys,json,time
with open(os.environ['SWIPE_ADB_LOG'],'a') as f:f.write(json.dumps(sys.argv[1:])+'\\n')
if sys.argv[-1:] == ['get-state']:print('device')
if 'swipe' in sys.argv:time.sleep(float(os.environ.get('SWIPE_FAKE_DELAY','0')))
`,{mode:0o755});
 const fake=fixtureAdb(adb),port=Number(process.env.ADB_SERVER_SOCKET.split(':').at(-1));
 // Run the actual Python entrypoints, but make all real host ADB sockets unreachable.
 writeFileSync(python,`#!/usr/bin/python3
import sys,socket,runpy
original=socket.create_connection
def isolated(address,*a,**kw):
 if address != ('127.0.0.1',${port}):raise ConnectionRefusedError('isolated fixture')
 return original(address,*a,**kw)
socket.create_connection=isolated
script=sys.argv.pop(1)
runpy.run_path(script,run_name='__main__')
`,{mode:0o755});
 const env={...process.env,...phoneLockFixtureEnv(registry,root),HOME:dir,DOUYIN_PYTHON_BIN:python,DOUYIN_ADB_BIN:fake,SWIPE_ADB_LOG:log};
 for(const key of ['DOUYIN_LOCK_ROOT','DOUYIN_PHONE_LOCK_ROOT','DOUYIN_LOCK_GUARDED','DOUYIN_LOCK_GUARD_FD','ZJ_ADB_HOST_CONFIG','DOUYIN_DETAIL_PLAYBACK','WFR_NATIVE_UNKNOWN_FILE','DOUYIN_GUARDED_COMMAND_TIMEOUT_SECONDS'])delete env[key];
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const argv=['--profile','private-profile','--lock-owner','pdd-r21c-owner','swipe','900','700','200','700','350'];
 return {dir,lock,env,argv,call:(args=argv,extra={})=>spawnSync('zsh',[controller,...args],{env:{...env,...extra},encoding:'utf8',timeout:10000}),calls:()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').map(JSON.parse):[]};
}
test('实际owner swipe CLI在真实helper guard内恰好输入一次且保留原锁',t=>{
 const f=fixture(t),r=f.call();assert.equal(r.status,0,r.stderr);
 assert.deepEqual(f.calls().filter(a=>a.includes('swipe')),[['-s','SER1','shell','input','swipe','900','700','200','700','350']]);
 assert.equal(readFileSync(join(f.lock,'owner'),'utf8'),'pdd-r21c-owner\n');
});

for (const condition of ['wrong-owner','missing-lock','expired','lease-budget']) {
 test(`owner swipe ${condition}拒绝，假ADB完全未调用`,t=>{
  const f=fixture(t);
  if(condition==='wrong-owner')writeFileSync(join(f.lock,'owner'),'other-run\n');
  if(condition==='missing-lock')rmSync(f.lock,{recursive:true});
  if(['expired','lease-budget'].includes(condition))writeFileSync(join(f.lock,'acquired_at'),String(Math.floor(Date.now()/1000)-(condition==='expired'?1801:801))+'\n');
  const r=f.call();assert.notEqual(r.status,0);assert.deepEqual(f.calls(),[]);
  assert.match(r.stderr,condition==='wrong-owner'||condition==='missing-lock'?/owner.*(match|preservation)|No such file/:/lock lease budget is insufficient/);
  if(condition!=='missing-lock')assert.equal(readFileSync(join(f.lock,'owner'),'utf8'),condition==='wrong-owner'?'other-run\n':'pdd-r21c-owner\n');
 });
}
test('无owner swipe保留已有语义',t=>{
 const f=fixture(t),r=f.call(f.argv.filter((_,i)=>i!==2&&i!==3));assert.equal(r.status,0,r.stderr);
 assert.equal(f.calls().filter(a=>a.includes('swipe')).length,1);
});
function asyncCall(f,extra={}) {
 const child=spawn('zsh',[controller,...f.argv],{env:{...f.env,...extra}});let stderr='';
 child.stderr.on('data',b=>stderr+=b);
 const ended=new Promise(resolve=>child.on('close',status=>resolve({status,stderr})));
 return {child,ended};
}
async function waitInput(f) {
 const deadline=Date.now()+4000;
 while(!f.calls().some(a=>a.includes('swipe'))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
 assert.equal(f.calls().filter(a=>a.includes('swipe')).length,1,'首个swipe必须已经进入假ADB');
}
test('owner swipe持真实flock覆盖ADB执行，第二条CLI争用不得输入',async t=>{
 const f=fixture(t),first=asyncCall(f,{SWIPE_FAKE_DELAY:'1.5'});t.after(()=>first.child.kill());
 await waitInput(f);
 const second=f.call();assert.equal(second.status,2);assert.match(second.stderr,/lock operation busy/);
 assert.equal(f.calls().filter(a=>a.includes('swipe')).length,1);
 const done=await first.ended;assert.equal(done.status,0,done.stderr);
 assert.equal(readFileSync(join(f.lock,'owner'),'utf8'),'pdd-r21c-owner\n');
});
test('owner swipe超时走真实helper未知协议，保owner且不重试输入',t=>{
 const f=fixture(t),unknown=join(f.dir,'native-unknown');
 const r=f.call(f.argv,{SWIPE_FAKE_DELAY:'4',DOUYIN_GUARDED_COMMAND_TIMEOUT_SECONDS:'1',WFR_NATIVE_UNKNOWN_FILE:unknown});
 assert.equal(r.status,124,r.stderr);assert.match(r.stderr,/NATIVE_INNER_EXECUTION_TERMINATION_UNKNOWN/);
 assert.match(readFileSync(unknown,'utf8'),/guard_canceled_or_timeout/);
 assert.equal(readFileSync(join(f.lock,'owner'),'utf8'),'pdd-r21c-owner\n');
 assert.equal(f.calls().filter(a=>a.includes('swipe')).length,1);
 const free=spawnSync('/usr/bin/python3',['-c','import fcntl,sys;f=open(sys.argv[1],"r+");fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)',join(f.dir,'phone','locks','SER1.guard')]);
 assert.equal(free.status,0,'helper必须终止命令组后才释放guard');
});

test('归一后同run的变体仍不能冒认精确owner执行swipe',t=>{
 const f=fixture(t);writeFileSync(join(f.lock,'owner'),'pdd-r21c-owner-w1\n');
 const r=f.call();assert.notEqual(r.status,0);assert.match(r.stderr,/owner.*(match|preservation)/);assert.deepEqual(f.calls(),[]);
});
