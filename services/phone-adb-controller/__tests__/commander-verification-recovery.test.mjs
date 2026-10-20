import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkflow} from '../leadgen-workflow.mjs';

test('产出核验失败由原任务接手，修复核验通过后继续剩余活动',async()=>{
 const calls=[],records=[];
 const context={run_id:'same-run',task_id:'same-task'};
 const result=await runWorkflow({context,
  activities:[{key:'qualification'},{key:'collection'},{key:'cleanup'}],
  handlers:{qualification:async()=>({artifact:'wrong'}),collection:async()=>{calls.push('collection');return {};},cleanup:async()=>{calls.push('cleanup');return {};}},
  commander:async receipt=>{calls.push(`${receipt.activity}:${receipt.phase}`);return {action:'continue',reason:'继续完成原任务'};},
  record:async receipt=>records.push(receipt),
  verify:async(activity,evidence)=>({verified:activity.key!=='qualification'||evidence.result.artifact==='correct',reason:'实际产出核验'}),
  recover:async request=>{
   calls.push('skill');assert.equal(request.context.run_id,context.run_id);assert.equal(request.context.task_id,context.task_id);
   assert.equal(request.activity.key,'qualification');assert.equal(request.failure.verification.verified,false);
   return {status:'completed',execution_stopped:true,result:{artifact:'correct'}};
  }});
 assert.equal(result.status,'completed');
 assert.equal(calls.filter(x=>x==='skill').length,1);
 assert.ok(calls.indexOf('skill')<calls.indexOf('collection'));
 assert.ok(calls.includes('cleanup'));
 assert.equal(result.results[0].verification.verified,true);
 assert.ok(records.some(r=>r.phase==='verification'&&r.evidence.code_failure));
});

test('采样partial策略阻断后核验失败不能转成repair再接手',async()=>{
 let recovered=0;
 const result=await runWorkflow({context:{run_id:'sample-run'},activities:[{key:'collection'},{key:'cleanup'}],
  handlers:{collection:async()=>({status:'partial',sampling_receipts:[{video_id:'fixture'}],failures:[{reason:'incomplete'}]}),cleanup:async()=>({})},
  commander:async()=>({action:'continue',reason:'保留真实部分结果'}),record:async()=>{},verify:async()=>({verified:false}),
  recover:async()=>{recovered++;const error=Error('SKILL_COLLECTION_PARTIAL_READBACK_REQUIRED');error.executionStopped=true;throw error;}});
 assert.equal(recovered,1,'原partial禁止Skill恢复的决定不能被verifyfalse抹掉');assert.equal(result.status,'failed');
});

test('Skill自报完成仍须核验，产出不符不得执行剩余业务',async()=>{
 let recovered=0,collected=0,cleaned=0;
 const result=await runWorkflow({context:{run_id:'same-run'},
  activities:[{key:'qualification'},{key:'collection'},{key:'cleanup'}],
  handlers:{qualification:async()=>({artifact:'wrong'}),collection:async()=>{collected++;return {};},cleanup:async()=>{cleaned++;return {};}},
  commander:async()=>({action:'continue',reason:'处理原任务'}),record:async()=>{},
  verify:async activity=>({verified:activity.key==='cleanup'}),
  recover:async()=>{recovered++;return {status:'completed',execution_stopped:true,result:{artifact:'still-wrong'}};}});
 assert.equal(recovered,1);assert.equal(collected,0);assert.equal(cleaned,1);assert.equal(result.status,'failed');
});
