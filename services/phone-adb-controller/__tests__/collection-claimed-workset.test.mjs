import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHandlers,invokeNativeActivity,runWorkflow} from '../leadgen-workflow.mjs';
import {digest,commentSamplingInput} from '../runtime-definition.mjs';
import {judgeSteps} from '../step-judge.mjs';
import {handlerZero} from './helpers/no-comments-fixture.mjs';
import {writeAcceptedDiscoveryResult} from './helpers/discovery-handoff-fixture.mjs';
const actual=JSON.parse(readFileSync(new URL('./fixtures/claimed-workset-570b.json',import.meta.url)));
const steps=JSON.parse(readFileSync(new URL('../plans/douyin_video_processing.steps.json',import.meta.url)));
const [selected,unclaimed]=actual.source_video_ids,source='cicd2fa_101_rem3_20261025_102551',run=actual.recording.run;
function fixture(t,{verdict='rejected',claimUnknown=false,qualificationFails=false,collectionFails=false}={}){
 const home=mkdtempSync(join(tmpdir(),'claimed-workset-')),dir=join(home,'douyin_video_processing-'+run),upstream=join(home,'douyin_video_discovery-'+source);mkdirSync(dir);mkdirSync(upstream);
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const env={HOME:home,WFR_RUN_DIR:dir,WFR_RUN_ID:'douyin_video_processing-'+run,WFR_ATTEMPT:'a1',WFR_TAG:run,P:'legacy',SERIAL:'NO-REAL-DEVICE',LEADGEN_LINE:'jinuo',LEADGEN_SOURCE_RUN:source,LEADGEN_LIMIT:'1',LEADGEN_COMMENT_LIMIT:'5',QUEUED_VIDEO_COLLECTION_SECONDS:'480',WF_RUN_MAX_SECONDS:'1800',WF_BRAIN_WORKFLOW:'douyin_video_processing',OWN_ACCOUNTS_CONF:join(home,'own.json')};
 for(const [path,cap,tag]of[[dir,'douyin_video_processing',run],[upstream,'douyin_video_discovery',source]]){
  const f={files:{},deployment:{source_commit:'a'.repeat(40)},run_identity:{capability:cap,tag,profile:'legacy'},...(path===dir?{sampling_input:commentSamplingInput(env)}:{})};writeFileSync(join(path,'run-definition.json'),JSON.stringify({...f,snapshot_sha256:digest(f)}));
 }
 const videos=actual.source_video_ids.map(videoId=>({videoId,author:'原真实来源作者',videoUrl:'https://www.douyin.com/video/'+videoId}));writeFileSync(join(upstream,'discovery-progress.json'),JSON.stringify({run:source,profile:'legacy',videos,captures:videos}));writeAcceptedDiscoveryResult(upstream,{source,profile:'legacy',sha:'a'.repeat(40)});writeFileSync(env.OWN_ACCOUNTS_CONF,JSON.stringify({nicknames:[],ids:[]}));mkdirSync(join(home,'.config/openclaw'),{recursive:true});writeFileSync(join(home,'.config/openclaw/douyin-account-routes.tsv'),'legacy\t44997267357\n');
 const calls=[],actions=[],stored=[];const row={video_id:selected,video_url:'https://www.douyin.com/video/'+selected,judgment_status:'pending'};
 const rpc=async body=>{const q=body.request;calls.push(q);switch(q.op){
  case 'company_config':return {result:actual.company};
  case 'inspect_videos':return {result:q.video_ids.map(video_id=>({video_id,line_key:'jinuo',judgment_status:video_id===selected?verdict:'pending',process_status:stored.includes(video_id)?'评论已采':'待判定',harvest_batch:source}))};
  case 'claim_videos':assert.equal(q.limit,1);assert.deepEqual(q.video_ids,[selected,unclaimed]);if(claimUnknown)throw Error('CLAIM_RECEIPT_UNKNOWN');return {result:[row]};
  case 'comment_history':return {result:{version:1,status:'verified',line:'jinuo',line_key:'jinuo',run,source_run:source,video_id:selected,video_url:row.video_url,rows:[]}};
  case 'collect':stored.push(q.video_id);return {result:{comments:0,inserted:0,history_verified:0,coverage:0}};
  case 'comment_history_readback':return {result:{video_id:selected,verified:true,ids:[],history_verified:0}};
  case 'sample_readback':return {result:{video_id:selected,video_url:row.video_url,verified:true,coverage:0,rows:[]}};
  default:return {result:{}};
 }};
 const execute=async(command,args,opts)=>{actions.push({command,args});if(args[0]===join(dir,'adb-existing-route.py'))return {code:0,stdout:'5042',stderr:''};if(args.at(-1)==='get-state')return {code:0,stdout:'device',stderr:''};
  if(args[0]===join(dir,'process-queued-video.sh')){
   if(args[1]==='qualification'){
    if(qualificationFails)throw Error('EXECUTION_DEADLINE');
    writeFileSync(join(dir,`${run}-identity-${selected}.json`),JSON.stringify({verified:true,
     expected_video_id:selected,observed_video_id:selected,content_type:'video',excluded_non_video:false,
     evidence_id:`${run}-v${selected}-qualification-identity`}),{mode:0o600});
    writeFileSync(join(dir,`${run}-recording-${selected}.json`),JSON.stringify(actual.recording));
    return {code:0,stdout:`QUAL\t${selected}\t${verdict}\t${actual.reason}\n`,stderr:''};
   }
   assert.equal(args[1],'collection');if(collectionFails)throw Error('EXECUTION_DEADLINE');handlerZero(dir,run,selected);return {code:0,stdout:`COLLECTION\t${selected}\tno_comments\t0\nRESCAN\t${selected}\t0\nAVATAR_RECOVERY\t${selected}\t0\n`,stderr:''};
  }
  if(args.includes('telephony.registry'))return {code:0,stdout:'mCallState=0',stderr:''};
  const cmd=args[2]==='--lock-owner'?args[4]:args[2];
  return {code:0,stdout:cmd==='lock-acquire'?'lock=acquired':cmd==='lock-refresh'?'lock=refreshed':cmd==='lock-release'?'lock=released':cmd==='account-current'?'douyin_id=44997267357':'serial=NO-REAL-DEVICE\nforeground=launcher\n',stderr:''};
 };
 const centralLease={held:false,async verifyTask(){},async acquire(){this.held=true;},async ensure(){},async release(){this.held=false;return true;}};
 const h=createHandlers({root:dir,env,rpc,execute,sourceCommit:'a'.repeat(40),taskId:'fixture-task',centralLease});h.state.budgetDeadline=Date.now()+1800000;
 return {home,dir,env,h,calls,actions,stored};
}
async function prepare(f){f.h.state.currentActivity='preflight';await f.h.preflight();await f.h.dedup();f.h.state.currentActivity='qualification';return f.h.qualification();}
function emptyCheck(f,value){
 assert.equal(value.comments,0);assert.equal(value.videos_processed,0);assert.equal(value.history_required_count,0);assert.equal(value.history_scope_verified,0);assert.equal(value.history_consumption_readback,0);assert.equal(value.history_verified,0);assert.equal(value.sampling_required_count,0);assert.equal(value.sampling_readback_count,0);assert.equal(readFileSync(join(f.dir,'comments.tsv'),'utf8'),'');
 const step=steps.steps.find(s=>s.key.endsWith('.resolve_profile_link'));const checked=judgeSteps({spec:{steps:[step]},stage:'collection',ctx:{metrics:value,tsvFile:join(f.dir,'comments.tsv'),runDir:f.dir,word:''}});assert.equal(checked.steps[0].observed,0);assert.equal(checked.steps[0].pass,true);
}

test('570b真实2VID intake/claimlimit1/v14 rejected0：未领VID不制造虚partial或终止unknown',async t=>{
 const f=fixture(t);assert.equal((await prepare(f)).matched,0);assert.equal(f.h.state.nativeStopUnproven,true);const before=f.actions.length;f.h.state.currentActivity='collection';const out=await invokeNativeActivity(()=>f.h.collection(),f.h.state);
 emptyCheck(f,out);assert.equal(out.status,undefined);assert.deepEqual(out.failures,[]);assert.notEqual(f.h.state.executionUnknown,true);assert.equal(f.actions.length,before,'无合格输入不能建立scope或新增手机动作');assert.equal(out.execution_stopped,undefined,'不伪OS全停');
});
test('570b空批正常0=0后走原本人cleanup，不把它计为正向评论采集',async t=>{
 const f=fixture(t);await prepare(f);let cleanup=0;const result=await runWorkflow({activities:[{key:'collection',retry_safe:false},{key:'cleanup'}],context:{},handlers:{collection:()=>{f.h.state.currentActivity='collection';return invokeNativeActivity(()=>f.h.collection(),f.h.state)},cleanup:()=>{cleanup++;f.h.state.currentActivity='cleanup';return invokeNativeActivity(()=>f.h.cleanup(),f.h.state)}},commander:async()=>({action:'continue'}),verify:async(a,e)=>{if(a.key==='collection')emptyCheck(f,e.result);return {verified:true}},record:async()=>{},terminationUnverified:()=>f.h.state.nativeStopUnproven===true,quarantine:async()=>({verified:true})});
 assert.equal(result.status,'completed');assert.equal(cleanup,1);assert.equal(result.results[0].result.comments,0);assert.equal(result.results[1].result.lock_released,1);assert.equal(f.calls.filter(q=>q.op==='claim_videos').length,1);assert.ok(f.actions.some(x=>x.args.includes('close-app')));assert.ok(f.actions.some(x=>x.args.includes('lock-release')));
});
test('已领取唯一合格VID实际完成，不因旁未领输入变partial',async t=>{
 const f=fixture(t,{verdict:'matched'});assert.equal((await prepare(f)).matched,1);
 const progress=JSON.parse(readFileSync(join(f.dir,`${run}-qualification-progress.json`)));
 const sha256=progress.videos.find(v=>v.video_id===selected)?.identity_snapshot_sha256;
 const {readQualificationIdentitySnapshot}=await import('../qualification-identity-snapshot.mjs');
 assert.equal(readQualificationIdentitySnapshot({dir:f.dir,run,videoId:selected,sha256}).identity.observed_video_id,selected);
 f.h.state.currentActivity='collection';const out=await invokeNativeActivity(()=>f.h.collection(),f.h.state);assert.deepEqual(f.stored,[selected]);assert.equal(out.videos_processed,1);assert.equal(out.status,undefined);assert.deepEqual(out.failures,[]);assert.notEqual(f.h.state.executionUnknown,true);assert.equal(f.calls.filter(q=>q.op==='claim_videos').length,1);
});
for(const kind of ['claim_unknown','qualification_deadline','claimed_collection_deadline'])test('真正本run未完成仍拒：'+kind,async t=>{
 const f=fixture(t,{verdict:'matched',claimUnknown:kind==='claim_unknown',qualificationFails:kind==='qualification_deadline',collectionFails:kind==='claimed_collection_deadline'});f.h.state.currentActivity='preflight';await f.h.preflight();await f.h.dedup();let collection=0;
 const result=await runWorkflow({activities:[{key:'qualification',retry_safe:false},{key:'collection',retry_safe:false},{key:'cleanup'}],context:{},handlers:Object.fromEntries(['qualification','collection','cleanup'].map(key=>[key,()=>{if(key==='collection')collection++;f.h.state.currentActivity=key;return invokeNativeActivity(()=>f.h[key](),f.h.state)}])),commander:async()=>({action:'continue'}),verify:async()=>({verified:true}),record:async()=>{},terminationUnverified:()=>f.h.state.nativeStopUnproven===true,quarantine:async()=>({verified:true})});
 assert.equal(result.status,'failed');assert.equal(f.stored.length,0);assert.equal(f.calls.filter(q=>q.op==='claim_videos').length,1);if(kind!=='claimed_collection_deadline')assert.equal(collection,0);assert.ok(result.results.some(x=>['partial','failed'].includes(x.status)));assert.equal(f.h.state.executionUnknown,true);
});
