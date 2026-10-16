import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {runWorkflow} from '../leadgen-workflow.mjs';

test('isolated fixture: failed Code hands exactly one Activity to Skill then independent verification',async()=>{
 const events=[];let code=0,skill=0;
 const result=await runWorkflow({activities:[{key:'scoring',retry_safe:true},{key:'mark_leads'}],context:{run_id:'fixture__a1'},
  handlers:{scoring:async()=>{code++;throw Error('fixture operation failed');},mark_leads:async()=>{events.push('mark');return {marked:1};}},
  commander:async r=>({action:r.phase==='after'&&r.evidence.status==='failed'?'retry':'continue',reason:'fixture evidence'}),record:async r=>events.push(r),
  recover:async({activity,failure})=>{assert.equal(activity.key,'scoring');assert.equal(failure.status,'failed');skill++;return {status:'completed',result:{scored:1},execution_stopped:true};},
  verify:async(a,r)=>{events.push('verify:'+a.key);return {verified:a.key!=='scoring'||r.result.scored===1};}});
 assert.equal(code,2);assert.equal(skill,1);assert.equal(result.status,'completed');
 assert.ok(events.indexOf('verify:scoring')<events.indexOf('mark'));
 assert.equal(events.filter(e=>e?.phase==='execution'&&e.evidence.status==='failed').length,2);
});

test('Skill prose cannot override independent verification; later business stays blocked',async()=>{
 let later=0;
 const r=await runWorkflow({activities:[{key:'scoring'},{key:'mark_leads'}],context:{},handlers:{scoring:async()=>{throw Error('fixture failed');},mark_leads:async()=>{later++;}},commander:async()=>({action:'continue',reason:'fixture'}),record:async()=>{},recover:async()=>({status:'completed',result:{scored:9},execution_stopped:true}),verify:async()=>({verified:false})});
 assert.equal(r.status,'failed');assert.equal(later,0);
});
for(const throwUnknown of [false,true])test('unknown child keeps resources; no cleanup or next activity '+throwUnknown,async()=>{
 let cleaned=0,later=0;
 const r=await runWorkflow({activities:[{key:'scoring'},{key:'mark_leads'},{key:'cleanup'}],context:{},handlers:{scoring:async()=>{throw Error('fixture failed');},mark_leads:async()=>{later++;},cleanup:async()=>{cleaned++;}},commander:async()=>({action:'continue',reason:'fixture'}),record:async()=>{},recover:async()=>{if(throwUnknown)throw Error('fixture transport reply lost');return {status:'failed',execution_stopped:false};}});
 assert.equal(r.status,'failed');assert.equal(cleaned,0);assert.equal(later,0);assert.equal(r.results.at(-1).status,'blocked');
});
const layouts=[['preflight','collect_videos','cleanup'],['preflight','dedup','qualification','collection','cleanup'],['scoring','mark_leads'],['preflight','send_dm','write_back','cleanup']];
for(let flow=0;flow<4;flow++)for(const target of layouts[flow])test(`isolated layout ${101+flow}/${target} never replays earlier Activity`,async()=>{
 const called=[],recovered=[];
 const r=await runWorkflow({activities:layouts[flow].map(key=>({key})),context:{},handlers:Object.fromEntries(layouts[flow].map(key=>[key,async()=>{called.push(key);if(key===target)throw Error('fixture transient');return {done:true};}])),record:async()=>{},commander:async()=>({action:'continue',reason:'fixture'}),recover:async({activity})=>{recovered.push(activity.key);return {status:'completed',result:{done:true},execution_stopped:true};},verify:async()=>({verified:true})});
 assert.equal(r.status,'completed');assert.deepEqual(called,layouts[flow]);assert.deepEqual(recovered,[target]);
});

test('actual frozen Activity budget clips workflow remaining time and never resets after Code use',async()=>{
 const {activityExecutionDeadline}=await import('../leadgen-workflow.mjs');
 const now=1800000000000,activity={key:'qualification',budget:{max_duration_s:300}},env={WF_RUN_START_TS:String(now/1000),WF_RUN_MAX_SECONDS:'2400'};
 const first=activityExecutionDeadline({activity,env,now});assert.equal(first,now+300000);
 assert.equal(activityExecutionDeadline({activity,env,now:now+120000,previous:first}),first);
 assert.equal(activityExecutionDeadline({activity,env:{...env,WF_RUN_START_TS:String(now/1000-2390)},now}),now+10000);
 assert.throws(()=>activityExecutionDeadline({activity,env:{...env,WF_RUN_MAX_SECONDS:'bad'},now}));
});

for(const kind of ['EXECUTION_OUTPUT_LIMIT','EXECUTION_DEADLINE','explicit'])test('old execution termination unknown prevents Code retry, Skill and cleanup '+kind,async()=>{
 let calls=0,skills=0,cleaned=0;
 const r=await runWorkflow({activities:[{key:'qualification',retry_safe:true},{key:'cleanup'}],context:{},handlers:{qualification:async()=>{calls++;const e=Error(kind);if(kind==='explicit')e.executionStopped=false;throw e;},cleanup:async()=>{cleaned++;}},commander:async()=>({action:'retry',reason:'fixture'}),record:async()=>{},recover:async()=>{skills++;return {status:'completed',result:{},execution_stopped:true};}});
 assert.equal(calls,1);assert.equal(skills,0);assert.equal(cleaned,0);assert.equal(r.status,'failed');assert.equal(r.results[0].execution_stopped,false);
});

for(const ok of [true,false])test('unknown execution invokes persistent quarantine and records actual acknowledgment '+ok,async()=>{
 let called=0,cleaned=0;
 const r=await runWorkflow({activities:[{key:'qualification'},{key:'cleanup'}],context:{},handlers:{qualification:async()=>{throw Error('EXECUTION_OUTPUT_LIMIT');},cleanup:async()=>{cleaned++;}},commander:async()=>({action:'continue',reason:'fixture'}),record:async()=>{},quarantine:async()=>{called++;if(!ok)throw Error('fixture quarantine receipt lost');return {verified:true,device:{verified:true},videos:[]};}});
 assert.equal(called,1);assert.equal(cleaned,0);assert.equal(r.status,'failed');assert.equal(r.resource_quarantine.verified,ok);if(!ok)assert.match(r.resource_quarantine.reason,/lost/);
});

// Names fixed by the audio producer contract; producer implementation is separately pending.
for(const name of ['RECORD_AUDIO_STRATEGY_UNSUPPORTED','RECORD_AUDIO_CAPTURE_UNAVAILABLE','RECORD_AUDIO_TRACK_UNVERIFIED','RECORD_CAPTURE_STRATEGY_UNVERIFIED','RECORD_CAPTURE_SILENT'])test('audio capability or capture-evidence gap cannot trigger Code retry or UI Skill '+name,async()=>{
 const {classifyActivityFailure}=await import('../activity-skill-recovery.mjs');
 const evidence={status:'partial',result:{failures:[{stage:'record_start',reason:name}],matched:1}};
 assert.equal(classifyActivityFailure({key:'qualification'},evidence),'blocked');
 let calls=0,skills=0,cleaned=0;
 const r=await runWorkflow({activities:[{key:'qualification',retry_safe:true},{key:'cleanup'}],context:{},handlers:{qualification:async()=>{calls++;return {status:'partial',...evidence.result};},cleanup:async()=>{cleaned++;return {safe_desktop:true};}},commander:async()=>({action:'retry',reason:'fixture'}),record:async()=>{},recover:async()=>{skills++;return {status:'completed',execution_stopped:true};}});
 assert.equal(calls,1);assert.equal(skills,0);assert.equal(cleaned,1);assert.equal(r.status,'partial');assert.equal(r.results[0].result.matched,1);
});

// Execute the actual main record adapter and the real ledger CLI; all data is isolated fixture data.
test('failed Code hands partial Skill delivery to the real ledger without a secondary status failure',()=>{
 const source=readFileSync(new URL('../leadgen-workflow.mjs',import.meta.url),'utf8');
 const statement=source.match(/const ledgerStatus=[^;]+;/)?.[0];
 assert.ok(statement,'main record adapter must remain present');
 const ledger=fileURLToPath(new URL('../ledger.mjs',import.meta.url));
 const fixtures=[
  [{status:'partial',reason:'Skill未交付当前Activity实际执行结果',execution_stopped:true,skill_receipt:{status:'ok',tool_calls:0}},'blocked'],
  [{status:'paused'},'blocked'],[{status:'skipped'},'blocked'],
  [{status:'completed',result:{status:'partial',failures:['original recording failure']}},'blocked'],
  [{status:'failed',error:'original recording failure'},'failed'],
  [{status:'failed',result:{status:'partial',failures:['original recorder failure']}},'failed'],
  [{status:'completed',result:{done:true}},'completed']
 ];
 for(const [evidence,expected] of fixtures){
  const original=structuredClone(evidence),dir=mkdtempSync(join(tmpdir(),'leadgen-ledger-fixture-'));
  try{
   const status=runInNewContext(statement+' ledgerStatus;',{r:{evidence}});
   const updated=spawnSync(process.execPath,[ledger,'set','--run-dir',dir,'--stage','qualification','--status',status,'--n','1'],{encoding:'utf8'});
   assert.equal(updated.status,0,`outer=${evidence.status}: ${updated.stderr}`);
   assert.equal(JSON.parse(readFileSync(join(dir,'ledger.json'),'utf8')).stages.qualification.status,expected);
   assert.deepEqual(evidence,original,'original failure and official child receipt must not be rewritten');
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});
