import test from 'node:test';
import assert from 'node:assert/strict';

test('caller true或序列化JSON不能成为collection phone authority能力',async()=>{
 const {collectionPhoneProofValid}=await import('../collection-phone-scope.mjs');
 for(const proof of [true,{verified:true},{protocol:'collection-phone-scope-v1',execution_stopped:true},JSON.parse('{"phone_authority_returned":true}')])assert.equal(collectionPhoneProofValid(proof),false);
});

import {collectionFixture,vids} from './helpers/collection-recovery-fixture.mjs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {writeFileSync,mkdirSync,readFileSync,symlinkSync} from 'node:fs';

async function recoveryCase(t,mutation){
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
 const {collectionPhoneProofValid,consumeCollectionPhoneProof}=await load('collection-phone-scope.mjs');
 const proofContext={task_id:'scope-task',run_id:'scope-run__a1',attempt:'a1',source_commit:'a'.repeat(40),profile:f.env.P,serial:f.env.SERIAL,activity:'collection',owner:f.env.WFR_TAG,target:f.frozen.deployment.target,deadline_ms:handlers.state.budgetDeadline,snapshot_sha256:f.frozen.snapshot_sha256,binding_id:'scope-binding'};
 const recover=createActivityRecovery({runDir:f.d,frozen:f.frozen,binding:{id:'scope-binding',run_id:'scope-run__a1',task_id:'scope-task'},env:f.env,handlers,rpc});
 const result=await runWorkflow({activities:[{key:'collection',retry_safe:false}],context:{run_id:'scope-run__a1',task_id:'scope-task',source_commit:'a'.repeat(40)},handlers:{collection:async()=>{const value=await invokeNativeActivity(()=>handlers.collection(),handlers.state);assert.equal(collectionPhoneProofValid(value.recovery_phone_scope,proofContext),true,'反例注入前须真的从完整原生leaf取得能力');for(const key of Object.keys(proofContext))assert.equal(collectionPhoneProofValid(value.recovery_phone_scope,{...proofContext,[key]:'other'}),false,'跨'+key+'必须拒绝');assert.equal(collectionPhoneProofValid(value.recovery_phone_scope),false,'缺context不可准入');await mutation?.({f,handlers,value});return value;}},recover,commander:async()=>({action:'continue'}),record:async()=>{},verify:async(_a,e)=>{verified++;return {verified:e.result.videos_processed===2};}});
 assert.equal(f.stored.has(vids[0]),true,'必须先完成首VID真实原脚本和PG边界，不把setup失败当RED '+JSON.stringify(result));
 if(mutation){assert.equal(launches,0,'变化/污染后不得启动Skill');assert.notEqual(result.status,'completed');return;}
 assert.equal(launches,1,'必须真实进入Skill，不能0调用却称接管成功');assert.equal(result.status,'completed');assert.equal(verified,1);
 assert.equal(f.dbCalls.filter(q=>q.op==='claim_videos').length,1);
 assert.equal(f.phoneCalls().filter(q=>q.cmd==='open-video'&&q.args[0]===vids[0]&&q.args[1].includes('-collection-')).length,1,'已成功VID不得重新操作手机');
 assert.equal(handlers.state.nativeStopUnproven,true);
 assert.equal(result.results[0].code_failure.result.execution_stopped,false);
 const proof=result.results[0].code_failure.result.recovery_phone_scope;assert.equal(consumeCollectionPhoneProof(proof,proofContext),false,'已消费能力不可二次使用');assert.equal(collectionPhoneProofValid(structuredClone(proof),proofContext),false,'序列化副本无能力');
}
test('真实invoke→runActivity→原broker→原slotresume：成功VID不重跑且原OS收据仍unknown',{skip:process.platform!=='darwin'},t=>recoveryCase(t));


const mutations=[
 ['先前unknown不能被成功清洗',({handlers})=>{handlers.state.executionUnknown=true;}],
 ['新增实际执行使能力失效',async({handlers})=>{await handlers.handoffPhone('status');}],
 ['原attempt改变拒绝消费',({f})=>{f.env.WFR_ATTEMPT='a2';}],
 ['冻结快照改变拒绝消费',({f})=>{writeFileSync(join(f.d,'run-definition.json'),'{}');}],
 ['受管录音活跃拒绝消费',({f})=>{const d=f.frozen.collection_phone_scope.evidence_root;mkdirSync(d,{recursive:true});writeFileSync(join(d,'active.rec.pid'),String(process.pid));}],
 ['证据目录软链不能冒不存在静止',({f})=>{const d=f.frozen.collection_phone_scope.evidence_root;mkdirSync(join(d,'..'),{recursive:true});symlinkSync(join(f.d,'missing-recorder-dir'),d);}],
 ['既有内层unknown标记不能被正常叶子洗白',({f})=>{writeFileSync(join(f.d,'native-operations','prior.unknown'),'unknown');}],
 ['原消费者source不符拒绝消费',({f})=>{f.frozen.deployment.source_commit='b'.repeat(40);}],
 ['原消费者profile不符拒绝消费',({f})=>{f.env.P='other-profile';}],
 ['合法能力不能洗白code7预算失败',({value})=>{value.failures=[{video_id:vids[1],code:7,reason:'采集在预算或停止边界结束'}];}],
 ['合法能力不能洗白ACCOUNT或CONTRACT政策失败',({value})=>{value.failures=[{video_id:vids[1],reason:'ACCOUNT_IDENTITY_MISMATCH CONTRACT_INVALID'}];}],
 ['合法能力不能洗白未领取余量',({handlers})=>{handlers.state.remainingVideoIds=['7999999999999999999'];}],
 ['caller伪能力不能替换真正能力',({value})=>{value.recovery_phone_scope={verified:true,execution_stopped:true};}],
];
for(const [name,mutation] of mutations)test('完整恢复门反例：'+name,{skip:process.platform!=='darwin'},t=>recoveryCase(t,mutation));
