// Isolated offline transport fixtures; no Gateway/model/device/DB or production run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
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
async function continuationFixture({policy={max_additional_turns:1},resumeFirst=false,parentUnknown=false,status='error',secondStatus='ok',unknownChild=false,verify=async()=>({verified:true}),afterFirst}={}){
 const d=mkdtempSync(join(tmpdir(),'handoff-continuation-'));let launches=0,resumes=0;const turns=[],directories=[];
 try{
  const name='douyin-leadgen-activity-102-qualification',path=`skills/${name}/SKILL.md`,supportPath='skills/leadgen-activity-execution.md';
  const text=readFileSync(join(sourceRoot,path),'utf8'),support=readFileSync(join(sourceRoot,supportPath),'utf8'),version=text.match(/^  version: (.+)$/m)[1];
  for(const [p,body] of [[path,text],[supportPath,support],['activity-skill-tool.mjs',readFileSync(join(sourceRoot,'activity-skill-tool.mjs'))]]){mkdirSync(dirname(join(d,'runtime',p)),{recursive:true});writeFileSync(join(d,'runtime',p),body);}
  const frozen={files:{['runtime/'+path]:hash(text),['runtime/'+supportPath]:hash(support)},snapshot_sha256:'fixture-snapshot',release:{id:'fixture-release'},deployment:{source_commit:'a'.repeat(40),target:'mmv',observation_id:'fixture-observation'},workflow_version:{id:'fixture-wv'},activities:[{reference:{slot_key:'qualification',reference_id:'fixture-ref'},version:{id:'fixture-av',payload:{contract:{...(policy===undefined?{}:{agent_recovery:policy})},definition_key:'douyin_video_processing.qualification',implementation_bindings:[{kind:'skill',name,version,path:'services/phone-adb-controller/'+path}]}}}]};
  const handlers={state:{budgetDeadline:Date.now()+60000},handoffContext:async()=>({fixture:true}),handoffHeartbeat:async()=>{},handoffPhone:async()=>({fresh:true})};
  const rpc=async input=>{
   if(input.kind==='activity_skill_authority')return {authorized:skillAuthority(input.request,{home:d,verifyWorkspace:()=>true})};
   turns.push(input.request);const turn=turns.length-1;
   return {result:await runSkillAgent(input.request,{home:d,verifyWorkspace:()=>true,execute:async(command,args)=>{
    if(command==='openclaw'){
     launches++;const dir=dirname(args[args.indexOf('--message-file')+1]);directories.push(dir);
     const request=JSON.parse(readFileSync(join(dir,'agent-request.json'),'utf8'));claimSkillSpawn(dir,{home:d,verifyWorkspace:()=>true});
     const receipt={runId:`11111111-1111-4111-8111-${String(turn+1).padStart(12,'0')}`,childSessionKey:'agent:skill-factory:subagent:fixture'+turn,resolvedProvider:'openai',resolvedModel:'gpt-6.1-sol'};
     writeFileSync(join(dir,'spawn-receipt.json'),JSON.stringify(receipt));writeFileSync(join(dir,'agent-binding.json'),JSON.stringify({...request,child_run_id:receipt.runId,child_session_key:receipt.childSessionKey}));
     const deps={home:d,authorize:async q=>skillAuthority(q,{home:d,verifyWorkspace:()=>true})};
     await relayActivityTool(dir,'inspect',{},deps);
     if(turn===0){for(let i=0;i<2;i++)await relayActivityTool(dir,'phone',{command:'native-audio-evidence',args:[]},deps);if(resumeFirst)await relayActivityTool(dir,'resume',{},deps);await afterFirst?.({handlers,request:input.request});}
     else{
      await assert.rejects(()=>relayActivityTool(directories[0],'inspect',{},deps),'old generation cannot use the live broker');
      await assert.rejects(()=>relayActivityTool(dir,'phone',{command:'native-audio-evidence',args:[]},deps),'native evidence budget is cumulative');
      if(resumeFirst){await assert.rejects(()=>relayActivityTool(dir,'resume',{},deps));await assert.rejects(()=>relayActivityTool(dir,'phone',{command:'back-evidence',args:[]},deps));}
      else await relayActivityTool(dir,'resume',{},deps);
     }
     return {code:parentUnknown&&turn===0?1:0,stdout:'official parent fixture',stderr:''};
    }
    if(unknownChild)return {code:1,stdout:'',stderr:'official terminal unavailable'};
    const binding=JSON.parse(readFileSync(join(args[2],'agent-binding.json'),'utf8'));
    writeFileSync(join(args[2],'agent-terminal.json'),JSON.stringify({runId:binding.child_run_id,status:turn===0?status:secondStatus,endedAt:Date.now(),terminalReceipt:{runId:binding.child_run_id,effective:{provider:'openai',model:'gpt-6.1-sol'}}}));return {code:0,stdout:'official exact terminal',stderr:''};
   }})};
  };
  const recover=createActivityRecovery({runDir:d,frozen,binding:{id:'fixture-binding',run_id:'fixture__a1'},env:{},handlers,rpc,verify});
  const result=await recover({activity:{key:'qualification'},failure:{status:'failed',execution_stopped:true,error:'temporary application fault'},execute:async()=>{resumes++;return {status:'completed',qualified:1};}});
  return {result,launches,resumes,turns,directories};
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
