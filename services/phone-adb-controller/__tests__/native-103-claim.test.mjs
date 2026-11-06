import test from 'node:test';import assert from 'node:assert/strict';import * as definition from '../runtime-definition.mjs';
test('native_claim只来自真实GET同Task claim；不从不存在的GET lease或result补造租约',()=>{
 assert.equal(typeof definition.nativeClaimFromTask,'function','普通native域不能只看非空claimed_by');
 const input={task_id:'11111111-1111-4111-8111-111111111111',workflow_key:'douyin_comment_scoring',run_tag:'fixture103',profile:'mmv-scoring',serial:'none',line:'yuesheng',limit:1,source_run:'fixture102'};
 const task={id:input.task_id,status:'in_progress',claimed_by:'fixture-owner',claimed_at:'2026-11-06T00:00:00.000Z',payload:{workflow_key:input.workflow_key,run_tag:input.run_tag,profile:input.profile,company_line:input.line,source_commit:'a'.repeat(40),scope:{limit:input.limit,source_run:input.source_run}}};
 assert.deepEqual(definition.nativeClaimFromTask({task,input,sourceCommit:'a'.repeat(40)}),{claimed_by:task.claimed_by,claimed_at:task.claimed_at});
 for(const change of [{status:'failed'},{claimed_at:null},{claimed_by:''},{payload:{...task.payload,source_commit:'b'.repeat(40)}},{payload:{...task.payload,scope:{...task.payload.scope,limit:2}}}])assert.throws(()=>definition.nativeClaimFromTask({task:{...task,...change},input,sourceCommit:'a'.repeat(40)}),/NATIVE_CLAIM/);
});

test('new raw native freeze must bind the central explicit transport, turn cap and absolute run budget, never caller self-declaration',()=>{
 const input={task_id:'11111111-1111-4111-8111-111111111111',workflow_key:'douyin_comment_scoring',run_tag:'fixture103',profile:'mmv-scoring',serial:'none',line:'yuesheng',limit:2,source_run:null,execution_transport:'raw-model-v1',max_turns:8,run_max_seconds:300};
 const task={id:input.task_id,status:'in_progress',claimed_by:'fixture-owner',claimed_at:'2026-11-06T00:00:00.000Z',payload:{workflow_key:input.workflow_key,run_tag:input.run_tag,profile:input.profile,company_line:input.line,source_commit:'a'.repeat(40),scope:{limit:2,source_run:null,execution_transport:'raw-model-v1',max_turns:8,run_max_seconds:300}}};
 assert.ok(definition.nativeClaimFromTask({task,input,sourceCommit:'a'.repeat(40)}));for(const [key,value]of [['execution_transport','other'],['max_turns',64],['run_max_seconds',1800]]){const changed=structuredClone(task);changed.payload.scope[key]=value;assert.throws(()=>definition.nativeClaimFromTask({task:changed,input,sourceCommit:'a'.repeat(40)}),/NATIVE_CLAIM/);delete changed.payload.scope[key];assert.throws(()=>definition.nativeClaimFromTask({task:changed,input,sourceCommit:'a'.repeat(40)}),/NATIVE_CLAIM/);}const conflicting=structuredClone(task);conflicting.payload.max_turns=64;assert.throws(()=>definition.nativeClaimFromTask({task:conflicting,input,sourceCommit:'a'.repeat(40)}),/NATIVE_CLAIM/);
});
