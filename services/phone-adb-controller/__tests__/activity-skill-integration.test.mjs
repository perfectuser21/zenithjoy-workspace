// Isolated offline transport fixtures; no Gateway/model/device/DB or production run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {runWorkflow} from '../leadgen-workflow.mjs';
import {createActivityRecovery} from '../activity-skill-recovery.mjs';
import {runSkillAgent,skillAuthority,claimSkillSpawn,relayActivityTool} from '../leadgen-skill-agent.mjs';
const sourceRoot=new URL('../',import.meta.url).pathname;
const hash=x=>createHash('sha256').update(x).digest('hex');
for(const verdict of [true,false])test('real single-slot broker CLI → parent transport → official-shaped fixture → independent verify '+verdict,async()=>{
 const d=mkdtempSync(join(tmpdir(),'handoff-integration-'));let calls=0,launches=0,verified=0,next=0;
 try{
  const name='douyin-leadgen-activity-103-scoring',methodPath=`skills/${name}/SKILL.md`,supportPath='skills/leadgen-activity-execution.md';
  const text=readFileSync(join(sourceRoot,methodPath),'utf8'),support=readFileSync(join(sourceRoot,supportPath),'utf8'),version=text.match(/^  version: (.+)$/m)[1];
  for(const [path,body] of [[methodPath,text],[supportPath,support]]){mkdirSync(dirname(join(d,'runtime',path)),{recursive:true});writeFileSync(join(d,'runtime',path),body);}
  writeFileSync(join(d,'runtime','activity-skill-tool.mjs'),readFileSync(join(sourceRoot,'activity-skill-tool.mjs')));
  const frozen={files:{['runtime/'+methodPath]:hash(text),['runtime/'+supportPath]:hash(support)},snapshot_sha256:'fixture-snapshot',release:{id:'fixture-release'},deployment:{source_commit:'a'.repeat(40),target:'mmv',observation_id:'fixture-observation'},workflow_version:{id:'fixture-wv'},activities:[{reference:{slot_key:'scoring',reference_id:'fixture-ref'},version:{id:'fixture-av',payload:{definition_key:'douyin_comment_scoring.scoring',implementation_bindings:[{kind:'skill',name,version,path:'services/phone-adb-controller/'+methodPath}]}}}]};
  const handlers={state:{budgetDeadline:Date.now()+60000},handoffContext:async()=>({company_id:'fixture-company',comments_committed:1}),handoffPhone:async()=>{throw Error('no phone in103');}};
  const rpc=async input=>{
   if(input.kind==='activity_skill_authority')return {authorized:skillAuthority(input.request,{home:d,verifyWorkspace:()=>true})};
   assert.equal(input.kind,'activity_skill');
   return {result:await runSkillAgent(input.request,{home:d,verifyWorkspace:()=>true,execute:async(command,args)=>{
    if(command==='openclaw'){
     launches++;const dir=dirname(args[args.indexOf('--message-file')+1]),request=JSON.parse(readFileSync(join(dir,'agent-request.json'),'utf8'));
     claimSkillSpawn(dir,{home:d,verifyWorkspace:()=>true});
     const receipt={runId:'11111111-1111-4111-8111-111111111111',childSessionKey:'agent:skill-factory:subagent:fixture',resolvedProvider:'openai',resolvedModel:'gpt-6.1-sol'};
     writeFileSync(join(dir,'spawn-receipt.json'),JSON.stringify(receipt));writeFileSync(join(dir,'agent-binding.json'),JSON.stringify({...request,child_run_id:receipt.runId,child_session_key:receipt.childSessionKey}));
     // Actual child-process tool talks to the parent socket. Only Gateway itself is fixture transport.
     const relay={home:d,authorize:async q=>skillAuthority(q,{home:d,verifyWorkspace:()=>true})};await relayActivityTool(dir,'inspect',{},relay);await relayActivityTool(dir,'resume',{},relay);
     return {code:0,stdout:'fixture parent result',stderr:''};
    }
    assert.equal(command,'python3');assert.equal(args[1],'await');
    const binding=JSON.parse(readFileSync(join(args[2],'agent-binding.json'),'utf8'));
    writeFileSync(join(args[2],'agent-terminal.json'),JSON.stringify({runId:binding.child_run_id,status:'ok',endedAt:Date.now(),terminalReceipt:{runId:binding.child_run_id,effective:{provider:'openai',model:'gpt-6.1-sol'}},terminalReply:{text:'fixture child prose not used as business result'}}));return {code:0,stdout:'official-shaped isolated fixture',stderr:''};
   }})};
  };
  const recover=createActivityRecovery({runDir:d,frozen,binding:{id:'fixture-binding',run_id:'fixture__a1'},env:{},handlers,rpc});
  const result=await runWorkflow({activities:[{key:'scoring',retry_safe:true},{key:'mark_leads'}],context:{},handlers:{scoring:async()=>{calls++;if(calls<3)throw Error('fixture recoverable Code failure');return {scored:1};},mark_leads:async()=>{next++;return {marked:1};}},record:async()=>{},commander:async r=>({action:r.evidence?.status==='failed'?'retry':'continue',reason:'fixture'}),recover,verify:async(a,r)=>{if(a.key!=='scoring')return {verified:true};verified++;assert.equal(r.result.scored,1);return {verified:verdict};}});
  assert.equal(calls,3);assert.equal(launches,1);assert.ok(verified>=1);assert.equal(next,verdict?1:0);assert.equal(result.status,verdict?'completed':'failed');
 }finally{rmSync(d,{recursive:true,force:true});}
});

// Real parent/child lifecycle + socket; only the Gateway's official RPC transport is offline.
async function continuationFixture({policy={max_additional_turns:1},activityKey='qualification',ownerState='done',completeFinal=false,businessResult={status:'completed',qualified:1},phoneError,resumeFirst=false,parentUnknown=false,status='error',secondStatus='ok',unknownChild=false,secondRpcUnknown=false,verify=async()=>({verified:true}),afterFirst}={}){
 const d=mkdtempSync(join(tmpdir(),'handoff-continuation-'));let launches=0,resumes=0;const turns=[],directories=[];
 try{
  const name=activityKey==='send_dm'?'douyin-leadgen-activity-104-send-dm':'douyin-leadgen-activity-102-'+activityKey,path=`skills/${name}/SKILL.md`,supportPath='skills/leadgen-activity-execution.md';
  const text=readFileSync(join(sourceRoot,path),'utf8'),support=readFileSync(join(sourceRoot,supportPath),'utf8'),version=text.match(/^  version: (.+)$/m)[1];
  for(const [p,body] of [[path,text],[supportPath,support],['activity-skill-tool.mjs',readFileSync(join(sourceRoot,'activity-skill-tool.mjs'))]]){mkdirSync(dirname(join(d,'runtime',p)),{recursive:true});writeFileSync(join(d,'runtime',p),body);}
  const frozen={files:{['runtime/'+path]:hash(text),['runtime/'+supportPath]:hash(support)},snapshot_sha256:'fixture-snapshot',release:{id:'fixture-release'},deployment:{source_commit:'a'.repeat(40),target:'mmv',observation_id:'fixture-observation'},workflow_version:{id:'fixture-wv'},activities:[{reference:{slot_key:activityKey,reference_id:'fixture-ref'},version:{id:'fixture-av',payload:{contract:{...(policy===undefined?{}:{agent_recovery:policy})},definition_key:activityKey==='send_dm'?'douyin_lead_outreach.send_dm':'douyin_video_processing.'+activityKey,implementation_bindings:[{kind:'skill',name,version,path:'services/phone-adb-controller/'+path}]}}}]};
  const handlers={state:{budgetDeadline:Date.now()+60000},handoffContext:async()=>({fixture:true}),handoffHeartbeat:async()=>{},handoffPhone:async()=>{if(phoneError)throw Error(phoneError);return {fresh:true};}};
  const rpc=async input=>{
   if(input.kind==='activity_skill_authority')return {authorized:skillAuthority(input.request,{home:d,verifyWorkspace:()=>true})};
   turns.push(input.request);const turn=turns.length-1;if(turn===1&&secondRpcUnknown)throw Error('official transport result unavailable');
   return {result:await runSkillAgent(input.request,{home:d,verifyWorkspace:()=>true,execute:async(command,args)=>{
    if(command==='openclaw'&&args[0]==='gateway'){
     if(args[2]==='tools.invoke'){const parent=JSON.parse(readFileSync(join(directories[0],'agent-request.json'),'utf8')).parent_session_key;return {code:0,stdout:JSON.stringify({ok:true,toolName:'subagents',source:'core',output:{details:{status:'ok',action:'list',callerIsSubagent:false,callerSessionKey:ownerState==='registry_identity'?'other':parent,requesterSessionKey:parent,active:ownerState==='registry_active'?[{runId:'unbound-live-child'}]:ownerState==='registry_missing'?undefined:[]}}}),stderr:''};}
     if(args[2]==='agent.wait')return {code:0,stdout:JSON.stringify({runId:ownerState==='wrong_run'?'other':'owner-turn-0',status:ownerState==='wait_missing'?'timeout':'ok',endedAt:ownerState==='wait_missing'?null:Date.now()}),stderr:''};
     const previous=JSON.parse(readFileSync(join(directories[0],'agent-request.json'),'utf8'));
     return {code:0,stdout:JSON.stringify({ts:Date.now(),sessions:[{key:previous.parent_session_key,lastRunId:['wrong_run','later_done'].includes(ownerState)?'other':'owner-turn-0',sessionId:ownerState==='wrong_session'?'other-session':'owner-session-0',...(ownerState==='live_subagent'?{hasActiveSubagentRun:true}:{}),...(ownerState==='pending'?{pendingInputs:['unconsumed']}:{}),status:'done',endedAt:ownerState==='missing_end'?null:Date.now(),hasActiveRun:ownerState==='missing_active'?undefined:ownerState==='active',activeRunIds:ownerState==='active'?['late-owner']:[]}]}),stderr:''};
    }
    if(command==='openclaw'){
     launches++;const dir=dirname(args[args.indexOf('--message-file')+1]);directories.push(dir);
     const request=JSON.parse(readFileSync(join(dir,'agent-request.json'),'utf8'));claimSkillSpawn(dir,{home:d,verifyWorkspace:()=>true});
     const receipt={runId:`11111111-1111-4111-8111-${String(turn+1).padStart(12,'0')}`,childSessionKey:'agent:skill-factory:subagent:fixture'+turn,resolvedProvider:'openai',resolvedModel:'gpt-6.1-sol'};
     writeFileSync(join(dir,'spawn-receipt.json'),JSON.stringify(receipt));writeFileSync(join(dir,'agent-binding.json'),JSON.stringify({...request,child_run_id:receipt.runId,child_session_key:receipt.childSessionKey}));
     const deps={home:d,authorize:async q=>skillAuthority(q,{home:d,verifyWorkspace:()=>true})};
     await relayActivityTool(dir,'inspect',{},deps);
     if(turn===0){for(let i=0;i<(activityKey==='qualification'?2:0);i++){const read=()=>relayActivityTool(dir,'phone',{command:'native-audio-evidence',args:[]},deps);if(phoneError)await assert.rejects(read);else await read();}if(resumeFirst)await relayActivityTool(dir,'resume',{},deps);await afterFirst?.({handlers,request:input.request});}
     else{
      await assert.rejects(()=>relayActivityTool(directories[0],'inspect',{},deps),'old generation cannot use the live broker');
      await assert.rejects(()=>relayActivityTool(dir,'phone',{command:'native-audio-evidence',args:[]},deps),'native evidence budget is cumulative');
      if(resumeFirst){await assert.rejects(()=>relayActivityTool(dir,'resume',{},deps));await assert.rejects(()=>relayActivityTool(dir,'phone',{command:'back-evidence',args:[]},deps));}
      else await relayActivityTool(dir,'resume',{},deps);
     }
     return {code:parentUnknown&&turn===0?1:0,stdout:ownerState==='code_only'?'':JSON.stringify(ownerState==='model_payload'?{result:{payloads:[{text:JSON.stringify({runId:'owner-turn-'+turn,status:'ok',summary:'completed'})}]}}:{runId:'owner-turn-'+turn,status:'ok',...(completeFinal?{summary:'completed',result:{payloads:[],meta:{durationMs:10,agentMeta:{sessionId:'owner-session-'+turn}}}}:{})}),stderr:''};
    }
    if(unknownChild)return {code:1,stdout:'',stderr:'official terminal unavailable'};
    const binding=JSON.parse(readFileSync(join(args[2],'agent-binding.json'),'utf8'));
    writeFileSync(join(args[2],'agent-terminal.json'),JSON.stringify({runId:binding.child_run_id,status:turn===0?status:secondStatus,endedAt:Date.now(),terminalReceipt:{runId:binding.child_run_id,effective:{provider:'openai',model:'gpt-6.1-sol'}}}));return {code:0,stdout:'official exact terminal',stderr:''};
   }})};
  };
  const recover=createActivityRecovery({runDir:d,frozen,binding:{id:'fixture-binding',run_id:'fixture__a1'},env:{},handlers,rpc,verify});
  const result=await recover({activity:{key:activityKey},failure:{status:'failed',execution_stopped:true,error:'temporary application fault'},execute:async()=>{resumes++;return businessResult;}});
  return {result,launches,resumes,turns,directories,owner_pending:readdirSync(join(d,'.openclaw','leadgen-owner-turns')).some(p=>p.endsWith('.pending.json'))};
 }finally{rmSync(d,{recursive:true,force:true});}
}
for(const resumeFirst of [false,true])test('confirmed failed Agent continues once in original broker without resetting execution/evidence '+resumeFirst,async()=>{
 const r=await continuationFixture({resumeFirst});assert.equal(r.launches,2);assert.equal(r.resumes,1);assert.equal(r.result.status,'completed');assert.equal(r.result.result.qualified,1);
 assert.equal(r.turns[0].nonce,r.turns[1].nonce);assert.equal(r.turns[0].deadline_ms,r.turns[1].deadline_ms);assert.notEqual(r.directories[0],r.directories[1]);
 assert.deepEqual(r.turns.map(q=>q.transport_generation),[0,1]);assert.equal(r.turns[1].mode,resumeFirst?'readback_only':'repair');
});
for(const options of [{parentUnknown:true},{status:'ok'},{policy:null}])test('no extra Agent for owner unknown, prose-only ok or absent frozen policy '+JSON.stringify(options),async()=>{
 const r=await continuationFixture(options);assert.equal(r.launches,1);assert.equal(r.resumes,0);assert.notEqual(r.result.status,'completed');
});
for(const policy of [{max_additional_turns:2},{max_additional_turns:1,other:true},{max_additional_turns:'1'}])test('malformed frozen Agent policy rejects before transport '+JSON.stringify(policy),async()=>{
 await assert.rejects(()=>continuationFixture({policy}),/SKILL_AGENT_RECOVERY_POLICY_INVALID/);
});

test('two confirmed Agent failures exhaust the one additional turn, never create a third child',async()=>{
 const r=await continuationFixture({secondStatus:'error'});assert.equal(r.launches,2);assert.equal(r.resumes,1);assert.equal(r.result.status,'partial');
});
test('missing official child termination never authorizes a second transport',async()=>{
 const r=await continuationFixture({unknownChild:true});assert.equal(r.launches,1);assert.equal(r.result.execution_stopped,false);assert.equal(r.resumes,0);
});
test('remaining execution deadline exhausted while awaiting proof cannot start another Agent',async()=>{
 const old=Date.now;let offset=0;
 try{Date.now=()=>old()+offset;const r=await continuationFixture({afterFirst:()=>{offset=60001;}});assert.equal(r.launches,1);assert.equal(r.resumes,0);}finally{Date.now=old;}
});

test('Skill actual output failing independent verify gets only a readback turn, then fresh verification',async()=>{
 let checks=0;const r=await continuationFixture({resumeFirst:true,status:'ok',verify:async()=>({verified:++checks>1})});
 assert.equal(r.launches,2);assert.equal(r.resumes,1);assert.equal(r.turns[1].mode,'readback_only');assert.equal(r.result.status,'completed');assert.equal(checks,2);
});
test('Skill output still failing independent verify after readback remains incomplete',async()=>{
 const r=await continuationFixture({resumeFirst:true,status:'ok',verify:async()=>({verified:false})});assert.equal(r.launches,2);assert.equal(r.resumes,1);assert.equal(r.result.status,'partial');
});

test('second transport response lost cannot inherit the first child stopped proof',async()=>{
 await assert.rejects(()=>continuationFixture({secondRpcUnknown:true}),error=>error.message==='official transport result unavailable'&&error.executionStopped===false);
});

test('send_dm keeps its original single readback-only Agent even with frozen opt-in',async()=>{
 const r=await continuationFixture({activityKey:'send_dm'});assert.equal(r.launches,1);assert.equal(r.resumes,0);assert.equal(r.turns[0].mode,'readback_only');assert.equal(r.result.status,'partial');
});

for(const ownerState of ['active','wrong_run','missing_end'])test('extra Agent requires fresh official stop proof for the exact original owner turn '+ownerState,async()=>{
 await assert.rejects(()=>continuationFixture({ownerState}),/RPC_SKILL_OWNER_TERMINATION_UNVERIFIED/);
});

test('another completed parent-session turn cannot substitute for exact parent run, but does not erase its official terminal',async()=>{
 const r=await continuationFixture({ownerState:'later_done'});assert.equal(r.launches,2);assert.equal(r.resumes,1);assert.equal(r.result.status,'completed');
});
test('missing exact parent agent.wait terminal rejects even when session is currently idle',async()=>{
 await assert.rejects(()=>continuationFixture({ownerState:'wait_missing'}),/RPC_SKILL_OWNER_TERMINATION_UNVERIFIED/);
});

test('full original official final receipt survives exact-run wait cache miss with fresh idle session',async()=>{
 const r=await continuationFixture({ownerState:'wait_missing',completeFinal:true});assert.equal(r.launches,2);assert.equal(r.resumes,1);assert.equal(r.result.status,'completed');
});
for(const ownerState of ['wrong_session','pending','missing_active'])test('owner final does not authorize continuation with wrong session, pending work or missing official fields '+ownerState,async()=>{
 await assert.rejects(()=>continuationFixture({ownerState,completeFinal:true}),/RPC_SKILL_OWNER_TERMINATION_UNVERIFIED/);
});

for(const status of ['partial','paused'])test('new collection '+status+' from the real resumed handler stops before a second Agent',async()=>{
 const r=await continuationFixture({activityKey:'collection',resumeFirst:true,businessResult:{status,comments_saved:1}});assert.equal(r.launches,1);assert.equal(r.resumes,1);assert.equal(r.result.status,'partial');
});
for(const reason of ['EACCES: forbidden resource','SOURCE_FIXED_MISMATCH','LOCK_OWNER_MISMATCH'])test('new actual resumed result policy failure cannot use Agent error to authorize another turn '+reason,async()=>{
 const r=await continuationFixture({resumeFirst:true,businessResult:{status:'failed',reason}});assert.equal(r.launches,1);assert.equal(r.resumes,1);assert.equal(r.result.status,'partial');
});
test('native evidence capability failure is retained even when child only returns an error terminal',async()=>{
 const r=await continuationFixture({phoneError:'RECORD_CAPTURE_STRATEGY_UNVERIFIED'});assert.equal(r.launches,1);assert.equal(r.resumes,0);assert.equal(r.result.status,'partial');
});

for(const ownerState of ['live_subagent','registry_active','registry_identity','registry_missing'])test('fresh official owner readback cannot hide another active or unverified child '+ownerState,async()=>{
 await assert.rejects(()=>continuationFixture({ownerState}),/RPC_SKILL_OWNER_TERMINATION_UNVERIFIED/);
});

for(const ownerState of ['code_only','model_payload'])test('code zero or model payload cannot release an unresolved original owner '+ownerState,async()=>{
 const r=await continuationFixture({ownerState});assert.equal(r.launches,1);assert.equal(r.result.status,'failed');assert.equal(r.result.execution_stopped,false);assert.equal(r.owner_pending,true);
});
