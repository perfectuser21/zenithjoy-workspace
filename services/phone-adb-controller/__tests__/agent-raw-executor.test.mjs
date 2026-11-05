import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {agentInput,canonical} from '../runtime-definition.mjs';
import * as workflow from '../leadgen-workflow.mjs';
const {createWorkflowExecution}=workflow;
import {RPC_FILES} from '../leadgen-client.mjs';
import {rawModelScopeStopped} from '../activity-skill-parent-loop.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
function officialFixture(request,{onTurn}={}){
 const receipts=new WeakMap(),permits=new WeakMap(),snapshots=new WeakSet();let delivery,sealed=false,closed=false;
 const same=q=>canonical(q)===canonical(request);
 return {
  async authorizeParentContext(q){return !sealed&&same(q);},
  async request(q){assert.equal(q.kind,'official_agent_turn');assert.equal(same(q.request),true);assert.equal(sealed,false);const receipt=Object.freeze({});receipts.set(receipt,{index:q.turn.index,status:'ok',official_run_id:'33333333-3333-4333-8333-'+String(q.turn.index+1).padStart(12,'0'),text:JSON.stringify(await onTurn(q.turn.index,q.turn.input))});return receipt;},
  verifyTurnReceipt(value,{request:q,index}){const row=receipts.get(value);if(!row||!same(q)||index!==row.index)throw Error('OFFICIAL_TURN_UNVERIFIED');return structuredClone(row);},
  verifyStopReceipt(){throw Error('NO_STOP_PROOF');},
  authorizeIntent(value,{request:q,index,op,body}){this.verifyTurnReceipt(value,{request:q,index});const permit=Object.freeze({});permits.set(permit,{index,op,body:canonical(body)});return permit;},
  consumeIntentPermit(value,{request:q,index,op,body}){const row=permits.get(value);if(sealed||!row||!same(q)||index!==row.index||op!==row.op||canonical(body)!==row.body)return false;permits.delete(value);delivery=row;return true;},
  async authorizeBrokerDelivery(q,{op,body}){if(sealed||!same(q)||!delivery||delivery.op!==op||delivery.body!==canonical(body))return false;delivery=null;return true;},
  seal(){sealed=true;delivery=null;},async close(){closed=true;},snapshot(){const value=Object.freeze({sealed,closed});snapshots.add(value);return value;},verifySealedExecution(value,{request:q}){return same(q)&&snapshots.has(value)&&sealed&&closed;},
 };
}
function fixture(t){
 const runDir=mkdtempSync(join(tmpdir(),'raw-main-executor-'));t.after(()=>rmSync(runDir,{recursive:true,force:true}));
 const name='douyin-leadgen-activity-103-scoring',path='runtime/skills/'+name+'/SKILL.md',text=readFileSync(new URL('../skills/'+name+'/SKILL.md',import.meta.url),'utf8'),support=readFileSync(new URL('../skills/leadgen-activity-execution.md',import.meta.url),'utf8');
 mkdirSync(join(runDir,'runtime/skills',name),{recursive:true});writeFileSync(join(runDir,path),text);writeFileSync(join(runDir,'runtime/skills/leadgen-activity-execution.md'),support);
 const task='11111111-1111-4111-8111-111111111111',binding={id:'22222222-2222-4222-8222-222222222222',run_id:'douyin_comment_scoring-raw103__a1',task_id:task};
 const env={LEADGEN_EXECUTION_MODE:'agent',LEADGEN_EXECUTION_TRANSPORT:'raw-model-v1',LEADGEN_MAX_TURNS:'4',WF_BRAIN_WORKFLOW:'douyin_comment_scoring',WF_BRAIN_TASK_ID:task,WFR_TAG:'raw103',P:'mmv-scoring',SERIAL:'none',LEADGEN_LINE:'yuesheng',LEADGEN_LIMIT:'2',LEADGEN_SOURCE_RUN:'raw102',WF_RUN_START_TS:String(Math.floor(Date.now()/1000)),WF_RUN_MAX_SECONDS:'1800'};
 const frozen={execution_mode:'agent',execution_transport:'raw-model-v1',max_turns:4,agent_input:agentInput(env),snapshot_sha256:'b'.repeat(64),deployment:{target:'mmv',source_commit:'a'.repeat(40),observation_id:'observation'},release:{id:'release'},workflow_version:{id:'wv',payload:{key:env.WF_BRAIN_WORKFLOW}},files:{[path]:sha(text),'runtime/skills/leadgen-activity-execution.md':sha(support)},activities:[{reference:{slot_key:'scoring',reference_id:'ref'},version:{id:'av',payload:{definition_key:'douyin_comment_scoring.scoring',contract:{budget:{max_duration_s:30}},implementation_bindings:[{kind:'skill',name,version:text.match(/^  version: (\S+)$/m)[1],path:'services/phone-adb-controller/skills/'+name+'/SKILL.md'}]}}}]};
 return {runDir,env,frozen,binding,taskId:task,activities:[{key:'scoring',budget:{max_duration_s:30}}]};
}

test('actual workflow factory runs the declared raw Skill through one broker and Code result, never legacy RPC or child fields',async t=>{
 const f=fixture(t),file=join(f.runDir,'server-score.json');let settled=0,controllers=0,prepared=0,legacy=0;
 const handlers={state:{},agentSupportsNativeScope:()=>true,agentNativeState:()=>({}),createAgentTools:async(_activity,scope)=>({prepare:async()=>{prepared++;},inspect:async()=>({business_capabilities:['score']}),phone:async()=>{throw Error('103_HAS_NO_PHONE');},business:async(operation,input)=>{assert.equal(operation,'score');writeFileSync(file,JSON.stringify({scored:1,ids:input.ids}));return {persisted:true};},getResult:()=>existsSync(file)?JSON.parse(readFileSync(file)):null,settle:async proof=>{assert.equal(rawModelScopeStopped(proof.raw_model_proof,scope),true);settled++;},closeNativeScope:async proof=>({execution_stopped:rawModelScopeStopped(proof.raw_model_proof,scope)})})};
 const wired=createWorkflowExecution({...f,handlers,rpc:async()=>{legacy++;throw Error('LEGACY_RPC_MUST_NOT_RUN');},createOfficialControl:async({request,scope})=>{controllers++;assert.equal(request.nonce,scope.agent_nonce);return officialFixture(request,{onTurn:async(index,input)=>{if(index===0)return {type:'business',operation:'score',input:{ids:['55555555-5555-4555-8555-555555555555']}};assert.deepEqual(input.context.commander_guidance,['Keep the original scoring policy.']);return {type:'finish'};}});}});
 const actual=await wired.executeAgent(f.activities[0],{context:{task_id:f.taskId},deadline_ms:Date.now()+10000,onEvent:async event=>event.operation==='business'?{action:'steer',text:'Keep the original scoring policy.'}:{action:'none'}});
 assert.equal(actual.status,'completed');assert.equal(actual.execution_stopped,true);assert.equal(actual.result.scored,1);assert.deepEqual(actual.result.ids,['55555555-5555-4555-8555-555555555555']);
 assert.deepEqual([prepared,controllers,settled,legacy],[1,1,1,0]);assert.equal(actual.skill_receipt.owner_execution_stopped,undefined);assert.equal(actual.skill_receipt.child_run_id,undefined);
});

test('actual control Task selects zero-capability handlers, pure recorder and a failing business Judge without legacy RPC',async t=>{
 const f=fixture(t);Object.assign(f.env,{P:'mmv-scoring',LEADGEN_LIMIT:'1',WF_RUN_MAX_SECONDS:'300',LEADGEN_MAX_TURNS:'8'});delete f.env.LEADGEN_SOURCE_RUN;
 f.frozen.agent_input=agentInput(f.env);Object.assign(f.frozen,{max_turns:8,control_scope:{protocol:'runner-control-acceptance/v1',activity_key:'scoring',allowed_intents:['inspect','finish']},control_claim:{claimed_by:'headed-control-fixture',claimed_at:'2026-11-05T00:00:00.000Z'}});
 assert.equal(typeof workflow.createWorkflowHandlers,'function');
 const rpc=async()=>{throw Error('CONTROL_MUST_NOT_CONSTRUCT_LEGACY_RPC');};
 const handlers=workflow.createWorkflowHandlers({...f,root:join(f.runDir,'runtime'),rpc});
 const wired=createWorkflowExecution({...f,handlers,rpc,createOfficialControl:async({request})=>{assert.deepEqual(request.control_scope,f.frozen.control_scope);assert.deepEqual(request.control_claim,f.frozen.control_claim);return officialFixture(request,{onTurn:async index=>index===0?{type:'inspect',progress:'Inspect only, no business.'}:{type:'finish'}});}});
 const actual=await wired.executeAgent(f.activities[0],{context:{task_id:f.taskId},deadline_ms:Date.now()+10000});
 assert.equal(actual.status,'partial');assert.equal(actual.execution_stopped,true);assert.equal(actual.result.business_pass,false);assert.equal(actual.result.physical_actions,0);assert.equal(actual.result.pg_connections,0);
 const judged=await workflow.readbackActivityChecks({executionMode:'agent',activity:f.activities[0],root:join(f.runDir,'runtime'),frozen:f.frozen,env:f.env,metrics:actual.result,rpc});
 assert.equal(judged.result.gate.verdict,'fail');
 await workflow.recordActivityBookkeeping({phase:'start',activity:'scoring'},{root:join(f.runDir,'runtime'),env:{...f.env,WFR_RUN_DIR:f.runDir,WFR_ATTEMPT:'a1'},executionMode:'agent',controlScope:f.frozen.control_scope,execute:rpc});
 assert.ok(readFileSync(join(f.runDir,'span-start.a1.scoring.1'),'utf8'));
});

test('actual Runner checks twice around exactly one Code-owned raw read-only continuation with Commander guidance',async t=>{
 const f=fixture(t),turns=[],guidance=[];let checks=0,continuations=0;
 const handlers={state:{},agentSupportsNativeScope:()=>true,agentNativeState:()=>({}),createAgentTools:async(_a,scope)=>({prepare:async()=>{},inspect:async()=>({phone_capabilities:[],business_capabilities:[]}),phone:async()=>{throw Error('NO_PHONE');},business:async()=>{throw Error('NO_WRITE');},getResult:()=>({scored:0}),settle:async proof=>assert.equal(rawModelScopeStopped(proof.raw_model_proof,scope),true),closeNativeScope:async proof=>({execution_stopped:rawModelScopeStopped(proof.raw_model_proof,scope)})})};
 const createControl=({request})=>{
  const make=()=>officialFixture(request,{onTurn:async(index,input)=>{turns.push(index);if(index===0)return {type:'finish'};guidance.push(...input.context.commander_guidance);return {type:'inspect',progress:'Read back the original failed check only.'};}});
  const first=make();first.createReadOnlyContinuation=({request:q,snapshot,startIndex})=>{assert.equal(first.verifySealedExecution(snapshot,{request:q}),true);assert.equal(startIndex,1);continuations++;assert.equal(continuations,1);return make();};return first;
 };
 const wired=createWorkflowExecution({...f,handlers,rpc:async()=>{throw Error('NO_LEGACY_RPC');},createOfficialControl:createControl});
 const out=await workflow.runWorkflow({activities:f.activities,context:{execution_mode:'agent',workflow_key:f.env.WF_BRAIN_WORKFLOW,task_id:f.taskId,run_id:f.binding.run_id,source_commit:f.frozen.deployment.source_commit},executeAgent:wired.executeAgent,
  commander:async event=>event.phase==='recovery'?{action:'steer',text:'Read the failed scoring check; do not change any score.'}:{action:'none'},verify:async()=>{checks++;return {verified:false,reason:'zero_scored'};}});
 assert.equal(checks,2);assert.equal(continuations,1);assert.deepEqual(turns,[0,1]);assert.ok(guidance.includes('Read the failed scoring check; do not change any score.'));
 assert.equal(out.status,'needs_review');assert.equal(out.results[0].recovery_read_only,true);assert.equal(out.results[0].rescued,false);assert.equal(out.results[0].code_failures,0);
});

test('main prepares the fixed observer authority before any worker, native tool or legacy RPC is started',async t=>{
 const f=fixture(t);let effects=0;
 const wired=createWorkflowExecution({...f,handlers:{state:{},createAgentTools:async()=>{effects++;throw Error('NO_WORKER_PREPARE');},agentSupportsNativeScope:()=>false},rpc:async()=>{effects++;throw Error('NO_LEGACY');},createOfficialControl:async()=>{effects++;throw Error('NO_WORKER_CONTROL');}});
 assert.equal(typeof wired.executeAgent.prepareObserverRequest,'function');
 const deadline=Date.now()+10000,q=wired.executeAgent.prepareObserverRequest(f.activities[0],{deadline_ms:deadline,context:{task_id:f.taskId}});
 assert.equal(q.execution_transport,'raw-model-v1');assert.equal(q.task_id,f.taskId);assert.equal(q.method.name,'douyin-leadgen-activity-103-scoring');assert.ok(q.deadline_ms<deadline);assert.ok(q.worker_deadline_ms<q.receipt_deadline_ms);assert.equal(effects,0);assert.equal(existsSync(join(f.runDir,'skill-primary')),false);
});

test('actual main selects SDK Observer before bridge wake and never falls back to legacy Commander RPC for raw control',async t=>{
 const f=fixture(t);Object.assign(f.env,{LEADGEN_LIMIT:'1',LEADGEN_MAX_TURNS:'8',WF_RUN_MAX_SECONDS:'300'});delete f.env.LEADGEN_SOURCE_RUN;f.frozen.agent_input=agentInput(f.env);Object.assign(f.frozen,{max_turns:8,control_scope:{protocol:'runner-control-acceptance/v1',activity_key:'scoring',allowed_intents:['inspect','finish']},control_claim:{claimed_by:'fixture',claimed_at:'2026-11-05T00:00:00Z'}});
 for(const name of RPC_FILES)f.frozen.files['runtime/'+name]=sha(readFileSync(new URL('../'+name,import.meta.url)));
 assert.equal(typeof workflow.prepareWorkflowCommander,'function');let prepared=0,observed=0;
 const observer=await workflow.prepareWorkflowCommander({...f,context:{commander_skill:{}},executeAgent:{prepareObserverRequest:()=>({activity_key:'scoring',task_id:f.taskId})},rpc:async()=>{throw Error('NO_OLD_COMMANDER_RPC');},createObserver:async options=>{assert.equal(options.request.task_id,f.taskId);prepared++;return{commander:async()=>{assert.equal(prepared,1);observed++;return{action:'none'};},close:async()=>({execution_stopped:true})};}});
 const out=await workflow.runWorkflow({activities:f.activities,context:{execution_mode:'agent',workflow_key:f.env.WF_BRAIN_WORKFLOW,task_id:f.taskId,run_id:f.binding.run_id},executeAgent:async()=>({status:'completed',execution_stopped:true,result:{}}),verify:async()=>({verified:true}),commander:observer.commander});
 assert.equal(out.status,'completed');assert.ok(observed>=2);assert.equal((await observer.close()).execution_stopped,true);
});

test('unknown first raw execution and forged Judge evidence cannot open a continuation or a second model turn',async t=>{
 const {certifyRawCheckFailure}=await import('../activity-skill-executor.mjs');assert.equal(certifyRawCheckFailure({execution_stopped:true,raw_continuation:{}},{verified:false}),null);
 const f=fixture(t);let turns=0,continued=0,checks=0;
 const handlers={state:{},agentSupportsNativeScope:()=>true,agentNativeState:()=>({}),createAgentTools:async(_a,scope)=>({prepare:async()=>{},inspect:async()=>({}),phone:async()=>{throw Error('NO_PHONE');},business:async()=>{throw Error('NO_PG');},getResult:()=>null,settle:async()=>{throw Error('UNKNOWN_MUST_NOT_SETTLE');},closeNativeScope:async proof=>({execution_stopped:rawModelScopeStopped(proof.raw_model_proof,scope)})})};
 const wired=createWorkflowExecution({...f,handlers,rpc:async()=>{throw Error('NO_LEGACY');},createOfficialControl:async({request})=>{const c=officialFixture(request,{onTurn:async()=>{turns++;throw Error('LOST_ACK');}});c.createReadOnlyContinuation=()=>{continued++;throw Error('UNKNOWN_MUST_NOT_RECOVER');};return c;}});
 await assert.rejects(wired.executeAgent.recoverAfterCheck(f.activities[0],{failureProof:{kind:'code-judge-failure/v1'}}),/RAW_READONLY_RECOVERY_UNAVAILABLE/);
 const out=await workflow.runWorkflow({activities:f.activities,context:{execution_mode:'agent',workflow_key:f.env.WF_BRAIN_WORKFLOW,task_id:f.taskId,run_id:f.binding.run_id},executeAgent:wired.executeAgent,commander:async()=>({action:'steer',text:'Cannot override unknown.'}),verify:async()=>{checks++;return{verified:false};}});
 assert.equal(out.status,'needs_review');assert.equal(out.results[0].execution_stopped,false);assert.equal(turns,1);assert.equal(continued,0);assert.equal(checks,0);
});

test('actual main wake and later Commander events see only frozen Task control boundaries while original business criteria stay intact',async t=>{
 const f=fixture(t),control_scope={protocol:'runner-control-acceptance/v1',activity_key:'scoring',allowed_intents:['inspect','finish']};Object.assign(f.env,{LEADGEN_LIMIT:'1',LEADGEN_MAX_TURNS:'8',WF_RUN_MAX_SECONDS:'300'});delete f.env.LEADGEN_SOURCE_RUN;f.frozen.agent_input=agentInput(f.env);f.frozen.max_turns=8;
 const {controlAcceptanceFromTask}=await import('../control-acceptance-tools.mjs');
 const authority=controlAcceptanceFromTask({input:f.frozen.agent_input,sourceCommit:f.frozen.deployment.source_commit,task:{id:f.taskId,status:'in_progress',claimed_by:'fixture',claimed_at:'2026-11-05T00:00:00Z',payload:{source_commit:f.frozen.deployment.source_commit,workflow_key:f.env.WF_BRAIN_WORKFLOW,run_tag:f.env.WFR_TAG,profile:'mmv-scoring',company_line:'yuesheng',scope:{control_scope,source_run:null,limit:1,score_limit:1,send:0,run_max_seconds:300,execution_transport:'raw-model-v1',max_turns:8}}}});
 Object.assign(f.frozen,authority);f.frozen.workflow_version.payload.contract={name:'Original scoring purpose',checks:['real scores'],outputs:['persisted score'],rules:['original rule']};
 assert.equal(typeof workflow.createWorkflowContext,'function');
 const context=workflow.createWorkflowContext({...f,executionMode:'agent'}),events=[];
 await workflow.runWorkflow({activities:f.activities,context,executeAgent:async(_a,{onEvent})=>{await onEvent({type:'question',text:'May this restricted run score comments?'});return{status:'completed',execution_stopped:true,result:{}};},commander:async event=>{events.push(event);return{action:'none'};},verify:async()=>({verified:false})});
 assert.equal(events[0].phase,'wake');assert.ok(events.length>=3);
 for(const event of events){assert.deepEqual(event.control_scope,control_scope);assert.equal(event.control_acceptance.physical_actions,0);assert.equal(event.control_acceptance.pg_connections,0);assert.equal(event.control_acceptance.business_judge,'independent_needs_review');assert.match(event.control_acceptance.purpose,/inspect.*finish/);}
 assert.deepEqual(context.brief.done_criteria,{checks:['real scores'],outputs:['persisted score']});assert.deepEqual(context.rules,['original rule']);
 const ordinary=structuredClone(f.frozen);delete ordinary.control_scope;delete ordinary.control_claim;ordinary.result={control_scope};
 const rejected=workflow.createWorkflowContext({...f,frozen:ordinary,env:{...f.env,CONTROL_SCOPE:JSON.stringify(control_scope)},control_scope,executionMode:'agent'});
 assert.equal(Object.hasOwn(rejected,'control_scope'),false);assert.equal(Object.hasOwn(rejected,'control_acceptance'),false);
});
