import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';
import {usingNativeRuntimeAdmissionBoundary} from './fixtures/native-phone-runtime-admission-boundary.mjs';
test('actual public factory uses four fresh B checks per command and RECV retaining entry, dispatch and result admission',async t=>{
 const result=await usingNativeRuntimeAdmissionBoundary(t,async f=>{
  const current=f.preflightRuntime.current();assert.ok(current);
  let start=f.claimCount();const before=f.adb.requests.length,foreground=await current.phone('foreground');const command=f.claimCount()-start;assert.match(foreground,/com\.ss\.android\.ugc\.aweme/);assert.ok(f.adb.requests.length>before);
  start=f.claimCount();const xmlPath=(await current.phone('ui-evidence',f.q.run_tag+'-runtime-boundary')).trim(),both=f.claimCount()-start;assert.match(readFileSync(xmlPath,'utf8'),/<hierarchy/);f.observations.push({command,read:both-command,combined:both});
 });
 assert.equal(result.error,undefined);assert.equal(result.preflight.status,'completed');assert.equal(result.preflight.execution_stopped,true);assert.equal(result.cleanup.status,'completed');assert.equal(result.cleanup.execution_stopped,true);assert.equal(result.lockHeld,null);assert.equal(result.state.execution_unknown,false);assert.deepEqual(result.observations,[{command:4,read:4,combined:8}]);
});

for(const mode of ['shell-before-task','recv-before-task','shell-result-source','recv-result-owner'])test('actual factory '+mode+' refuses a fresh primitive/cap and preserves the owned phone',async t=>{
 let seen=false,after=[];
 const result=await usingNativeRuntimeAdmissionBoundary(t,async f=>{
  const requests=f.adb.requests,original=requests.push,begin=requests.length,task=f.definition.task;
  // This is the copied frozen runtime, never the checkout or production Source.
  const pinnedPath=f.runtimeRoot+'/native-phone-runtime.mjs',originalSource=readFileSync(pinnedPath),isRead=mode.startsWith('recv'),primitive=isRead?'ui-evidence':'foreground';
  requests.push=function(...rows){for(const row of rows){const trigger=mode==='shell-before-task'?row==='host:transport:'+f.q.serial:mode==='recv-before-task'?row==='sync:':mode==='shell-result-source'?typeof row==='string'&&row.includes('shell,v2,raw:')&&row.includes("'dumpsys'")===false&&row.includes('/system/bin/dumpsys'):row&&typeof row==='object'&&row.id==='RECV';
   if(trigger&&!seen){seen=true;if(mode.endsWith('source'))writeFileSync(pinnedPath,Buffer.concat([originalSource,Buffer.from('\n// synthetic drift before result acceptance\n')]));else if(mode.endsWith('owner'))task.claimed_by='foreign-owner';else task.status='paused';}}
   return original.apply(this,rows);};
  try{await assert.rejects(()=>f.preflightRuntime.current().phone(primitive,...(isRead?[f.q.run_tag+'-revoke-boundary']:[])));}finally{requests.push=original;writeFileSync(pinnedPath,originalSource);after=requests.slice(begin);}
  assert.equal(seen,true,'actual wire boundary reached');
 });
 assert.equal(seen,true);assert.equal(result.state.execution_unknown,true);assert.ok(result.lockHeld,'unknown scope cannot release the actual test-owned central lock');assert.equal(result.cleanup,undefined);
 if(mode==='shell-before-task')assert.equal(after.filter(r=>typeof r==='string'&&r.startsWith('shell,v2,raw:')).length,0);
 if(mode==='recv-before-task')assert.equal(after.filter(r=>r&&typeof r==='object'&&r.id==='RECV').length,0);
});

for(const mode of ['implementation-binding-revoked','local-owner-changed'])test('actual central guard '+mode+' after transport ACK cannot dispatch a new shell',async t=>{
 let armed=false,changed=false,shells=[];
 const result=await usingNativeRuntimeAdmissionBoundary(t,async f=>{
  const requests=f.adb.requests,original=requests.push,begin=requests.length,task=f.definition.task,live=f.routes.get('/api/brain/activities/a1/versions/av1').version,oldBindingStatus=live.payload.implementation_bindings[0].status;
  const ownerFile=f.lockRoot+'/'+f.q.serial+'.lock/owner',oldOwner=readFileSync(ownerFile);
  requests.push=function(...rows){for(const row of rows)if(row==='host:transport:'+f.q.serial)armed=true;return original.apply(this,rows);};
  f.centralHooks.beforeLocksRead=async()=>{if(armed&&!changed){changed=true;if(mode==='implementation-binding-revoked')live.payload.implementation_bindings[0].status='revoked';else writeFileSync(ownerFile,'foreign-test-owner\n');assert.equal(task.status,'in_progress');f.remoteState.assertFrozenUnchanged();}};
  try{await assert.rejects(()=>f.preflightRuntime.current().phone('foreground'));}finally{requests.push=original;f.centralHooks.beforeLocksRead=null;live.payload.implementation_bindings[0].status=oldBindingStatus;f.remoteState.assertFrozenUnchanged();writeFileSync(ownerFile,oldOwner);shells=requests.slice(begin).filter(r=>typeof r==='string'&&r.startsWith('shell,v2,raw:'));}
  assert.equal(armed,true);assert.equal(changed,true);
 });
 assert.equal(changed,true);if(mode==='implementation-binding-revoked')assert.ok(result.remoteReads.some(r=>r.role==='native_B'&&r.path==='/api/brain/activities/a1/versions/av1'&&r.bindings?.some(b=>b.status==='revoked')),'genuine B must fetch the changed remote binding');assert.equal(shells.length,0,'no physical shell may follow a guard-time binding revocation');assert.equal(result.state.execution_unknown,true);assert.ok(result.lockHeld);assert.equal(result.cleanup,undefined);
});
