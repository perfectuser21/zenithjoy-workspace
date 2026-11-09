import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import {join} from 'node:path';
const worker=fileURLToPath(new URL('./fixtures/private-session-native/outer-worker.mjs',import.meta.url));
const checker=fileURLToPath(new URL('./fixtures/private-session-native/checker.mjs',import.meta.url));
test('生产startPrivate的supervisor在真实外层进程组SIGTERM后保独立session和出生/argv',{timeout:450000},async t=>{
  const base=process.env.TEST_PRIVATE_SESSION_ARTIFACT_DIR||'/tmp/private-session-recovery-dev',artifacts=join(base,'session-'+Date.now()+'-'+process.pid);fs.mkdirSync(artifacts,{recursive:true,mode:0o700});console.error('native session artifact',artifacts);
  const child=spawn(process.execPath,[worker],{detached:true,env:process.env,stdio:['ignore','pipe','pipe']});let stderr='',realm,ready,groupSignalled=false;
  child.stderr.on('data',b=>stderr+=b);const exited=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  const lines=createInterface({input:child.stdout});
  const runCheck=action=>{const r=spawnSync(process.execPath,[checker,action,join(artifacts,'session-ready.json')],{encoding:'utf8',timeout:30000,env:process.env});assert.equal(r.status,0,r.stderr||r.stdout);return JSON.parse(r.stdout);};
  t.after(async()=>{
    if(!groupSignalled&&child.exitCode===null&&child.signalCode===null){process.kill(-child.pid,'SIGTERM');groupSignalled=true;}
    const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)process.kill(-child.pid,'SIGKILL');},5000);
    try{await exited;}finally{clearTimeout(timer);}
    fs.writeFileSync(join(artifacts,'worker.stderr'),stderr);
    if(ready){assert.equal(runCheck('cleanup').terminal,true);fs.rmSync(ready.root,{recursive:true,force:true});}
    else if(realm)throw Error('PRIVATE_SESSION_SETUP_INCOMPLETE '+realm.root+'\n'+stderr);
  });
  ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('PRIVATE_SESSION_READY_TIMEOUT\n'+stderr)),420000);lines.on('line',line=>{let value;try{value=JSON.parse(line);}catch{return;}if(value.event==='realm')realm=value;if(value.event==='ready'){clearTimeout(timer);resolve(value);}});child.once('close',()=>{clearTimeout(timer);reject(Error('PRIVATE_SESSION_WORKER_EXIT\n'+stderr));});});
  fs.writeFileSync(join(artifacts,'session-ready.json'),JSON.stringify(ready),{mode:0o600});
  assert.equal(ready.worker_pid,child.pid);assert.equal(ready.verifier_successes,2);assert.equal(ready.field_actions,0);
  assert.equal(ready.ready.actual.supervisor.ppid,child.pid,'startup must retain the real spawning parent');
  assert.deepEqual(ready.reserved.identity.kernel_start,ready.ready.actual.supervisor.kernel_start);
  const before=runCheck('observe');fs.writeFileSync(join(artifacts,'before.json'),JSON.stringify(before));
  assert.equal(before.supervisor_alive,true);
  process.kill(-child.pid,'SIGTERM');groupSignalled=true;assert.equal((await exited).signal,'SIGTERM');
  await new Promise(r=>setTimeout(r,150));
  const after=runCheck('observe');fs.writeFileSync(join(artifacts,'after.json'),JSON.stringify(after));
  assert.equal(after.supervisor_alive,true,'START_PRIVATE_SUPERVISOR_MUST_SURVIVE_OUTER_GROUP_SIGTERM');
  assert.equal(after.pgid,after.supervisor_pid);assert.equal(after.sid,after.supervisor_pid);
  assert.notEqual(after.pgid,child.pid);assert.notEqual(after.sid,child.pid);
  assert.equal(after.birth_preserved,true);assert.equal(after.argv_preserved,true);
});
