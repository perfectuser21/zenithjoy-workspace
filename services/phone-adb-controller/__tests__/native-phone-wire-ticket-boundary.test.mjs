// Draft target for the real Runtime-issued local ticket. No fake ticket issuer,
// permission bool, or worker status is provided. Baseline ca457 is expected RED.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
import {Socket} from 'node:net';
import {usingNativeRuntimeAdmissionBoundary} from './fixtures/native-phone-runtime-admission-boundary.mjs';
test('wire-ticket draft actual factory command and RECV each need four fresh B reads',async t=>{
 const result=await usingNativeRuntimeAdmissionBoundary(t,async f=>{
  const current=f.preflightRuntime.current();let start=f.claimCount();assert.match(await current.phone('foreground'),/com\.ss\.android\.ugc\.aweme/);const command=f.claimCount()-start;
  start=f.claimCount();const xml=(await current.phone('ui-evidence',f.q.run_tag+'-ticket-draft-count')).trim(),combined=f.claimCount()-start;assert.match(readFileSync(xml,'utf8'),/<hierarchy/);f.observations.push({command,read:combined-command,combined});
 });
 assert.equal(result.preflight.execution_stopped,true);assert.equal(result.cleanup.execution_stopped,true);assert.equal(result.state.execution_unknown,false);assert.equal(result.lockHeld,null);assert.deepEqual(result.observations,[{command:4,read:4,combined:8}]);
});
test('wire-ticket before-entry Task loss creates no new ADB observer or socket intent',async t=>{
 let after=[],beforeDirs,afterDirs;
 const result=await usingNativeRuntimeAdmissionBoundary(t,async f=>{
  const root=join(f.env.WFR_RUN_DIR,'native-phone/preflight'),names=()=>readdirSync(root).filter(n=>n.startsWith('command-'));beforeDirs=names();const start=f.adb.requests.length,beforeB=f.claimCount(),path='/api/brain/tasks/'+f.q.task_id,remoteTask=structuredClone(f.routes.get(path));remoteTask.status='paused';f.routes.set(path,remoteTask);assert.equal(f.definition.task.status,'in_progress','central guard view remains stale-good so the genuine Caller B entry check must reject');let rejection;await assert.rejects(()=>f.preflightRuntime.current().phone('foreground'),error=>{rejection=error.message;return true;});after=f.adb.requests.slice(start);afterDirs=names();assert.deepEqual(afterDirs,beforeDirs);assert.deepEqual(after,[]);f.observations.push({case:'before-entry-Task-rejected',rejection,new_native_observers:afterDirs.length-beforeDirs.length,new_ADB_services:after.length,actual_B_reads:f.claimCount()-beforeB});assert.ok(f.claimCount()>beforeB,'must reach the actual native Caller B check');
 });
 assert.notEqual(result.preflight?.status,'completed');assert.ok(result.lockHeld);assert.equal(result.cleanup,undefined);assert.deepEqual(afterDirs,beforeDirs);assert.deepEqual(after,[]);
});

// Only the real loopback transport's received service boundary changes the external
// authority or copied Source. No worker status or capability is manufactured.
for(const mode of ['ack-task','ack-central-owner','ack-local-owner','ack-source','features-source','features-local-owner','final-task','fresh-command'])test('wire-ticket actual factory '+mode+' rejects changed authority without a result',async t=>{
 let seen=false,after=[],value;
 const result=await usingNativeRuntimeAdmissionBoundary(t,async f=>{
  const current=f.preflightRuntime.current(),requests=f.adb.requests,original=requests.push;
  const taskPath='/api/brain/tasks/'+f.q.task_id,oldTask=f.routes.get(taskPath),sourcePath=f.runtimeRoot+'/native-phone-runtime.mjs',sourceBytes=readFileSync(sourcePath),ownerPath=f.lockRoot+'/'+f.q.serial+'.lock/owner',ownerBytes=readFileSync(ownerPath),oldLock=f.lockHeld();
  const revokeTask=()=>{const remote=structuredClone(oldTask);remote.status='paused';f.routes.set(taskPath,remote);assert.equal(f.definition.task.status,'in_progress');f.remoteState.assertFrozenUnchanged();};
  if(mode==='fresh-command'){assert.match(await current.phone('foreground'),/com\.ss\.android\.ugc\.aweme/);revokeTask();seen=true;}
  const start=requests.length,beforeB=f.claimCount(),outbound=[];let writeSpy,endSpy;if(mode.startsWith('features-')){const port=Number(f.adb.endpoint.split(':').at(-1));for(const method of ['write','end']){const prior=Socket.prototype[method],spy=t.mock.method(Socket.prototype,method,function(...args){if(this.remotePort===port&&seen&&(typeof args[0]==='string'||Buffer.isBuffer(args[0]))&&Buffer.byteLength(args[0])>0)outbound.push({method,bytes:Buffer.byteLength(args[0])});return prior.apply(this,args);});if(method==='write')writeSpy=spy;else endSpy=spy;}}
  requests.push=function(...rows){for(const row of rows){const trigger=mode.startsWith('features-')?row==='host-serial:'+f.q.serial+':features':mode==='final-task'?typeof row==='string'&&row.startsWith('shell,v2,raw:'):row==='host:transport:'+f.q.serial;if(trigger&&!seen){seen=true;if(mode.endsWith('-source'))writeFileSync(sourcePath,Buffer.concat([sourceBytes,Buffer.from('\n// explicit synthetic Source drift\n')]));else if(mode.endsWith('-local-owner'))writeFileSync(ownerPath,'foreign-owner\n');else if(mode==='ack-central-owner')f.centralHooks.replaceLock('foreign-central-owner');else revokeTask();}}return original.apply(this,rows);};
  try{await assert.rejects(async()=>{value=await current.phone('foreground');});}finally{writeSpy?.mock.restore();endSpy?.mock.restore();requests.push=original;after=requests.slice(start);writeFileSync(sourcePath,sourceBytes);writeFileSync(ownerPath,ownerBytes);if(mode!=='fresh-command')f.routes.set(taskPath,oldTask);f.centralHooks.replaceLock(oldLock);}
  assert.equal(seen,true);assert.equal(value,undefined);assert.ok(f.claimCount()>beforeB,'real authority projection must be consumed');
  const shells=after.filter(r=>typeof r==='string'&&r.startsWith('shell,v2,raw:')).length;
  assert.equal(shells,mode==='final-task'?1:0);if(mode.startsWith('features-')){assert.equal(after.length,1,'no later transport request after actual feature response boundary drift');assert.deepEqual(outbound,[],'actual client Socket write/end sends no payload bytes after drift');}if(mode==='fresh-command')assert.deepEqual(after,[]);
  f.observations.push({case:mode,physical_shells:shells,new_services:after.length,actual_B_reads:f.claimCount()-beforeB,...(mode.startsWith('features-')?{post_drift_client_payload_writes:outbound}:{} )});
 });
 assert.ok(result.lockHeld);assert.equal(result.cleanup,undefined);
 if(mode!=='fresh-command')assert.equal(result.state.execution_unknown,true,'an already admitted transport must stay unknown after authority/result rejection');
});
