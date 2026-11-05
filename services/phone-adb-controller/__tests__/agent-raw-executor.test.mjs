import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {agentInput,canonical} from '../runtime-definition.mjs';
import {createWorkflowExecution} from '../leadgen-workflow.mjs';
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
