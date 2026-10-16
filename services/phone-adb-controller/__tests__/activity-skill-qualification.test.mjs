import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withCompanyFixture} from './company-config-fixture.mjs';
import {createHandlers as rawCreateHandlers} from '../leadgen-workflow.mjs';
const createHandlers=withCompanyFixture(rawCreateHandlers);
function native(eid){const sdkFile=eid+'.capture-sdk.txt',sdkSha='b'.repeat(64);return {capture_audio_mode:'playback_dup',capture_audio_sdk:36,capture_audio_required:true,capture_audio_verified:true,audio_streams:1,capture_audio_sdk_evidence_file:sdkFile,capture_audio_sdk_evidence_sha256:sdkSha,capture_audio_end:{mode:'playback_dup',sdk:36,required:true,sdk_evidence_file:sdkFile,sdk_evidence_sha256:sdkSha},playback_proof_kind:'native_audio',native_audio:Object.fromEntries(['start','end'].map(phase=>[phase,{state:'started',uid:10203,pid:528,piid:73615,package_uid_verified:true,foreign_started:0,...Object.fromEntries([['evidence','audio.txt'],['package_uid','package-uid.txt'],['uid_owners','uid-owners.txt']].flatMap(([k,s])=>[[k+'_file',eid+'-playback-'+phase+'.'+s],[k+'_sha256','a'.repeat(64)]]))}]))};}
test('actual createHandlers fixture: partial qualification reuses own leases, preserves success and resumes only failed VID',async()=>{
 const d=mkdtempSync(join(tmpdir(),'skill-qualification-')),run='fixture102',vids=['7646309328911907195','7646309328911907196'];let claims=0,repair=false;const calls=[];
 try{
  const h=createHandlers({root:d,env:{HOME:d,WFR_RUN_DIR:d,WFR_TAG:run,P:'fixture',SERIAL:'fixture',LEADGEN_LINE:'jinuo'},rpc:async({request:q})=>{
   if(q.op==='claim_videos'){claims++;return {result:claims===1?vids.map(video_id=>({video_id,video_url:'https://www.douyin.com/video/'+video_id,title:'fixture',judgment_status:'pending'})):[]};}
   assert.equal(q.op,'renew_video');return {result:{}};
  },execute:async(command,args,{env})=>{
   const vid=args[3];calls.push({vid,attempt:env.QUEUED_VIDEO_EVIDENCE_ATTEMPT||null});
   writeFileSync(join(d,`${run}-identity-${vid}.json`),JSON.stringify({verified:true,observed_video_id:vid,content_type:'video'}));
   if(vid===vids[1]&&!repair)return {code:5,stdout:'',stderr:'fixture native playback failed'};
   const suffix=env.QUEUED_VIDEO_EVIDENCE_ATTEMPT?'-recovery'+env.QUEUED_VIDEO_EVIDENCE_ATTEMPT:'',eid=`${run}-v${vid}-qualification${suffix}-record`;
   writeFileSync(join(d,`${run}-recording-${vid}.json`),JSON.stringify({version:2,run,video_id:vid,evidence_id:eid,media_volume_verified:true,media_volume:1,playback_verified:true,playback_package:'com.ss.android.ugc.aweme',audio_status:'usable',mean_volume_db:-20,...native(eid)}));
   return {code:0,stdout:`QUAL\t${vid}\tmatched\tjudged\n`,stderr:''};
  }});
  h.state.budgetDeadline=Date.now()+60000;
  const first=await h.qualification();assert.equal(first.status,'partial');assert.equal(first.matched,1);
  const previous=readFileSync(join(d,`${run}-recording-${vids[0]}.json`),'utf8');repair=true;
  const second=await h.qualification();assert.equal(claims,1);assert.equal(second.claimed,2);assert.equal(second.matched,2);assert.equal(second.recordings_required,2);assert.equal(second.media_volume_verified,2);assert.equal(second.recordings_unverified,0);
  assert.deepEqual(calls.map(c=>c.vid),[...vids,vids[1]]);assert.equal(calls.at(-1).attempt,'1');
  assert.equal(readFileSync(join(d,`${run}-recording-${vids[0]}.json`),'utf8'),previous);
 }finally{rmSync(d,{recursive:true,force:true});}
});
test('unknown claim receipt is not re-claimed or converted into zero-row success',async()=>{
 const d=mkdtempSync(join(tmpdir(),'skill-claim-'));let claims=0;
 try{const h=createHandlers({root:d,env:{HOME:d,WFR_RUN_DIR:d,WFR_TAG:'fixture',LEADGEN_LINE:'jinuo'},rpc:async({request:q})=>{assert.equal(q.op,'claim_videos');claims++;throw Error('fixture lost claim receipt');},execute:async()=>{throw Error('must not execute');}});
 await assert.rejects(()=>h.qualification());await assert.rejects(()=>h.qualification(),/领取.*未知/);assert.equal(claims,1);
 }finally{rmSync(d,{recursive:true,force:true});}
});

test('handoff heartbeat rejects a code-zero phone receipt for another owner',async()=>{
 const d=mkdtempSync(join(tmpdir(),'skill-heartbeat-'));let wrong=false;const registry=join(d,'accounts.tsv');writeFileSync(registry,'fixture\tfixture-account\n');
 try{const h=createHandlers({root:d,env:{HOME:d,WFR_RUN_DIR:d,WFR_TAG:'fixture-run',P:'fixture',SERIAL:'fixture-serial',LEADGEN_LINE:'jinuo',DOUYIN_ACCOUNT_REGISTRY:registry,DOUYIN_PHONE_ADB:'/fixture/controller'},rpc:async()=>({result:{}}),execute:async(cmd,args)=>{
  let stdout='';if(cmd==='adb')stdout=args.includes('get-state')?'device\n':args.includes('telephony.registry')?'mCallState=0\n':'';
  if(cmd==='/fixture/controller'){const op=args[2]==='--lock-owner'?args[4]:args[2];if(op==='preflight')stdout='serial=fixture-serial\n';if(op==='lock-acquire')stdout='lock=acquired\n';if(op==='lock-refresh')stdout=`lock=refreshed owner=${wrong?'another-run':'fixture-run'} ttl=3600s\n`;if(op==='account-current')stdout='douyin_id=fixture-account\n';}
  return {code:0,stdout,stderr:''};
 }});await h.preflight();wrong=true;await assert.rejects(()=>h.handoffHeartbeat({key:'qualification'}),/所有权|续期/);
 }finally{rmSync(d,{recursive:true,force:true});}
});

test('handoff heartbeat requires acknowledged renewal of the original video lease',async()=>{
 const d=mkdtempSync(join(tmpdir(),'skill-video-heartbeat-'));let heartbeat=false;
 try{const h=createHandlers({root:d,env:{HOME:d,WFR_RUN_DIR:d,WFR_TAG:'fixture-run',P:'fixture',LEADGEN_LINE:'jinuo'},rpc:async({request:q})=>{
  if(q.op==='claim_videos')return {result:[{video_id:'7646309328911907195',video_url:'https://www.douyin.com/video/7646309328911907195',judgment_status:'matched'}]};
  assert.equal(q.op,'renew_video');return {result:{renewed:!heartbeat}};
 },execute:async()=>({code:0,stdout:'',stderr:''})});await h.qualification();heartbeat=true;await assert.rejects(()=>h.handoffHeartbeat({key:'qualification'}),/租约/);
 }finally{rmSync(d,{recursive:true,force:true});}
});

test('actual qualification partial retains old execution unknown and cannot hand over or release original lease',async()=>{
 const {runWorkflow}=await import('../leadgen-workflow.mjs');const d=mkdtempSync(join(tmpdir(),'skill-old-execution-'));let released=0,skills=0;
 try{const h=createHandlers({root:d,env:{HOME:d,WFR_RUN_DIR:d,WFR_TAG:'fixture',P:'fixture',LEADGEN_LINE:'jinuo'},rpc:async({request:q})=>{
  if(q.op==='claim_videos')return {result:[{video_id:'7646309328911907195',video_url:'https://www.douyin.com/video/7646309328911907195',judgment_status:'pending'}]};
  if(q.op==='release_video')released++;return {result:{}};
 },execute:async()=>{throw Error('EXECUTION_OUTPUT_LIMIT');}});
 const r=await runWorkflow({activities:[{key:'qualification',retry_safe:true},{key:'cleanup'}],context:{},handlers:h,commander:async()=>({action:'retry',reason:'fixture'}),record:async()=>{},recover:async()=>{skills++;return {status:'completed',execution_stopped:true};}});
 assert.equal(h.state.executionUnknown,true);assert.equal(skills,0);assert.equal(released,0);assert.equal(r.results[0].execution_stopped,false);assert.equal(r.results.at(-1).status,'blocked');
 }finally{rmSync(d,{recursive:true,force:true});}
});

test('actual original-handler quarantine separately records device marker and owned-video CAS readback',async()=>{
 const d=mkdtempSync(join(tmpdir(),'skill-quarantine-')),vid='7646309328911907195',run='fixture';let quarantined=0;
 try{const h=createHandlers({root:d,env:{HOME:d,WFR_RUN_DIR:d,WFR_TAG:run,P:'fixture',SERIAL:'fixture-serial',LEADGEN_LINE:'jinuo'},rpc:async({request:q})=>{
  if(q.op==='claim_videos')return {result:[{video_id:vid,video_url:'https://www.douyin.com/video/'+vid,judgment_status:'pending'}]};
  if(q.op==='renew_video')return {result:{renewed:true}};
  assert.equal(q.op,'quarantine_video');assert.equal(q.run,run);assert.equal(q.video_id,vid);assert.equal(q.line,'jinuo');quarantined++;return {result:{quarantined:true,video_id:vid,process_status:'待人工核验:'+run}};
 },execute:async(cmd,args)=>{if(args.includes('lock-quarantine'))return {code:0,stdout:'lock=quarantined owner=fixture review_required=true\n',stderr:''};throw Error('EXECUTION_OUTPUT_LIMIT');}});
 await assert.rejects(()=>h.qualification(),/EXECUTION_OUTPUT_LIMIT/);const proof=await h.quarantineResources();assert.equal(proof.verified,true);assert.equal(quarantined,1);assert.equal(proof.videos[0].verified,true);assert.deepEqual(JSON.parse(readFileSync(join(d,'resource-quarantine.json'),'utf8')),proof);
 }finally{rmSync(d,{recursive:true,force:true});}
});

for(const transport of ['returned','thrown'])test('actual recorder termination unknown blocks retry, next VID, Skill and cleanup '+transport,async()=>{
 const {runWorkflow}=await import('../leadgen-workflow.mjs');const d=mkdtempSync(join(tmpdir(),'recording-stop-unknown-fixture-'));
 let actions=0,skills=0,cleanup=0,quarantined=0;
 try{
  const h=createHandlers({root:d,env:{HOME:d,WFR_RUN_DIR:d,WFR_TAG:'fixture',P:'fixture',LEADGEN_LINE:'jinuo'},rpc:async({request:q})=>{
   if(q.op==='claim_videos')return {result:['7646309328911907195','7646309328911907196'].map(video_id=>({video_id,video_url:'https://www.douyin.com/video/'+video_id,judgment_status:'pending'}))};
   return {result:{renewed:true}};
  },execute:async()=>{actions++;if(transport==='thrown')throw Error('RECORD_CAPTURE_EXIT_UNVERIFIED');return {code:2,stdout:'',stderr:'RECORD_CAPTURE_EXIT_UNVERIFIED reason=owned_recorder_stop_unknown'};}});
  h.cleanup=async()=>{cleanup++;return {done:true};};
  const r=await runWorkflow({activities:[{key:'qualification',retry_safe:true},{key:'cleanup'}],context:{},handlers:h,commander:async()=>({action:'retry',reason:'isolated fixture'}),record:async()=>{},recover:async()=>{skills++;return {status:'completed',execution_stopped:true};},quarantine:async()=>{quarantined++;return {verified:true};}});
  assert.equal(actions,1,'cannot record a second VID while the first recorder may remain alive');
  assert.equal(h.state.executionUnknown,true);assert.equal(skills,0);assert.equal(cleanup,0);assert.equal(quarantined,1);
  assert.equal(r.results[0].execution_stopped,false);assert.equal(r.results.at(-1).status,'blocked');
 }finally{rmSync(d,{recursive:true,force:true});}
});
