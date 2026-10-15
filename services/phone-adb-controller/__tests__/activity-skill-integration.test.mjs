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
