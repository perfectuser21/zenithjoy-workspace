import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startPrimaryActivityBroker} from '../activity-skill-primary-broker.mjs';
import {createLeadgenAgentTools} from '../leadgen-agent-tools.mjs';

const module=await import('../activity-skill-parent-loop.mjs').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND')return {};
 throw error;
});
async function fixture(t,{turns,onEvent=async()=>({action:'none'}),maxTurns=4,result=null,stopKnown=false,runId,workerMs=8000}={}){
 const directory=mkdtempSync(join(tmpdir(),'raw-parent-loop-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const text='---\nname: fixture\nmetadata:\n  primary_execution: agent-v1\n  execution_transports: [raw-model-v1]\n---\nOnly this activity.';
 const request={protocol:'leadgen-activity-v1',mode:'execute',execution_transport:'raw-model-v1',max_turns:maxTurns,workflow_key:'douyin_video_discovery',run_id:'douyin_video_discovery-loop_fixture__a1',run_tag:'loop_fixture',profile:'fixture',serial:'FIXTURE12345',line:'yuesheng',source_run:null,limit:2,comment_limit:null,task_id:'11111111-1111-4111-8111-111111111111',binding_id:'22222222-2222-4222-8222-222222222222',activity_key:'preflight',nonce:'a'.repeat(48),source_commit:'b'.repeat(40),runtime_snapshot_sha256:'c'.repeat(64),deadline_ms:Date.now()+10000,worker_deadline_ms:Date.now()+workerMs,receipt_deadline_ms:Date.now()+9000,method:{text,sha256:createHash('sha256').update(text).digest('hex')},broker_request_path:join(directory,'broker-request.json')};
 const receipts=new WeakMap(),permits=new WeakMap(),stops=new WeakMap(),inputs=[],effects=[],stopRequests=[];
 let sealed=false,closed=false;const sealSnapshots=new WeakSet();
 const control={
  async request(q){
   assert.equal(q.request.nonce,request.nonce);
   if(q.kind==='official_agent_stop'){
    stopRequests.push(q.turn_index);if(!stopKnown)throw Error('NO_STOP_RECEIPT_IN_THIS_FIXTURE');
    const receipt=Object.freeze({});stops.set(receipt,q.turn_index);return receipt;
   }
   if(sealed)throw Error('OFFICIAL_PARENT_SEALED');
   assert.equal(q.kind,'official_agent_turn');assert.equal(q.turn.index,inputs.length);inputs.push(q.turn.input);
   const item=await turns(q.turn.index,q.turn.input);
   if(item.forged)return structuredClone(item.forged);
   const receipt=Object.freeze({display:'not an authority field'});
   receipts.set(receipt,{index:q.turn.index,facts:{status:'ok',text:typeof item==='string'?item:JSON.stringify(item),official_run_id:runId||'33333333-3333-4333-8333-'+String(q.turn.index+1).padStart(12,'0')}});
   return receipt;
  },
  verifyTurnReceipt(receipt,{request:q,index}){const row=receipts.get(receipt);if(!row||row.index!==index||q.nonce!==request.nonce)throw Error('OFFICIAL_TURN_UNVERIFIED');return structuredClone(row.facts);},
  authorizeIntent(receipt,{request:q,index,op,body}){this.verifyTurnReceipt(receipt,{request:q,index});const permit=Object.freeze({});permits.set(permit,{index,op,body:JSON.stringify(body),used:false});return permit;},
  consumeIntentPermit(permit,{index,op,body}){const row=permits.get(permit);if(!row||row.used||row.index!==index||row.op!==op||row.body!==JSON.stringify(body))return false;row.used=true;return true;},
  verifyStopReceipt(receipt,{index}){if(!stops.has(receipt)||stops.get(receipt)!==index)throw Error('OFFICIAL_STOP_UNVERIFIED');return {status:'aborted',official_run_id:'44444444-4444-4444-8444-444444444444'};},
  snapshot(){const value=Object.freeze({sealed,pending:0,execution_unknown:false,execution_stopped:closed});sealSnapshots.add(value);return value;},
  seal(){sealed=true;return this.snapshot();},
  async close(){closed=true;},
  verifySealedExecution(value){return sealSnapshots.has(value)&&sealed&&closed&&value.sealed&&value.execution_stopped;},
 };
 const broker=await startPrimaryActivityBroker({directory,request,inspect:async()=>({phone_capabilities:['account-current'],business_capabilities:['lookup'],pending_write_readbacks:[]}),phone:async command=>{effects.push(command);return {account:'observed'};},business:async(operation,input)=>{effects.push({operation,input});return {durable_id:'original-server-evidence'};},getActivityResult:()=>result,authorize:async()=>true,authorizeParentContext:async()=>true,onEvent,onAbort:async()=>({execution_stopped:true})});
 t.after(()=>broker.close());
 assert.equal(typeof module.runActivitySkillParentLoop,'function','the parent loop must execute restricted intents instead of expecting disabled embedded tools');
 return {directory,request,broker,control,inputs,effects,stopRequests,isControlSealed:()=>sealed,isControlClosed:()=>closed};
}

test('one real broker carries a Commander correction into the next model turn and only server evidence is returned',async t=>{
 const state=await fixture(t,{result:{durable_id:'original-server-evidence'},onEvent:async event=>event.operation==='phone'?{action:'steer',text:'Read the original account before lookup.'}:{action:'none'},turns:async(index,input)=>{
  if(index===0)return {type:'phone',command:'account-current',args:[]};
  if(index===1){assert.deepEqual(input.context.commander_guidance,['Read the original account before lookup.']);assert.equal(input.history[0].response.result.account,'observed');return {type:'business',operation:'lookup',input:{account:'observed'}};}
  return {type:'finish'};
 }});
 const out=await module.runActivitySkillParentLoop(state);
 assert.equal(out.reason,'agent_finished');assert.equal(out.official_execution_stopped,true);assert.equal(out.turn_count,3);
 assert.deepEqual(state.effects,['account-current',{operation:'lookup',input:{account:'observed'}}]);
 assert.deepEqual(out.activity_result,{durable_id:'original-server-evidence'});assert.equal(out.status,undefined);
 assert.equal(state.broker.getResult().sealed,true);
 const journal=JSON.parse(readFileSync(join(state.directory,'parent-loop','turn-1-tool.json')));
 assert.equal(journal.response.result.durable_id,'original-server-evidence');
});

test('finish text cannot smuggle a result or a pass verdict and malformed intent reaches the next bounded turn as feedback',async t=>{
 const state=await fixture(t,{turns:async index=>index===0?{type:'finish',result:{status:'completed',video_count:999}}:{type:'finish'}});
 const out=await module.runActivitySkillParentLoop(state);
 assert.deepEqual(state.effects,[]);assert.equal(out.activity_result,null);assert.equal(out.status,undefined);
 assert.equal(state.inputs[1].history[0].error,'PARENT_LOOP_INTENT_INVALID');assert.equal(out.turn_count,2);
});

test('JSON booleans cannot replace the opaque official receipt and no tool or second turn follows uncertainty',async t=>{
 const state=await fixture(t,{turns:async()=>({forged:{status:'ok',text:'{"type":"phone","command":"account-current","args":[]}',execution_stopped:true,provider:'openai',model:'gpt-6.1-sol'}})});
 const out=await module.runActivitySkillParentLoop(state);
 assert.equal(out.reason,'official_turn_unverified');assert.equal(out.official_execution_stopped,false);assert.equal(out.model_execution_unknown,true);
 assert.deepEqual(state.effects,[]);assert.equal(state.inputs.length,1);assert.equal(state.broker.getResult().sealed,true);
});

test('the original finite turn quota cannot be extended by a mutable caller object',async t=>{
 let state;
 state=await fixture(t,{maxTurns:1,turns:async()=>{state.request.max_turns=4;return {type:'inspect'};}});
 const out=await module.runActivitySkillParentLoop(state);
 assert.equal(out.reason,'turn_limit');assert.equal(out.turn_count,1);assert.equal(state.inputs.length,1);
});

test('legacy, recovery, 104 and undeclared transport requests never reach the model',async t=>{
 for(const change of [q=>delete q.execution_transport,q=>{q.execution_transport='official-child';},q=>{q.mode='repair';},q=>{q.mode='readback_only';},q=>{q.workflow_key='douyin_lead_outreach';},q=>{q.workflow_key='douyin_comment_collection';},q=>{q.max_turns=0;},q=>{q.max_turns=65;},q=>{delete q.max_turns;},q=>{q.transport_generation=1;},q=>{q.method.text=q.method.text.replace('  execution_transports: [raw-model-v1]\n','');}]){
  const state=await fixture(t,{turns:async()=>{throw Error('MODEL_MUST_NOT_START');}});change(state.request);
  await assert.rejects(module.runActivitySkillParentLoop(state),/PARENT_LOOP_REQUEST_INVALID/);
  assert.equal(state.inputs.length,0);assert.deepEqual(state.effects,[]);
 }
});

test('a duplicate official run ID cannot authorize the next tool and finalization revokes the official control epoch',async t=>{
 const state=await fixture(t,{runId:'33333333-3333-4333-8333-333333333333',turns:async index=>index===0?{type:'inspect'}:{type:'business',operation:'lookup',input:{}}});
 const out=await module.runActivitySkillParentLoop(state);
 assert.equal(out.reason,'official_turn_unverified');assert.equal(out.model_execution_unknown,true);assert.deepEqual(state.effects,[]);
 assert.equal(state.isControlSealed(),true);assert.deepEqual(state.stopRequests,[1]);
});

test('runner cancellation stops only the current registered turn and a late model reply cannot issue a tool',async t=>{
 let entered,release;
 const started=new Promise(resolve=>{entered=resolve;});
 const state=await fixture(t,{stopKnown:true,turns:async()=>{entered();return new Promise(resolve=>{release=resolve;});}});
 const controller=new AbortController(),pending=module.runActivitySkillParentLoop({...state,signal:controller.signal});
 await started;controller.abort();const out=await pending;
 assert.equal(out.official_execution_stopped,true);assert.equal(out.model_execution_unknown,true);assert.deepEqual(state.stopRequests,[0]);assert.deepEqual(state.effects,[]);
 release({type:'phone',command:'account-current',args:[]});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(state.effects,[]);assert.equal(state.inputs.length,1);assert.equal(state.isControlSealed(),true);
});

test('a raw model stop brand is private to the exact Code scope and never turns a JSON clone into authority',async t=>{
 const state=await fixture(t,{turns:async()=>({type:'finish'})});
 const q=state.request,scope={execution_transport:'raw-model-v1',max_turns:q.max_turns,agent_nonce:q.nonce,workflow:q.workflow_key,activity:q.activity_key,run:q.run_tag,profile:q.profile,serial:q.serial,line:q.line,source_run:q.source_run,limit:q.limit,comment_limit:q.comment_limit,task_id:q.task_id,binding_id:q.binding_id,run_id:q.run_id,source_commit:q.source_commit,snapshot_sha256:q.runtime_snapshot_sha256,deadline_ms:q.deadline_ms,worker_deadline_ms:q.worker_deadline_ms,receipt_deadline_ms:q.receipt_deadline_ms};
 const out=await module.runActivitySkillParentLoop({...state,scope});
 assert.equal(typeof module.rawModelScopeStopped,'function');
 assert.equal(module.rawModelScopeStopped(out.model_stop_proof,scope),true);
 assert.equal(module.rawModelScopeStopped(structuredClone(out.model_stop_proof),scope),false);
 assert.equal(module.rawModelScopeStopped({execution_stopped:true},scope),false);
 for(const key of ['agent_nonce','task_id','binding_id','run_id','source_commit'])assert.equal(module.rawModelScopeStopped(out.model_stop_proof,{...scope,[key]:'different'}),false);
});

test('server tools require the private raw model brand and still refuse native unknown after a model stopped',async t=>{
 const state=await fixture(t,{turns:async()=>({type:'finish'})}),q=state.request;
 q.run_id='douyin_video_discovery-loop_fixture__a1';
 // Create a fresh matching broker after updating the immutable run identity.
 await state.broker.close();
 const broker=await startPrimaryActivityBroker({directory:join(state.directory,'bound'),request:{...q,broker_request_path:join(state.directory,'bound','broker-request.json')},inspect:async()=>({}),phone:async()=>{throw Error('NO_PHONE');},business:async()=>{throw Error('NO_BUSINESS');},authorizeParentContext:async()=>true});
 t.after(()=>broker.close());
 const request={...q,broker_request_path:broker.requestPath},scope={execution_transport:'raw-model-v1',max_turns:q.max_turns,agent_nonce:q.nonce,workflow:q.workflow_key,activity:q.activity_key,run:'loop_fixture',task_id:q.task_id,binding_id:q.binding_id,run_id:q.run_id,source_commit:q.source_commit,snapshot_sha256:q.runtime_snapshot_sha256,profile:'fixture',serial:'FIXTURE12345',line:'yuesheng',source_run:null,limit:2,comment_limit:null,deadline_ms:q.deadline_ms,worker_deadline_ms:q.worker_deadline_ms,receipt_deadline_ms:q.receipt_deadline_ms};
 const out=await module.runActivitySkillParentLoop({...state,request,scope,broker});
 assert.equal(module.rawModelScopeStopped(out.model_stop_proof,scope),true);
 let settled=0,nativeUnknown=false;
 const tools=createLeadgenAgentTools({scope,runDir:state.directory,primitives:{assertResources:async()=>true,executionState:()=>({native_stop_unproven:nativeUnknown}),settle:async()=>{settled++;return {durable_id:'server-only'};}}});
 for(const proof of [{execution_stopped:true},{execution_stopped:true,raw_model_proof:structuredClone(out.model_stop_proof)}])await assert.rejects(tools.settle(proof),/TERMINATION/);
 assert.equal(settled,0);
 nativeUnknown=true;
 await assert.rejects(tools.settle({execution_stopped:true,raw_model_proof:out.model_stop_proof}),/TERMINATION/);
 assert.equal(settled,0);assert.equal(tools.getResult().execution_stopped,false);
 nativeUnknown=false;
 await tools.settle({execution_stopped:true,raw_model_proof:out.model_stop_proof});assert.deepEqual(tools.getResult(),{durable_id:'server-only'});assert.equal(settled,1);
});

test('a model turn for one frozen phone cannot mint a stopped capability for another profile',async t=>{
 const state=await fixture(t,{turns:async()=>({type:'finish'})}),q=state.request;
 const scope={execution_transport:'raw-model-v1',max_turns:q.max_turns,agent_nonce:q.nonce,workflow:q.workflow_key,activity:q.activity_key,task_id:q.task_id,binding_id:q.binding_id,run_id:q.run_id,source_commit:q.source_commit,snapshot_sha256:q.runtime_snapshot_sha256,deadline_ms:q.deadline_ms,worker_deadline_ms:q.worker_deadline_ms,receipt_deadline_ms:q.receipt_deadline_ms,run:q.run_tag,profile:'foreign',serial:q.serial,line:q.line,source_run:q.source_run,limit:q.limit,comment_limit:q.comment_limit};
 const out=await module.runActivitySkillParentLoop({...state,scope});assert.equal(out.model_stop_proof,null);assert.deepEqual(state.effects,[]);
});

test('official seal alone is not a model-domain stop until its owned request and journal resources close',async t=>{
 const state=await fixture(t,{turns:async()=>({type:'finish'})});
 const out=await module.runActivitySkillParentLoop(state);
 assert.equal(state.isControlClosed(),true);assert.equal(out.official_execution_stopped,true);
});

test('a cloned sealed snapshot cannot substitute for the official controller private closure proof',async t=>{
 const state=await fixture(t,{turns:async()=>({type:'finish'})}),original=state.control.snapshot.bind(state.control);
 state.control.snapshot=()=>structuredClone(original());
 const out=await module.runActivitySkillParentLoop(state);
 assert.equal(out.official_execution_stopped,false);assert.equal(out.model_execution_unknown,true);assert.equal(out.reason,'official_control_seal_failed');assert.equal(out.model_stop_proof,null);
});

test('a read-only continuation keeps the original turn index and rejects phone before any broker delivery',async t=>{
 const state=await fixture(t,{turns:async()=>({type:'phone',command:'account-current',args:[]})});
 const original=state.control.request.bind(state.control);let index;
 state.control.request=async q=>{index=q.turn.index;const receipt=await original({...q,turn:{...q.turn,index:0}});return receipt;};
 const verify=state.control.verifyTurnReceipt.bind(state.control);state.control.verifyTurnReceipt=(receipt,opts)=>verify(receipt,{...opts,index:0});
 const actual=await module.runActivitySkillParentLoop({...state,startIndex:2,readOnlyContinuation:true});
 assert.equal(index,2);assert.equal(actual.reason,'read_only_intent_rejected');assert.equal(actual.turn_count,1);assert.deepEqual(state.effects,[]);
});

test('a Code Observer safety guard stops the next raw turn after an inspect exchange without claiming the stopped worker model is unknown',async t=>{
 let safe=true;
 const state=await fixture(t,{turns:async()=>({type:'inspect',progress:'Read original evidence.'}),onEvent:async()=>{safe=false;return{action:'none'};}});
 const out=await module.runActivitySkillParentLoop({...state,beforeTurn:()=>safe});
 assert.equal(state.inputs.length,1);assert.equal(out.official_execution_stopped,true);assert.equal(out.model_execution_unknown,false);assert.equal(out.turn_count,1);assert.equal(out.reason,'parent_loop_failed');assert.deepEqual(state.effects,[]);
});

test('owned pending stall must drain and apply guidance BEFORE the next real broker context is read',async t=>{
 let calls=0;
 const state=await fixture(t,{turns:async(index,input)=>{
  if(index===0)return {type:'inspect',progress:'Read original evidence.'};
  if(index===1)return {type:'inspect',question:'Which evidence should I inspect next?'};
  assert.ok(input.context.commander_guidance?.includes('Inspect the original fixed evidence next.'));return {type:'finish'};
 },onEvent:async event=>event.type==='stall'?(await new Promise(r=>setTimeout(r,25)),{action:'steer',text:'Inspect the original fixed evidence next.'}):event.type==='question'?{action:'answer',text:'Use the fixed evidence only.'}:{action:'none'}});
 const out=await module.runActivitySkillParentLoop({...state,beforeTurn:async({index,phase})=>{
  calls++;if(index===2&&phase==='before_context')await state.broker.report({type:'stall',elapsed_ms:1000});return true;
 }});
 assert.equal(out.reason,'agent_finished');assert.equal(out.turn_count,3);assert.equal(out.model_execution_unknown,false);assert.deepEqual(state.effects,[]);
 const events=readFileSync(join(state.directory,'broker-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(events.filter(e=>e.event.type==='stall').length,1);assert.equal(events.find(e=>e.event.type==='stall').action_applied,true);
});

test('a stall starting DURING parent context authority is drained before dispatch and spliced guidance is retained exactly once',async t=>{
 let start,finish,held,report,first=true;
 const state=await fixture(t,{turns:async(index,input)=>{if(index===0)return {type:'inspect',question:'Use the original context?'};assert.deepEqual(input.context.commander_guidance,['Original answer.','Steer after the in-context stall.']);return {type:'finish'};},onEvent:async event=>{if(event.type==='stall'){start();await held;return{action:'steer',text:'Steer after the in-context stall.'};}return event.type==='question'?{action:'answer',text:'Original answer.'}:{action:'none'};}});
 held=new Promise(r=>{finish=r;});const started=new Promise(r=>{start=r;}),read=state.broker.readParentContext;
 state.broker.readParentContext=async()=>{const value=await read();if(first&&state.inputs.length===1){first=false;report=state.broker.report({type:'stall',elapsed_ms:1000});await started;}return value;};
 try{const out=await module.runActivitySkillParentLoop({...state,beforeTurn:async({onDrained})=>{if(report){onDrained();finish();await report;report=null;}return true;}});assert.equal(out.reason,'agent_finished');assert.equal(out.turn_count,2);assert.deepEqual(state.effects,[]);}finally{finish();await report?.catch(()=>{});}
});

test('Observer admission uses the original worker deadline and persists only a fixed failure code',async t=>{
 const state=await fixture(t,{workerMs:80,turns:async()=>({type:'finish'})});let release;const held=new Promise(r=>{release=r;});
 const pending=module.runActivitySkillParentLoop({...state,beforeTurn:()=>held});
 try{const out=await Promise.race([pending,new Promise(r=>setTimeout(()=>r(null),150))]);assert.ok(out,'owned admission must not escape original deadline');assert.equal(out.reason,'worker_deadline');assert.equal(state.inputs.length,0);const failure=JSON.parse(readFileSync(join(state.directory,'parent-loop/loop-failure.json')));assert.equal(failure.failure_code,'PARENT_LOOP_DEADLINE');}
 finally{release(true);await pending;}
});

test('Observer refusal has a safe diagnostic code without leaking arbitrary errors',async t=>{
 for(const error of [null,Error('Bearer FIXTURE_SECRET postgres://private')]){const state=await fixture(t,{turns:async()=>({type:'finish'})});
  await module.runActivitySkillParentLoop({...state,beforeTurn:()=>{if(error)throw error;return false;}});const raw=readFileSync(join(state.directory,'parent-loop/loop-failure.json'),'utf8'),record=JSON.parse(raw);assert.equal(record.failure_code,error?'PARENT_LOOP_UNCLASSIFIED':'PARENT_LOOP_OBSERVER_UNVERIFIED');assert.doesNotMatch(raw,/FIXTURE_SECRET|postgres/);assert.equal(state.inputs.length,0);
 }
});

for(const action of ['steer','answer','abort'])test('completed accepted '+action+' between context snapshot and dispatch must invalidate the old snapshot',async t=>{
 let first=true;const state=await fixture(t,{turns:async(_index,input)=>{assert.deepEqual(input.context.commander_guidance,['Same accepted guidance.','Same accepted guidance.']);return{type:'finish'};},onEvent:async()=>action==='abort'?{action:'abort',reason:'Stop the current Worker.'}:{action,text:'Same accepted guidance.'}}),read=state.broker.readParentContext;
 state.broker.readParentContext=async()=>{const old=await read();if(first){first=false;await state.broker.report({type:'stall'});if(action!=='abort')await state.broker.report({type:'stall'});}return old;};
 const out=await module.runActivitySkillParentLoop({...state,beforeTurn:async()=>true});
 assert.equal(out.reason,action==='abort'?'commander_aborted':'agent_finished');assert.equal(state.inputs.length,action==='abort'?0:1);assert.deepEqual(state.effects,[]);
});

test('parent context watermark is private to the original broker object, never clone or cross-broker JSON',async t=>{
 const first=await fixture(t,{turns:async()=>({type:'finish'})}),other=await fixture(t,{turns:async()=>({type:'finish'})});
 assert.equal(typeof first.broker.isParentContextCurrent,'function');const context=await first.broker.readParentContext();
 assert.equal(first.broker.isParentContextCurrent(context),true);assert.equal(first.broker.isParentContextCurrent(structuredClone(context)),false);assert.equal(other.broker.isParentContextCurrent(context),false);
 await first.broker.abort('Code cancelled original scope');assert.equal(first.broker.isParentContextCurrent(context),false);
});

for(const unsafe of [false,true])test('精确官方停止回执允许失败域known-stopped但未知外部效果仍隔离 '+unsafe,async t=>{
 const state=await fixture(t,{stopKnown:true,workerMs:35,turns:async()=>new Promise(()=>{})});
 const verify=state.control.verifyStopReceipt.bind(state.control);
 state.control.verifyStopReceipt=(receipt,context)=>({...verify(receipt,context),index:context.index,official_execution_stopped:true,external_effect_unknown:unsafe,previous_caller_stop_unproven:false,ended_at:Date.now()});
 const out=await module.runActivitySkillParentLoop(state);
 assert.equal(out.reason,'official_turn_unverified');
 assert.equal(out.official_execution_stopped,true);
 assert.equal(out.model_execution_unknown,unsafe);
 assert.deepEqual(state.effects,[]);assert.equal(state.isControlClosed(),true);
});
