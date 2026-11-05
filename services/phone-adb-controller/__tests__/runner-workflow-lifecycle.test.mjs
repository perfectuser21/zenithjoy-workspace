import test from 'node:test';import assert from 'node:assert/strict';import * as workflow from '../leadgen-workflow.mjs';
const base={frozen:{execution_transport:'raw-model-v1'},activities:[{key:'scoring',budget:{max_duration_s:5}}],context:{execution_mode:'agent',workflow_key:'douyin_comment_scoring',run_id:'run',source_commit:'a'.repeat(40),task_id:'task',binding_id:'binding'},verify:async()=>({verified:true}),record:async()=>{}};
test('actual main rejects forged preparation closed flags and starts no Worker when Observer closure is unknown',async()=>{
 assert.equal(typeof workflow.runWorkflowWithCommander,'function');let workers=0,quarantines=0;
 const out=await workflow.runWorkflowWithCommander({...base,executeAgent:async()=>{workers++;return{status:'completed',execution_stopped:true,result:{}};},quarantine:async()=>{quarantines++;return{verified:true};},prepareCommander:async()=>{throw Object.assign(Error('UNAVAILABLE'),{execution_stopped:true,executionStopped:true});}});
 assert.equal(workers,0);assert.equal(quarantines,1);assert.equal(out.status,'needs_review');assert.equal(out.execution_stopped,false);assert.equal(out.commander_execution_unknown,true);
});
test('actual main consumes Observer close unknown without changing the independent Activity Judge verdict',async()=>{
 let workers=0,checks=0,quarantines=0;
 const out=await workflow.runWorkflowWithCommander({...base,verify:async()=>{checks++;return{verified:true};},executeAgent:async()=>{workers++;return{status:'completed',execution_stopped:true,result:{}};},quarantine:async()=>{quarantines++;return{verified:true};},prepareCommander:async()=>({commander:async()=>({action:'none'}),canDispatchWorker:()=>true,close:async()=>({execution_stopped:false,execution_unknown:true})})});
 assert.equal(workers,1);assert.equal(checks,1);assert.equal(out.results[0].verification.verified,true);assert.equal(out.results[0].status,'completed');assert.equal(out.status,'needs_review');assert.equal(out.execution_stopped,false);assert.equal(quarantines,1);
});
test('actual main checks Observer safety after wake before launching Worker',async()=>{
 let workers=0,safe=true;
 const out=await workflow.runWorkflowWithCommander({...base,executeAgent:async()=>{workers++;return{status:'completed',execution_stopped:true,result:{}};},quarantine:async()=>({verified:true}),prepareCommander:async()=>({commander:async()=>{safe=false;throw Error('MODEL_ACK_UNKNOWN');},canDispatchWorker:()=>safe,close:async()=>({execution_stopped:false,execution_unknown:true})})});
 assert.equal(workers,0);assert.equal(out.status,'needs_review');assert.equal(out.execution_stopped,false);
});
