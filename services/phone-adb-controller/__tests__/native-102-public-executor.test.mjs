import test from 'node:test';import assert from 'node:assert/strict';
import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';
import {readFileSync} from 'node:fs';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {usingNative102Public} from './fixtures/native-102-public-fixture.mjs';
import {usingNative102PublicSource} from './fixtures/native-102-public-source-fixture.mjs';
test('102 public factory refuses an incomplete preflight definition without an outer executor',async t=>usingNative102Public(t,async f=>{
 assert.deepEqual(f.definition.activities.map(a=>a.key),['preflight','dedup','qualification','collection','cleanup']);
 assert.equal(f.definition.leaseRequests.filter(r=>r.method==='POST').length,1);
 assert.equal(typeof f.handlers.prepareNativePhone,'function','same public Code factory is required');
 await assert.rejects(f.handlers.prepareNativePhone(),/NATIVE_PHONE_UNSUPPORTED/);
 assert.equal(f.outerCalls(),0);
}));
test('102 public factory admits all five slots only from complete frozen Source and genuine Code preflight',async t=>usingNative102PublicSource(t,async f=>{
 const ackPath=join(f.env.WFR_RUN_DIR,'run-bindings/a1.ack.json'),ackBytes=readFileSync(ackPath,'utf8'),rawAck=JSON.parse(ackBytes).binding;assert.equal(Object.hasOwn(rawAck,'task_id'),false);assert.equal(Object.hasOwn(rawAck.payload,'task_id'),false);assert.equal(rawAck.task_run_id,null);assert.equal(f.definition.binding.task_id,null);assert.deepEqual(f.definition.bindingRequests,{posts:1,gets:1});
 const lease=await import(pathToFileURL(join(f.runtimeRoot,'native-task-lease.mjs'))),association={frozen:f.definition.frozen,binding:f.definition.binding,taskId:f.q.task_id,runDir:f.env.WFR_RUN_DIR,scope:f.definition.frozen.collection_phone_scope,host:f.env.WFR_HOSTKEY};assert.equal(lease.assertNativeTaskAssociation(association).kind,'verified_external_native_task_association');for(const patch of [{binding:{...association.binding,release_id:'foreign-release'}},{taskId:'33333333-3333-4333-8333-333333333333'},{scope:{...association.scope,serial:'foreign'}},{binding:{...association.binding,task_run_id:'33333333-3333-4333-8333-333333333333'}},{frozen:{...association.frozen,native_task_lease:null}}])assert.throws(()=>lease.assertNativeTaskAssociation({...association,...patch}));
 await f.handlers.prepareNativePhone();assert.equal(readFileSync(ackPath,'utf8'),ackBytes);assert.equal(f.adb.requests.length,0,'association does not authorize device IO');
 assert.equal(f.definition.frozen.sampling_input.comment_limit,5);
 const rows=await f.pg.readRows();assert.equal(rows.videos.length,1);assert.equal(rows.videos[0].video_id,f.seeded.video.videoId);assert.equal(rows.videos[0].harvest_batch,f.env.LEADGEN_SOURCE_RUN);assert.equal(rows.videos[0].process_status,'待判定');
 for(const activity of f.definition.activities)assert.equal(f.handlers.agentSupportsNativeScope(activity),true,'actual native readiness required for '+activity.key);
 assert.equal(f.outerCalls(),0);
}));
import {publicNative102Scenario} from './fixtures/native-102-public-scenario.mjs';
test('public 102 runs five original slots with genuine managed media, sampled PG, Commander and the production Judge',async t=>publicNative102Scenario(t));
test('102 public factory freezes the legal quota-one input across Task, lease, Caller request and Source',async t=>usingNative102PublicSource(t,async f=>{
 const {frozen,binding,task}=f.definition;assert.equal(f.env.LEADGEN_COMMENT_LIMIT,'1');assert.equal(f.q.comment_limit,1);assert.equal(frozen.agent_input.comment_limit,1);assert.equal(frozen.sampling_input.comment_limit,1);assert.equal(task.payload.scope.comment_limit,1);
 const definitions=await import(pathToFileURL(join(f.runtimeRoot,'runtime-definition.mjs')));assert.equal(frozen.native_task_lease.binding.scope_sha256,definitions.digest(frozen.agent_input));await f.handlers.prepareNativePhone();
 const wired=f.workflow.createWorkflowExecution({runDir:f.env.WFR_RUN_DIR,frozen,binding,env:f.env,handlers:f.handlers,taskId:f.q.task_id,activities:f.definition.activities,createOfficialControl:f.createControl,rpc:async()=>{throw Error('NO_RPC');}}),request=wired.executeAgent.prepareObserverRequest(f.definition.activities[0],{context:{task_id:f.q.task_id},deadline_ms:Date.now()+90000});assert.equal(request.comment_limit,1);assert.equal(request.runtime_snapshot_sha256,frozen.snapshot_sha256);assert.equal(f.adb.requests.length,0);assert.equal(f.definition.binding.task_id,null);assert.equal(Object.hasOwn(JSON.parse(f.definition.ackBytes).binding,'task_id'),false);
 const host=await import(pathToFileURL(join(f.runtimeRoot,'runtime-host.mjs')));assert.equal(host.assertRuntimeHost(frozen.release,frozen.deployment),'mmv');assert.throws(()=>host.assertRuntimeHost({...frozen.release,target:'xian-m4'},frozen.deployment),/实际机器/);assert.throws(()=>host.assertRuntimeHost(frozen.release,{...frozen.deployment,target:'xian-m4'}),/实际机器/);t.mock.method(os,'hostname',()=> 'github-foreign-native102-host');syncBuiltinESMExports();assert.throws(()=>host.assertRuntimeHost(frozen.release,frozen.deployment),/实际机器/);t.mock.method(os,'hostname',()=> 'r10-7');syncBuiltinESMExports();assert.equal(host.assertRuntimeHost(frozen.release,frozen.deployment),'mmv');assert.equal(f.adb.requests.length,0);
 },{commentLimit:1}));
