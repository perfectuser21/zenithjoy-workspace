import test from 'node:test';
import assert from 'node:assert/strict';
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
