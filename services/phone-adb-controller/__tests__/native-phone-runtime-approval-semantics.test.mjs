import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {usingNative102PublicSource} from './fixtures/native-102-public-source-fixture.mjs';
import {usingNativeRuntimeAdmissionBoundary} from './fixtures/native-phone-runtime-admission-boundary.mjs';
test('legacy remote AV alias mutates frozen memory and triggers the actual frozen lease hash check with zero device IO',async t=>usingNative102PublicSource(t,async f=>{
 const remote=f.routes.get('/api/brain/activities/a1/versions/av1').version,local=f.definition.frozen.activities[0].version;assert.equal(remote,local,'this control reproduces the old fixture alias, not a real remote response');
 const file=join(f.env.WFR_RUN_DIR,'run-definition.json'),original=readFileSync(file),before=JSON.stringify(f.definition.frozen),old=remote.status,{assertFrozenNativeTaskLease}=await import(pathToFileURL(join(f.runtimeRoot,'native-task-lease.mjs')));
 assert.doesNotThrow(()=>assertFrozenNativeTaskLease(f.definition.frozen));remote.status='revoked';try{assert.notEqual(JSON.stringify(f.definition.frozen),before);assert.deepEqual(readFileSync(file),original);assert.throws(()=>assertFrozenNativeTaskLease(f.definition.frozen),/NATIVE_TASK_LEASE_FROZEN/);assert.equal(f.adb.requests.length,0);console.log(JSON.stringify({event:'legacy-alias-frozen-mask',same_reference:true,frozen_memory_changed:true,frozen_file_unchanged:true,error:'NATIVE_TASK_LEASE_FROZEN',device_IO:0}));}finally{if(old===undefined)delete remote.status;else remote.status=old;}
}));

test('isolated remote outer AV status alone is not an implemented approval predicate and one shell is actually accepted',async t=>{
 let armed=false,changed=false,shells=[],primitive;
 const result=await usingNativeRuntimeAdmissionBoundary(t,async f=>{
  const path='/api/brain/activities/a1/versions/av1',remote=f.routes.get(path).version,local=f.definition.frozen.activities[0].version;assert.notEqual(remote,local);assert.notEqual(remote.payload,local.payload);assert.deepEqual(remote,local);
  const requests=f.adb.requests,original=requests.push,begin=requests.length,task=f.definition.task;requests.push=function(...rows){if(rows.some(row=>row==='host:transport:'+f.q.serial))armed=true;return original.apply(this,rows);};
  f.centralHooks.beforeLocksRead=async()=>{if(armed&&!changed){changed=true;remote.status='revoked';f.remoteState.assertFrozenUnchanged();assert.equal(task.status,'in_progress');}};
  try{primitive=await f.preflightRuntime.current().phone('foreground');f.remoteState.assertFrozenUnchanged();}finally{requests.push=original;f.centralHooks.beforeLocksRead=null;shells=requests.slice(begin).filter(r=>typeof r==='string'&&r.startsWith('shell,v2,raw:'));}
  assert.equal(changed,true);f.observations.push({case:'outer-status-only-known-unchecked',physical_shells:shells.length,primitive_accepted:true,frozen_unchanged:true,Task_status:task.status});
 });
 assert.match(primitive,/com\.ss\.android\.ugc\.aweme/);assert.equal(shells.length,1);assert.ok(result.remoteReads.some(r=>r.role==='native_B'&&r.path==='/api/brain/activities/a1/versions/av1'&&r.outer_status==='revoked'&&r.bindings.some(b=>b.status==='verified')));assert.equal(result.preflight.status,'completed');assert.equal(result.cleanup.status,'completed');assert.equal(result.state.execution_unknown,false);assert.equal(result.lockHeld,null);
});
