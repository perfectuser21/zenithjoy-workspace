import test from 'node:test';
import assert from 'node:assert/strict';

test('caller true或序列化JSON不能成为collection phone authority能力',async()=>{
 const {collectionPhoneProofValid}=await import('../collection-phone-scope.mjs');
 for(const proof of [true,{verified:true},{protocol:'collection-phone-scope-v1',execution_stopped:true},JSON.parse('{"phone_authority_returned":true}')])assert.equal(collectionPhoneProofValid(proof),false);
});

import {collectionFixture,vids} from './helpers/collection-recovery-fixture.mjs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';

test('真实invoke→runActivity→原broker→原slotresume：成功VID不重跑且原OS收据仍unknown',{skip:process.platform!=='darwin'},async t=>{
 const f=await collectionFixture(t),load=name=>import(pathToFileURL(join(f.runtime,name)));
 const {createHandlers}=await load('leadgen-handlers.mjs'),{invokeNativeActivity,runWorkflow}=await load('leadgen-workflow.mjs'),{createActivityRecovery}=await load('activity-skill-recovery.mjs'),{callActivityTool}=await load('activity-skill-tool.mjs');
 let launches=0,verified=0;const handlers=createHandlers({root:f.runtime,env:f.env,sourceCommit:'a'.repeat(40),taskId:'scope-task',rpc:async body=>{
  if(body.kind==='activity_skill_authority')return {authorized:true};
  if(body.kind==='activity_skill'){
   launches++;await callActivityTool(body.request.broker_request_path,'inspect');await callActivityTool(body.request.broker_request_path,'phone',{command:'back-evidence',args:[]});await callActivityTool(body.request.broker_request_path,'resume');return {result:{status:'ok',execution_stopped:true}};
  }
  return {result:await f.queue(body.request)};
 }});
 handlers.state.currentActivity='preflight';await handlers.preflight();handlers.state.currentActivity='qualification';await handlers.qualification();handlers.state.currentActivity='collection';handlers.state.budgetDeadline=Date.now()+90000;
 const rpc=async body=>body.kind==='activity_skill_authority'?{authorized:true}:body.kind==='activity_skill'?(launches++,await callActivityTool(body.request.broker_request_path,'inspect'),await callActivityTool(body.request.broker_request_path,'phone',{command:'back-evidence',args:[]}),await callActivityTool(body.request.broker_request_path,'resume'),{result:{status:'ok',execution_stopped:true}}):{result:await f.queue(body.request)};
 const recover=createActivityRecovery({runDir:f.d,frozen:f.frozen,binding:{id:'scope-binding',run_id:'scope-run__a1',task_id:'scope-task'},env:f.env,handlers,rpc});
 const result=await runWorkflow({activities:[{key:'collection',retry_safe:false}],context:{run_id:'scope-run__a1',task_id:'scope-task',source_commit:'a'.repeat(40)},handlers:{collection:()=>invokeNativeActivity(()=>handlers.collection(),handlers.state)},recover,commander:async()=>({action:'continue'}),record:async()=>{},verify:async(_a,e)=>{verified++;return {verified:e.result.videos_processed===2};}});
 assert.equal(f.stored.has(vids[0]),true,'必须先完成首VID真实原脚本和PG边界，不把setup失败当RED');
 assert.equal(launches,1,'必须真实进入Skill，不能0调用却称接管成功');assert.equal(result.status,'completed');assert.equal(verified,1);
 assert.equal(f.dbCalls.filter(q=>q.op==='claim_videos').length,1);
 assert.equal(f.phoneCalls().filter(q=>q.cmd==='open-video'&&q.args[0]===vids[0]&&q.args[1].includes('-collection-')).length,1,'已成功VID不得重新操作手机');
 assert.equal(handlers.state.nativeStopUnproven,true);
 assert.equal(result.results[0].code_failure.result.execution_stopped,false);
});
