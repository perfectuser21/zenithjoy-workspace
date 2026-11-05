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

for(const failure of ['record','runner','close','missing-close','quarantine'])test('actual main always closes and attempts isolation despite '+failure+' failure',async()=>{
 let closes=0,quarantines=0;
 const input={...base,activities:failure==='runner'?null:base.activities,executeAgent:async()=>({status:'completed',execution_stopped:true,result:{}}),
  record:async event=>{if(failure==='record'&&event.phase==='commander_domain_closed')throw Error('PRIVATE_RECORDER_FAILED');},
  quarantine:async()=>{quarantines++;if(failure==='quarantine')throw Error('PRIVATE_QUARANTINE_FAILED');return{verified:true};},
  prepareCommander:async()=>({commander:async()=>({action:'none'}),canDispatchWorker:()=>true,close:async()=>{closes++;if(failure==='close')throw Error('PRIVATE_CLOSE_FAILED');if(failure==='missing-close')return;return{execution_stopped:false,execution_unknown:true};}})};
 const running=workflow.runWorkflowWithCommander(input);
 if(['record','runner'].includes(failure))await assert.rejects(running);else{const actual=await running;assert.equal(actual.status,'needs_review');assert.equal(actual.execution_stopped,false);assert.equal(actual.commander_execution_unknown,true);if(failure==='quarantine')assert.equal(actual.resource_quarantine.verified,false);}
 assert.equal(closes,1);assert.equal(quarantines,1);
});


test('unknown preparation still attempts isolation when the unavailable record itself fails',async()=>{
 let workers=0,quarantines=0;
 await assert.rejects(workflow.runWorkflowWithCommander({...base,executeAgent:async()=>{workers++;},record:async()=>{throw Error('PREPARATION_RECORD_FAILED');},prepareCommander:async()=>{throw Object.assign(Error('NO_PROOF'),{executionStopped:true});},quarantine:async()=>{quarantines++;throw Error('QUARANTINE_FAILED');}}),error=>error.message==='PREPARATION_RECORD_FAILED'&&error.executionStopped===false&&error.commanderExecutionUnknown===true&&error.resourceQuarantine.verified===false);
 assert.equal(workers,0);assert.equal(quarantines,1);
});
