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
