import test from 'node:test';
import assert from 'node:assert/strict';

test('caller true或序列化JSON不能成为collection phone authority能力',async()=>{
 const {collectionPhoneProofValid}=await import('../collection-phone-scope.mjs');
 for(const proof of [true,{verified:true},{protocol:'collection-phone-scope-v1',execution_stopped:true},JSON.parse('{"phone_authority_returned":true}')])assert.equal(collectionPhoneProofValid(proof),false);
});

import {collectionFixture,vids,saveCollectionFailure} from './helpers/collection-recovery-fixture.mjs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {writeFileSync,mkdirSync,readFileSync,symlinkSync} from 'node:fs';

async function recoveryCase(t,mutation,options={}){
 const f=await collectionFixture(t,options);try{return await runRecoveryCase(t,mutation,options,f);}catch(error){const path=saveCollectionFailure(f,{error:{message:error.message,stack:error.stack},...f.diagnostics});t.diagnostic('collection_failure_evidence='+path);throw error;}
}
async function runRecoveryCase(t,mutation,options,f){
 const load=name=>import(pathToFileURL(join(f.runtime,name)));
 const {createHandlers}=await load('leadgen-handlers.mjs'),{invokeNativeActivity,runWorkflow}=await load('leadgen-workflow.mjs'),{createActivityRecovery}=await load('activity-skill-recovery.mjs'),{callActivityTool}=await load('activity-skill-tool.mjs'),{execInput}=await load('leadgen-client.mjs');
 let launches=0,verified=0;const handlers=createHandlers({root:f.runtime,env:f.env,sourceCommit:'a'.repeat(40),taskId:'scope-task',execute:async(command,args,opts)=>{try{const result=await execInput(command,args,opts);f.executionRecords.push({command,args,result});return result;}catch(error){f.executionRecords.push({command,args,error:{message:error.message,stdout:error.stdout,stderr:error.stderr}});throw error;}},rpc:async body=>{
  if(body.kind==='activity_skill_authority')return {authorized:true};
  if(body.kind==='activity_skill'){
   launches++;await callActivityTool(body.request.broker_request_path,'inspect');await callActivityTool(body.request.broker_request_path,'phone',{command:'back-evidence',args:['scope-skill-repair']});await callActivityTool(body.request.broker_request_path,'resume');return {result:{status:'ok',execution_stopped:true}};
  }
  return {result:await f.queue(body.request)};
 }});
 handlers.state.currentActivity='preflight';f.diagnostics.preflight=await handlers.preflight();handlers.state.currentActivity='qualification';if(options.sample)handlers.state.intakeVideoIds=vids;f.diagnostics.qualification=await handlers.qualification();assert.equal(f.diagnostics.qualification.matched,2,'资格前置必须先实际核验两VID '+JSON.stringify(f.diagnostics.qualification));assert.equal(f.diagnostics.qualification.videos_verified,2);assert.deepEqual(f.diagnostics.qualification.failures,[]);handlers.state.currentActivity='collection';handlers.state.budgetDeadline=Date.now()+90000;
 const rpc=async body=>body.kind==='activity_skill_authority'?{authorized:true}:body.kind==='activity_skill'?(launches++,await callActivityTool(body.request.broker_request_path,'inspect'),await callActivityTool(body.request.broker_request_path,'phone',{command:'back-evidence',args:['scope-skill-repair']}),await callActivityTool(body.request.broker_request_path,'resume'),{result:{status:'ok',execution_stopped:true}}):{result:await f.queue(body.request)};
 const {collectionPhoneProofValid,consumeCollectionPhoneProof}=await load('collection-phone-scope.mjs');
 const proofContext={task_id:'scope-task',run_id:'scope-run__a1',attempt:'a1',source_commit:'a'.repeat(40),profile:f.env.P,serial:f.env.SERIAL,activity:'collection',owner:f.env.WFR_TAG,target:f.frozen.deployment.target,deadline_ms:handlers.state.budgetDeadline,snapshot_sha256:f.frozen.snapshot_sha256,binding_id:'scope-binding'};
 const recover=createActivityRecovery({runDir:f.d,frozen:f.frozen,binding:{id:'scope-binding',run_id:'scope-run__a1',task_id:'scope-task'},env:f.env,handlers,rpc});
 const result=await runWorkflow({activities:[{key:'collection',retry_safe:false}],context:{run_id:'scope-run__a1',task_id:'scope-task',source_commit:'a'.repeat(40)},handlers:{collection:async()=>{const value=await invokeNativeActivity(()=>handlers.collection(),handlers.state);if(value.status==='partial'){assert.equal(collectionPhoneProofValid(value.recovery_phone_scope,proofContext),true,'反例注入前须真的从完整原生leaf取得能力');for(const key of Object.keys(proofContext))assert.equal(collectionPhoneProofValid(value.recovery_phone_scope,{...proofContext,[key]:'other'}),false,'跨'+key+'必须拒绝');assert.equal(collectionPhoneProofValid(value.recovery_phone_scope),false,'缺context不可准入');await mutation?.({f,handlers,value});}return value;}},recover,commander:async()=>({action:'continue'}),record:async()=>{},verify:async(_a,e)=>{verified++;return {verified:e.result.videos_processed===2};}});
 f.diagnostics.result=result;
 assert.equal(f.stored.has(vids[0]),true,'必须先完成首VID真实原脚本和PG边界，不把setup失败当RED '+JSON.stringify(result));
 if(mutation){assert.equal(launches,0,'变化/污染后不得启动Skill');assert.notEqual(result.status,'completed');return;}
 assert.equal(launches,1,'必须真实进入Skill，不能0调用却称接管成功');assert.equal(result.status,'completed',JSON.stringify(result));assert.equal(verified,1);
 assert.equal(f.dbCalls.filter(q=>q.op==='claim_videos').length,1);
 assert.equal(f.phoneCalls().filter(q=>q.cmd==='open-video'&&q.args[0]===vids[0]&&q.args[1].includes('-collection-')).length,1,'已成功VID不得重新操作手机');
 if(options.panelProbe){const projection=JSON.parse(readFileSync(join(f.d,'collection-acceptance-probe.consumed.json')));assert.equal(projection.projection.video_id,vids[1]);assert.equal(projection.projection.snapshot_sha256,f.frozen.snapshot_sha256);assert.deepEqual(JSON.parse(readFileSync(join(f.d,'collection-acceptance-probe.back-returned.json'))).projection,projection.projection);assert.equal(f.phoneCalls().filter(q=>q.cmd==='back-evidence'&&q.args[0].endsWith('-acceptance-close')).length,1);assert.equal(result.results[0].code_failure.result.failures[0].reason,'COLLECTION_COMMENT_PANEL_READBACK_FAILED');}
 if(options.sample){assert.equal(result.results[0].result.sampling_readback_count,2);assert.equal(result.results[0].result.sampling_receipts.length,2);}
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

test('首VID no_comments采样回执在原slot续跑中保留且不重做手机',{skip:process.platform!=='darwin'},t=>recoveryCase(t,undefined,{sample:true}));

for(const mode of ['approved-account-mismatch','missing-required-helper','invalid-recording-pid','deadline-expired'])test('真实issuer签发前拒绝：'+mode,{skip:process.platform!=='darwin'},async t=>{
 const f=await collectionFixture(t),load=name=>import(pathToFileURL(join(f.runtime,name))),{digest}=await load('runtime-definition.mjs'),{startCollectionPhoneScope}=await load('collection-phone-scope.mjs');
 if(mode==='approved-account-mismatch')f.frozen.collection_phone_scope.expected_account='44997267357';
 if(mode==='missing-required-helper')delete f.frozen.files['runtime/queued-recipient-evidence.js'];
 if(mode==='invalid-recording-pid'){const d=f.frozen.collection_phone_scope.evidence_root;mkdirSync(d,{recursive:true});writeFileSync(join(d,'invalid.rec.pid'),'not-a-pid');}
 delete f.frozen.snapshot_sha256;f.frozen.snapshot_sha256=digest(f.frozen);writeFileSync(join(f.d,'run-definition.json'),JSON.stringify(f.frozen));
 const request=join(f.d,'run-bindings/a1.request.json'),value=JSON.parse(readFileSync(request));value.runtime_snapshot_sha256=f.frozen.snapshot_sha256;writeFileSync(request,JSON.stringify(value));
 await assert.rejects(startCollectionPhoneScope({root:f.runtime,env:f.env,state:{currentActivity:'collection',account:'different-account',budgetDeadline:Date.now()+(mode==='deadline-expired'?-1:30000)},sourceCommit:'a'.repeat(40),taskId:'scope-task'}),new RegExp({ 'approved-account-mismatch':'COLLECTION_PHONE_ACCOUNT_INVALID','missing-required-helper':'COLLECTION_PHONE_SOURCE_INVALID','invalid-recording-pid':'COLLECTION_MANAGED_RECORDING_UNVERIFIED','deadline-expired':'COLLECTION_PHONE_SCOPE_IDENTITY_INVALID'}[mode]));
});

test('冻结一次性验收probe通过原controller真实panel判定失败并原slot接管',{skip:process.platform!=='darwin'},t=>recoveryCase(t,undefined,{panelProbe:true}));

test('私有probe消费防重放：原binding/VID/nonce/记录缺损拒绝，合法resume不再触发',{skip:process.platform!=='darwin'},async t=>{
 const f=await collectionFixture(t,{panelProbe:true}),load=name=>import(pathToFileURL(join(f.runtime,name))),{startCollectionPhoneScope}=await load('collection-phone-scope.mjs'),{consumeCollectionAcceptanceProbe,verifyCollectionAcceptanceConsumption}=await load('collection-acceptance-probe.mjs'),{readBinding}=await load('runtime-binding.mjs');
 const scope=await startCollectionPhoneScope({root:f.runtime,env:f.env,state:{currentActivity:'collection',account:'fixture-account',budgetDeadline:Date.now()+60000},sourceCommit:'a'.repeat(40),taskId:'scope-task',qualifiedVideoIds:vids});t.after(()=>scope.close());
 const env={...f.env,...scope.env},input=scope.env.WFR_COLLECTION_ACCEPTANCE_INPUT,{spawn}=await import('node:child_process');
 const ctl=(command,eid)=>new Promise(resolve=>{const p=spawn(scope.zsh,['-f',join(f.runtime,'fixture-original-controller'),'--profile',env.P,command,eid],{env});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('close',code=>{assert.equal(code,0,err);resolve(out.trim());});});
 const opened=await ctl('ui-evidence','probe-helper-open'),args={action:'consume',videoId:vids[1],input,controllerOutput:'comments_opened=1\nevidence='+opened,env};
 for(const changed of [{...args,videoId:'7999999999999999999'},{...args,env:{...env,WFR_RUN_ID:'other'}},{...args,env:{...env,WFR_COLLECTION_LEAF_NONCE:'forged'}}])assert.throws(()=>consumeCollectionAcceptanceProbe(changed));
 assert.equal(consumeCollectionAcceptanceProbe(args),'trigger');assert.throws(()=>consumeCollectionAcceptanceProbe(args),'消费后back未归还不能当成合法resume');
 const back=await ctl('back-evidence','probe-helper-back');assert.equal(consumeCollectionAcceptanceProbe({...args,action:'back-returned',controllerOutput:back}),'back_returned');assert.equal(consumeCollectionAcceptanceProbe(args),'already_consumed');
 const binding=readBinding(f.d,'a1',f.frozen);assert.equal(verifyCollectionAcceptanceConsumption({frozen:f.frozen,binding,env}),true);
 writeFileSync(join(f.d,'collection-acceptance-probe.consumed.json'),'{}');assert.throws(()=>consumeCollectionAcceptanceProbe(args));assert.equal(verifyCollectionAcceptanceConsumption({frozen:f.frozen,binding,env}),false);
});

test('真实资格与接管在父observer同步阻塞750ms时仍由独立ADB服务响应',{skip:process.platform!=='darwin'},t=>recoveryCase(t,undefined,{blockIdentity:true}));
