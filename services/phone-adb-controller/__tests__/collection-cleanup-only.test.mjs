import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createConnection} from 'node:net';
import {createHash} from 'node:crypto';
import {collectionFixture,vids} from './helpers/collection-recovery-fixture.mjs';
import {runWorkflow as runAdapter} from '../leadgen-runner-adapter.mjs';

test('终止仍未知时保留原始采集失败诊断，继续隔离而非清场',async()=>{
 const original={status:'partial',failures:[{reason:'RECIPIENT_EVIDENCE_FAILED'}]};let cleanups=0,recoveries=0;
 const out=await runAdapter({activities:[{key:'collection'},{key:'cleanup'}],context:{run_id:'unknown-run'},
  handlers:{collection:async()=>{throw Object.assign(Error('OLD_EXECUTION_TERMINATION_UNKNOWN'),{executionStopped:false,activityResult:original});},cleanup:async()=>{cleanups++;return {};}},
  recover:async()=>{recoveries++;},commander:async()=>({action:'steer',text:'重试'}),record:async()=>{},quarantine:async()=>({verified:true})});
 assert.equal(out.status,'failed');assert.deepEqual(out.results[0].result,original);assert.equal(out.results[0].execution_stopped,false);
 assert.equal(cleanups,0);assert.equal(recoveries,0);assert.equal(out.resource_quarantine.verified,true);
});

async function issued(t,{codeOne=false}={}){
 const f=await collectionFixture(t),load=n=>import(pathToFileURL(join(f.runtime,n)));
 const api=await load('collection-phone-scope.mjs');
 const state={nativeStopUnproven:true,currentActivity:'collection',account:'fixture-account',run:f.env.WFR_TAG,run_id:'scope-run__a1',profile:f.env.P,source_commit:'a'.repeat(40),task_id:'scope-task',budgetDeadline:Date.now()+60000};
 mkdirSync(join(f.d,'native-operations'),{recursive:true});
 const scope=await api.startCollectionPhoneScope({root:f.runtime,env:f.env,state,sourceCommit:state.source_commit,taskId:state.task_id,qualifiedVideoIds:vids});t.after(()=>scope.close());
 const argv=codeOne?['-H','127.0.0.1','-P',f.frozen.collection_phone_scope.policy.endpoint.split(':').at(-1),'-s',f.env.SERIAL,'shell','known-failure']:['version'];
 await new Promise((yes,no)=>{const s=createConnection(scope.env.WFR_COLLECTION_LEAF_SOCKET);let raw='';s.on('error',no);s.on('connect',()=>s.end(JSON.stringify({nonce:scope.env.WFR_COLLECTION_LEAF_NONCE,argv})));s.on('data',b=>raw+=b);s.on('end',()=>{try{assert.equal(JSON.parse(raw).code,codeOne?1:0);yes();}catch(e){no(e);}});});
 const failure={status:'partial',videos_processed:0,failures:[{video_id:vids[0],reason:'RECIPIENT_EVIDENCE_FAILED'}]};
 const result=await scope.finish(failure);
 const context={task_id:state.task_id,run_id:state.run_id,attempt:'a1',source_commit:state.source_commit,profile:f.env.P,serial:f.env.SERIAL,activity:'collection',owner:f.env.WFR_TAG,target:f.frozen.deployment.target,snapshot_sha256:f.frozen.snapshot_sha256,binding_id:'scope-binding'};
 return {...f,api,state,result,failure,context,load};
}

for(const codeOne of [false,true])test('真实归还code'+Number(codeOne)+'的非semantic采集失败仅允许原cleanup，保留失败且不能交Skill重采',{skip:process.platform!=='darwin'},async t=>{
 const f=await issued(t,{codeOne});
 assert.ok(f.api.collectionCleanupEvidence(f.result,f.context),'业务失败与手机请求归还是独立事实');
 assert.equal(f.api.collectionEvidenceProof(f.result,f.context),null);
 assert.equal(f.api.collectionReturnedEvidence(f.result,f.context),null,'cleanup-only不得授权Skill只读接手');
 assert.equal(f.api.collectionReturnedEvidence({...f.result,returned_phone_scope:f.result.cleanup_phone_scope},f.context),null,'改名不能升级能力');
 await assert.rejects(f.api.startCollectionReturnedScope({evidence:f.result,context:f.context,purpose:'readback'}),/AUTHORITY_INVALID/);
 const {invokeNativeActivity,runWorkflow}=await f.load('leadgen-workflow.mjs');
 let cleanups=0,recoveries=0;
 const out=await runWorkflow({activities:[{key:'collection'},{key:'cleanup'}],context:f.context,
  handlers:{collection:()=>invokeNativeActivity(async()=>f.result,f.state),cleanup:async()=>{cleanups++;f.state.currentActivity='cleanup';const s=await f.api.startCollectionReturnedScope({evidence:f.result,context:f.context,purpose:'cleanup'});await s.close();return {}; }},
  recover:async()=>{recoveries++;throw Error('禁止重采');},commander:async()=>({action:'steer',text:'重试'}),record:async()=>{},terminationUnverified:()=>f.state.nativeStopUnproven});
 assert.equal(out.status,'needs_review');assert.equal(cleanups,1);assert.equal(recoveries,0);
 assert.deepEqual(out.results[0].result.failures,f.failure.failures);
 assert.equal(out.results[0].result.execution_stopped,false,'不得把手机请求域能力改写为OS全停');
 assert.equal(f.state.executionUnknown,undefined);
 assert.equal(f.api.collectionCleanupEvidence(f.result,f.context),null,'清场只能消费一次');
});

for(const change of ['clone','result','unknown','marker','account','binding'])test('cleanup-only拒绝伪造或漂移：'+change,{skip:process.platform!=='darwin'},async t=>{
 const f=await issued(t);assert.ok(f.api.collectionCleanupEvidence(f.result,f.context));
 if(change==='clone')f.result=structuredClone(f.result);
 if(change==='result')f.result.failures[0].reason='changed';
 if(change==='unknown')f.state.executionUnknown=true;
 if(change==='marker')writeFileSync(join(f.d,'native-operations','other.unknown'),'unknown');
 if(change==='account')f.state.account='other';
 if(change==='binding'){const p=join(f.d,'run-bindings/a1.ack.json'),b=JSON.parse(readFileSync(p));b.binding.id='other';writeFileSync(p,JSON.stringify(b));}
 assert.equal(f.api.collectionCleanupEvidence(f.result,f.context),null);
 f.state.currentActivity='cleanup';await assert.rejects(f.api.startCollectionReturnedScope({evidence:f.result,context:f.context,purpose:'cleanup'}),/AUTHORITY_INVALID/);
});

test('真实102 handler失败经native适配仍留原原因，仅受管清场不重采',{skip:process.platform!=='darwin'},async t=>{
 const f=await collectionFixture(t),load=n=>import(pathToFileURL(join(f.runtime,n)));
 const ctl=join(f.runtime,'douyin-phone-adb'),js=join(f.runtime,'fixture-cleanup-controller.cjs');
 writeFileSync(js,readFileSync(ctl,'utf8').replace("case 'preflight':","case 'lock-release':console.log('lock=released owner=scope-owner');break;case 'preflight':").replace("case 'open-comments':","case 'open-comments':process.stderr.write('RECIPIENT_EVIDENCE_FAILED');process.exit(1);"),{mode:0o755});
 writeFileSync(ctl,'#!/bin/zsh\nexec '+JSON.stringify(process.execPath)+' '+JSON.stringify(js)+' "$@"\n',{mode:0o755});
 const {digest}=await load('runtime-definition.mjs');
 for(const p of [ctl,js])f.frozen.files['runtime/'+p.slice(f.runtime.length+1)]=createHash('sha256').update(readFileSync(p)).digest('hex');delete f.frozen.snapshot_sha256;f.frozen.snapshot_sha256=digest(f.frozen);writeFileSync(join(f.d,'run-definition.json'),JSON.stringify(f.frozen));
 const request=join(f.d,'run-bindings/a1.request.json'),b=JSON.parse(readFileSync(request));b.runtime_snapshot_sha256=f.frozen.snapshot_sha256;writeFileSync(request,JSON.stringify(b));
 const {createHandlers,invokeNativeActivity,runWorkflow}=await load('leadgen-workflow.mjs');
 const h=createHandlers({root:f.runtime,env:f.env,sourceCommit:'a'.repeat(40),taskId:'scope-task',rpc:async body=>({result:await f.queue(body.request)})});
 h.state.currentActivity='preflight';await h.preflight();h.state.currentActivity='qualification';await h.qualification();h.state.currentActivity='collection';h.state.budgetDeadline=Date.now()+60000;
 let cleanups=0,recoveries=0;
 const out=await runWorkflow({activities:[{key:'collection'},{key:'cleanup'}],context:{run_id:'scope-run__a1',task_id:'scope-task',source_commit:'a'.repeat(40)},
  handlers:{collection:()=>invokeNativeActivity(()=>h.collection(),h.state),cleanup:async()=>{cleanups++;h.state.currentActivity='cleanup';return invokeNativeActivity(()=>h.cleanup(),h.state);}},
  recover:async()=>{recoveries++;throw Error('不能重采');},commander:async()=>({action:'steer',text:'再试'}),record:async()=>{},terminationUnverified:()=>h.state.nativeStopUnproven});
 assert.equal(out.status,'needs_review',JSON.stringify({out,executionUnknown:h.state.executionUnknown,nativeStopUnproven:h.state.nativeStopUnproven,proof:!!h.state.collectionReturnedEvidence}));assert.equal(recoveries,0);assert.equal(cleanups,1);
 assert.match(JSON.stringify(out.results[0].result.failures),/采集未完成 code=6/);
 assert.match(readFileSync(join(f.d,'activity.log'),'utf8'),/RECIPIENT_EVIDENCE_FAILED/);
 assert.equal(out.results[0].result.execution_stopped,false);assert.equal(h.state.executionUnknown,undefined);
 assert.equal(out.results.at(-1).result.lock_released,1);
 assert.equal(f.stored.size,0);assert.equal(f.dbCalls.filter(q=>q.op==='claim_videos').length,1);
});
