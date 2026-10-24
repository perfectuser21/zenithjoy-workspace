import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {collectionFixture,vids} from './helpers/collection-recovery-fixture.mjs';
const originalSpec=JSON.parse(readFileSync(new URL('./fixtures/collection-returned-35f/verification-spec.json',import.meta.url)));

for(const readbackFails of [false,true])test('真实Code已提交→35f后验失败→'+(readbackFails?'只读失败仍':'只读成功后')+'本人受管cleanup，原FAIL不变',{skip:process.platform!=='darwin'},async t=>{
 const f=await collectionFixture(t);const load=name=>import(pathToFileURL(join(f.runtime,name)));
 // 仅补隔离controller的本人释放回执；所有真实handler/exec/leaf/broker保持原路径。
 const ctl=join(f.runtime,'douyin-phone-adb'),js=join(f.runtime,'fixture-returned-controller.cjs');
 writeFileSync(js,readFileSync(ctl,'utf8').replace("case 'preflight':",`case 'status':if(${readbackFails})process.exit(1);break;case 'lock-release':console.log('lock=released owner=scope-owner');break;case 'preflight':`),{mode:0o755});
 writeFileSync(ctl,'#!/bin/zsh\nexec '+JSON.stringify(process.execPath)+' '+JSON.stringify(js)+' "$@"\n',{mode:0o755});
 const {digest}=await load('runtime-definition.mjs');f.frozen.files['runtime/fixture-returned-controller.cjs']=createHash('sha256').update(readFileSync(js)).digest('hex');f.frozen.files['runtime/douyin-phone-adb']=createHash('sha256').update(readFileSync(ctl)).digest('hex');delete f.frozen.snapshot_sha256;f.frozen.snapshot_sha256=digest(f.frozen);writeFileSync(join(f.d,'run-definition.json'),JSON.stringify(f.frozen));const br=join(f.d,'run-bindings/a1.request.json'),b=JSON.parse(readFileSync(br));b.runtime_snapshot_sha256=f.frozen.snapshot_sha256;writeFileSync(br,JSON.stringify(b));
 const {createHandlers}=await load('leadgen-handlers.mjs'),{invokeNativeActivity,runWorkflow}=await load('leadgen-workflow.mjs'),{createActivityRecovery}=await load('activity-skill-recovery.mjs'),{callActivityTool}=await load('activity-skill-tool.mjs'),{judgeSteps}=await load('step-judge.mjs');
 let launches=0,cleanupCalls=0,verifyCalls=0;const queue=async q=>{const r=await f.queue(q);return q.op==='claim_videos'?r.slice(0,1):r;};
 const rpc=async body=>{if(body.kind==='activity_skill_authority')return {authorized:true};if(body.kind==='activity_skill'){launches++;assert.equal(body.request.mode,'readback_only');await callActivityTool(body.request.broker_request_path,'inspect');await assert.rejects(callActivityTool(body.request.broker_request_path,'resume'),/SKILL_RESUME_NOT_ALLOWED/);const read=callActivityTool(body.request.broker_request_path,'phone',{command:'status',args:[]});if(readbackFails)await assert.rejects(read,/动作失败/);else await read;return {result:{status:'ok',execution_stopped:true}};}return {result:await queue(body.request)};};
 const h=createHandlers({root:f.runtime,env:f.env,sourceCommit:'a'.repeat(40),taskId:'scope-task',rpc});h.state.currentActivity='preflight';await h.preflight();h.state.currentActivity='qualification';assert.equal((await h.qualification()).matched,1);h.state.currentActivity='collection';h.state.budgetDeadline=Date.now()+60000;
 const context={run_id:'scope-run__a1',task_id:'scope-task',source_commit:'a'.repeat(40)},binding={id:'scope-binding',run_id:context.run_id,task_id:context.task_id};
 const recover=createActivityRecovery({runDir:f.d,frozen:f.frozen,binding,env:f.env,handlers:h,rpc});
 const out=await runWorkflow({activities:[{key:'collection',retry_safe:false},{key:'cleanup'}],context,handlers:{collection:()=>invokeNativeActivity(()=>h.collection(),h.state),cleanup:async()=>{cleanupCalls++;h.state.currentActivity='cleanup';return invokeNativeActivity(()=>h.cleanup(),h.state);}},recover,commander:async()=>({action:'continue'}),record:async()=>{},verify:async(a,e)=>{if(a.key==='cleanup')return {verified:true};verifyCalls++;assert.equal(e.result.videos_processed,1);const v=judgeSteps({spec:originalSpec,stage:'collection',ctx:{metrics:e.result,tag:f.env.WFR_TAG,evidenceDir:join(f.d,'phone/evidence',f.env.P),runDir:f.d,tsvFile:join(f.d,'comments.tsv')}});assert.equal(v.steps.length,2);assert.ok(v.steps.every(s=>s.pass===false),'真实35f两Step缺panel/screen必须仍拒');return {verified:false,step_dod:[v]};},terminationUnverified:()=>h.state.nativeStopUnproven===true,quarantine:async()=>({verified:true})});
 assert.equal(f.stored.has(vids[0]),true,'先证明真实Code已提交首VID');assert.equal(verifyCalls,1);assert.equal(out.status,'failed','只读/cleanup不能将业务FAIL洗绿');assert.equal(launches,1,JSON.stringify({out,unknown:h.state.executionUnknown,returned:!!h.state.collectionReturnedEvidence}));assert.equal(cleanupCalls,1,'只读收尾后须走原cleanup');assert.equal(f.dbCalls.filter(q=>q.op==='claim_videos').length,1);assert.equal(f.phoneCalls().filter(q=>q.cmd==='open-video'&&q.args[0]===vids[0]&&q.args[1].includes('-collection-')).length,1);
 const scopes=readdirSync(join(f.d,'collection-phone-scopes'));assert.equal(scopes.length,3,'collection/readback/cleanup必须各自有真实受管producer，不能裸phone');
 for(const dir of scopes){const files=readdirSync(join(f.d,'collection-phone-scopes',dir)).filter(x=>x.endsWith('.jsonl'));assert.equal(files.length,1);const events=readFileSync(join(f.d,'collection-phone-scopes',dir,files[0]),'utf8').trim().split('\n').map(JSON.parse);assert.ok(events.some(x=>x.phase==='exit'));assert.ok(events.every(x=>x.boundary==='darwin-sandbox-deny-process-fork-v1'));}
 const receipts=readdirSync(join(f.d,'native-operations')).filter(x=>x.endsWith('.json')).map(x=>JSON.parse(readFileSync(join(f.d,'native-operations',x))));assert.ok(receipts.length>0);assert.ok(receipts.every(x=>x.process_coverage==='observed_only'&&x.execution_stopped===false),'受限phone能力不能把OS收据洗成全停');
});

// 真实issuer+n fork受限leaf；不是caller自报returned布尔。
import {createConnection} from 'node:net';
for(const mode of ['clone','digest','unknown','marker','account','owner','run','source','attempt','binding','recorder','directory','replay-purpose','cleanup-only','readback-unknown'])test('returned capability拒绝：'+mode,{skip:process.platform!=='darwin'},async t=>{
 const f=await collectionFixture(t),load=n=>import(pathToFileURL(join(f.runtime,n)));
 const {startCollectionPhoneScope,collectionReturnedEvidence,startCollectionReturnedScope}=await load('collection-phone-scope.mjs');
 const state={currentActivity:'collection',account:'fixture-account',run:'scope-owner',run_id:'scope-run__a1',profile:f.env.P,source_commit:'a'.repeat(40),task_id:'scope-task',budgetDeadline:Date.now()+60000};
 mkdirSync(join(f.d,'native-operations'),{recursive:true});
 const scope=await startCollectionPhoneScope({root:f.runtime,env:f.env,state,sourceCommit:state.source_commit,taskId:state.task_id,qualifiedVideoIds:vids});t.after(()=>scope.close());
 await new Promise((resolve,reject)=>{const s=createConnection(scope.env.WFR_COLLECTION_LEAF_SOCKET);let out='';s.on('error',reject);s.on('connect',()=>s.end(JSON.stringify({nonce:scope.env.WFR_COLLECTION_LEAF_NONCE,argv:['version']})));s.on('data',b=>out+=b);s.on('end',()=>{try{assert.equal(JSON.parse(out).code,0);resolve();}catch(e){reject(e);}});});
 let value=await scope.finish({status:'ok',videos_processed:1,failures:[]});
 const context={task_id:'scope-task',run_id:'scope-run__a1',attempt:'a1',source_commit:'a'.repeat(40),profile:f.env.P,serial:f.env.SERIAL,activity:'collection',owner:f.env.WFR_TAG,target:f.frozen.deployment.target,snapshot_sha256:f.frozen.snapshot_sha256,binding_id:'scope-binding'};
 assert.ok(collectionReturnedEvidence(value,context),'变更前必须真实取得能力');
 if(mode==='clone')value=structuredClone(value);
 if(mode==='digest')value.videos_processed=2;
 if(mode==='unknown')state.executionUnknown=true;
 if(mode==='marker'){mkdirSync(join(f.d,'native-operations'),{recursive:true});writeFileSync(join(f.d,'native-operations','old.unknown'),'unknown');}
 if(mode==='account')state.account='different';
 if(mode==='owner')f.env.WFR_TAG='different';
 if(mode==='run')state.run_id='different__a1';
 if(mode==='source')state.source_commit='b'.repeat(40);
 if(mode==='attempt')f.env.WFR_ATTEMPT='a2';
 if(mode==='binding'){const p=join(f.d,'run-bindings/a1.ack.json'),b=JSON.parse(readFileSync(p));b.binding.id='different';writeFileSync(p,JSON.stringify(b));}
 if(mode==='recorder'){mkdirSync(f.frozen.collection_phone_scope.evidence_root,{recursive:true});writeFileSync(join(f.frozen.collection_phone_scope.evidence_root,'live.rec.pid'),String(process.pid));}
 if(mode==='directory'){mkdirSync(join(f.d,'phone/evidence'),{recursive:true});symlinkSync(join(f.d,'missing'),f.frozen.collection_phone_scope.evidence_root);}
 if(mode==='cleanup-only'){
  state.currentActivity='cleanup';const cleanup=await startCollectionReturnedScope({evidence:value,context,purpose:'cleanup'});await cleanup.close();assert.equal(collectionReturnedEvidence(value,context),null);return;
 }
 if(mode==='readback-unknown'){
  const read=await startCollectionReturnedScope({evidence:value,context,purpose:'readback'});
  await new Promise((resolve,reject)=>{const s=createConnection(read.env.WFR_COLLECTION_LEAF_SOCKET);s.on('error',reject);s.on('data',()=>{});s.on('connect',()=>s.end(JSON.stringify({nonce:'forged',argv:['version']})));s.on('end',resolve);});
  await assert.rejects(read.close(),/COLLECTION_RETURNED_DRAIN_UNVERIFIED/);assert.equal(state.executionUnknown,true);
  state.currentActivity='cleanup';assert.equal(collectionReturnedEvidence(value,context),null);await assert.rejects(startCollectionReturnedScope({evidence:value,context,purpose:'cleanup'}),/AUTHORITY_INVALID/);return;
 }
 if(mode==='replay-purpose'){
  for(const key of ['task_id','run_id','attempt','source_commit','profile','serial','owner','target','snapshot_sha256','binding_id'])await assert.rejects(startCollectionReturnedScope({evidence:value,context:{...context,[key]:'other'},purpose:'readback'}),/AUTHORITY_INVALID/);
  await assert.rejects(startCollectionReturnedScope({evidence:value,context,purpose:'resume'}),/AUTHORITY_INVALID/);
  const read=await startCollectionReturnedScope({evidence:value,context,purpose:'readback'});await read.close();await assert.rejects(startCollectionReturnedScope({evidence:value,context,purpose:'readback'}),/AUTHORITY_INVALID/);
  state.currentActivity='cleanup';const cleanup=await startCollectionReturnedScope({evidence:value,context,purpose:'cleanup'});await cleanup.close();assert.equal(collectionReturnedEvidence(value,context),null);await assert.rejects(startCollectionReturnedScope({evidence:value,context,purpose:'cleanup'}),/AUTHORITY_INVALID/);return;
 }
 assert.equal(collectionReturnedEvidence(value,context),null,'污染/漂移后不能启动只读或cleanup');
 await assert.rejects(startCollectionReturnedScope({evidence:value,context,purpose:'readback'}),/AUTHORITY_INVALID/);
});
