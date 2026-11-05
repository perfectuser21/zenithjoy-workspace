import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const api=await import('../control-acceptance-tools.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const control={protocol:'runner-control-acceptance/v1',activity_key:'scoring',allowed_intents:['inspect','finish']};
const input={workflow_key:'douyin_comment_scoring',task_id:'11111111-1111-4111-8111-111111111111',run_tag:'control_fixture',profile:'mmv-scoring',serial:'none',line:'yuesheng',source_run:null,limit:1,run_max_seconds:300,execution_transport:'raw-model-v1',max_turns:8};
const task=()=>({id:input.task_id,status:'in_progress',claimed_by:'headed-control-fixture',claimed_at:'2026-11-05T00:00:00.000Z',payload:{workflow_key:input.workflow_key,run_tag:input.run_tag,source_commit:'a'.repeat(40),profile:'mmv-scoring',company_line:'yuesheng',scope:{send:0,source_run:null,limit:1,score_limit:1,run_max_seconds:300,execution_transport:'raw-model-v1',max_turns:8,control_scope:structuredClone(control)}}});
test('inspection-only authority is derived solely from the current central Task scope and exact claim',()=>{
 assert.equal(typeof api.controlAcceptanceFromTask,'function','control acceptance needs an actual Task-derived authority boundary');
 assert.deepEqual(api.controlAcceptanceFromTask({task:task(),input,sourceCommit:'a'.repeat(40)}),{control_scope:control,control_claim:{claimed_by:'headed-control-fixture',claimed_at:'2026-11-05T00:00:00.000Z'}});
 const ordinary=task();delete ordinary.payload.scope.control_scope;
 assert.equal(api.controlAcceptanceFromTask({task:ordinary,input:{...input,profile:'normal-scoring'},sourceCommit:'a'.repeat(40)}),null);
 for(const mutate of [t=>{t.payload.control_scope=structuredClone(control);},t=>{t.result={control_scope:control};delete t.payload.scope.control_scope;},t=>{t.claimed_by=null;},t=>{t.claimed_at=null;},t=>{t.status='failed';},t=>{t.payload.source_commit='b'.repeat(40);},t=>{t.payload.scope.control_scope.allowed_intents=['finish','inspect'];},t=>{t.payload.scope.control_scope.extra=true;},t=>{t.payload.scope.max_turns=9;},t=>{t.payload.scope.send=1;},t=>{t.payload.device_serial='USB';}]){
  const value=task();mutate(value);assert.throws(()=>api.controlAcceptanceFromTask({task:value,input,sourceCommit:'a'.repeat(40)}),/CONTROL_ACCEPTANCE/);
 }
});

test('Code inspection-only handlers construct no phone, queue or PG primitive and refuse both operation surfaces',async t=>{
 assert.equal(typeof api.createControlAcceptanceHandlers,'function');
 const runDir=mkdtempSync(join(tmpdir(),'control-only-tools-'));t.after(()=>rmSync(runDir,{recursive:true,force:true}));
 const frozen={execution_mode:'agent',execution_transport:'raw-model-v1',max_turns:8,agent_input:input,control_scope:control,control_claim:{claimed_by:'headed-control-fixture',claimed_at:'2026-11-05T00:00:00.000Z'},deployment:{source_commit:'a'.repeat(40)},snapshot_sha256:'b'.repeat(64),workflow_version:{payload:{key:input.workflow_key}}};
 const binding={id:'22222222-2222-4222-8222-222222222222',task_id:input.task_id,run_id:'douyin_comment_scoring-control_fixture__a1'};
 const handlers=api.createControlAcceptanceHandlers({runDir,frozen,binding});assert.equal(api.isControlAcceptanceHandlers(handlers),true);assert.equal(handlers.agentSupportsNativeScope({key:'scoring'}),true);assert.equal(handlers.agentSupportsNativeScope({key:'mark_leads'}),false);
 const scope={...input,workflow:input.workflow_key,run:input.run_tag,activity:'scoring',run_id:binding.run_id,binding_id:binding.id,source_commit:'a'.repeat(40),snapshot_sha256:frozen.snapshot_sha256,agent_nonce:'c'.repeat(48)};
 const tools=await handlers.createAgentTools({key:'scoring'},scope);await tools.prepare();const context=await tools.inspect();
 assert.deepEqual(context.phone_capabilities,[]);assert.deepEqual(context.business_capabilities,[]);assert.deepEqual(context.allowed_intents,['inspect','finish']);
 await assert.rejects(tools.phone('status'),/CONTROL_ACCEPTANCE_OPERATION_FORBIDDEN/);await assert.rejects(tools.business('company_config',{}),/CONTROL_ACCEPTANCE_OPERATION_FORBIDDEN/);
 await assert.rejects(tools.settle({execution_stopped:true}),/CONTROL_ACCEPTANCE_MODEL_STOP_UNVERIFIED/);assert.equal(tools.getResult(),null);
 assert.deepEqual(await handlers.quarantineResources(),{verified:true,not_applicable:true,physical_actions:0,pg_connections:0});
 const unbound=api.createControlAcceptanceHandlers({runDir,frozen,binding:{...binding,task_id:null}});
 assert.ok(await unbound.createAgentTools({key:'scoring'},scope),'the original verified external ACK may normalize task_id to null; frozen input still binds the real Task');
});
