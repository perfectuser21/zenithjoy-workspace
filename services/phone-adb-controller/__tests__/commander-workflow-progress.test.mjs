import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkflow} from '../leadgen-workflow.mjs';
import {openRouterCommander} from '../activity-commander.mjs';

test('Commander sees remaining activities and final successful finish completes scoring plus marking',async()=>{
 const consulted=[];let marked=0;
 const commander=openRouterCommander({apiKey:'fixture-key',fetchImpl:async(_url,opts)=>{
  const receipt=JSON.parse(JSON.parse(opts.body).messages[1].content);consulted.push(receipt);
  const action=receipt.phase==='before'||receipt.workflow_progress?.remaining_activity_keys?.length?'continue':'finish';
  return {ok:true,json:async()=>({model:'fixture-model',choices:[{message:{content:JSON.stringify({action,reason:'根据待执行活动继续或正常收尾'})}}]})};
 }});
 const result=await runWorkflow({activities:[{key:'scoring'},{key:'mark_leads'}],context:{run_id:'new-score-progress'},
  handlers:{scoring:async()=>({scored:1}),mark_leads:async()=>{marked++;return {marked:1};}},
  commander,record:async()=>{},verify:async()=>({verified:true})});
 assert.equal(marked,1,'a completed scoring activity must still reach mark_leads');
 assert.equal(result.status,'completed');
 assert.deepEqual(consulted[1].workflow_progress.remaining_activity_keys,['mark_leads']);
 assert.deepEqual(consulted[3].workflow_progress.remaining_activity_keys,[]);
});
