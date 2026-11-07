import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {samplingAdmissionEvidence} from '../runtime-receipts.mjs';

const api=await import('../leadgen-agent-artifacts.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const sha=b=>createHash('sha256').update(b).digest('hex');
const vid='7637880891511528896',run='source102',eid=`${run}-v${vid}-qualification-record`;
const pins={33:['952ee0841791f9d37692721327a9d36530b348a93709612aebda5475aeda7c0d','8588238c9a5a00aa542906b6ec7e6d5541d9ffb9b5d0f6e1bc0e365e2303079e'],31:['2823f8e89c3cdb014457d47cb5d9a08d067bd5a1e9e6c9e784a6a6e0f5b8e258','764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536']};
function fixture(t,sdk=33){
 const base=mkdtempSync(join(tmpdir(),'agent-artifacts-')),runDir=join(base,'run'),evidenceRoot=join(base,'evidence');mkdirSync(runDir);mkdirSync(evidenceRoot);t.after(()=>rmSync(base,{recursive:true,force:true}));
 const scope={run,video_id:vid,serial:'NO-DEVICE',profile:'legacy',source_commit:'a'.repeat(40),company_id:'company',company_version:3};
 const file=(name,body)=>{const bytes=typeof body==='string'?body:JSON.stringify(body);writeFileSync(join(evidenceRoot,name),bytes,{mode:0o600});return sha(bytes);};
 const native=(phase,state='started')=>{const p=eid+'-playback-'+phase;const fields={native_audio_state:state,native_audio_uid:'10203',native_audio_pid:'528',native_audio_piid:'73615',native_audio_package_uid_verified:'true',native_audio_foreign_started:'0'};
  for(const [name,suffix,bytes] of [['evidence','audio.txt','AudioPlaybackConfiguration state:started uid=10203'],['package_uid','package-uid.txt','package:com.ss.android.ugc.aweme uid:10203'],['uid_owners','uid-owners.txt','package:com.ss.android.ugc.aweme uid:10203']]){fields['native_audio_'+name+'_file']=p+'.'+suffix;fields['native_audio_'+name+'_sha256']=file(p+'.'+suffix,bytes);}
  fields.playback_proof_kind='native_audio';fields.playback_package='com.ss.android.ugc.aweme';fields.playback_state='2';
  fields.playback_evidence_file=p+'.media-session.txt';fields.playback_evidence_sha256=file(p+'.media-session.txt','state=PlaybackState {state=3}');fields.playback_foreground_file=p+'.foreground.txt';fields.playback_foreground_sha256=file(p+'.foreground.txt','com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.detail.ui.DetailActivity');return fields;
 };
 const mode=sdk===31?'output_pcm_sdk31':'playback_dup',client=pins[sdk][0],server=pins[sdk][1];
 const shared={capture_audio_mode:mode,capture_audio_sdk:String(sdk),capture_audio_required:'true',capture_audio_sdk_evidence_file:eid+'.capture-sdk.txt',capture_audio_sdk_evidence_sha256:file(eid+'.capture-sdk.txt',String(sdk)+'\n'),capture_runtime_client_sha256:client,capture_runtime_server_sha256:server,capture_runtime_evidence_file:eid+'.capture-runtime.json',capture_runtime_evidence_sha256:file(eid+'.capture-runtime.json',{runtime:{verified:true,client_sha256:client,server_sha256:server},stage:{verified:true,execution_stop_unknown:false,serial:scope.serial,owner:run,evidence_id:eid}})};
 const media=join(evidenceRoot,eid+(sdk===31?'.rec.wav':'.rec.mkv'));writeFileSync(media,'real-boundary-media-fixture',{mode:0o600});
 const start={...shared,...native('start'),pid:'700',path:media,max_seconds:'30',media_volume:'4',playback_verified:'true'};
 const end={...shared,...native('end'),path:media,duration_seconds:'25',video_streams:sdk===31?'0':'1',audio_streams:'1',audio_codec:sdk===31?'pcm_s16le':'opus',mean_volume_db:'-25'};
 if(sdk===31){
  const restored=native('restored','inactive');for(const [key,value] of Object.entries(restored))if(key.startsWith('native_audio_'))end[key.replace('native_audio_','native_audio_restored_')]=value;
  const decode={verified:true,decoder_exit_code:0,requested_seconds:25,decoded_samples:400000,decoded_sample_rate:16000,decoded_seconds:25,mean_volume_db:-25};
  Object.assign(end,{decoded_audio_verified:'true',decoder_exit_code:'0',capture_requested_seconds:'25',decoded_audio_samples:'400000',decoded_audio_sample_rate:'16000',decoded_audio_seconds:'25',decoded_audio_evidence_file:eid+'.decode.json',decoded_audio_evidence_sha256:file(eid+'.decode.json',decode)});
 }
 const audioPath=join(evidenceRoot,eid+'.16k.wav');writeFileSync(audioPath,'extracted-media-fixture',{mode:0o600});
 const raw=(marker,fields)=>marker+' '+Object.entries(fields).map(([k,v])=>k+'='+v).join(' ');
 return {base,runDir,evidenceRoot,scope,expectedSeconds:25,started:raw('record_started',start),stopped:raw('record_stopped',end),extracted:raw('audio_extracted',{path:audioPath,duration_seconds:'25',sample_rate:'16000',channels:'1'}),start,end,raw,audioPath};
}
function identity(runDir){const proof={verified:true,expected_video_id:vid,observed_video_id:vid,content_type:'video',excluded_non_video:false,evidence_id:`${run}-v${vid}-qualification-identity`,controller_stdout:`content_type=video\nvideo_id=${vid}\nresolved_url=https://www.douyin.com/video/${vid}\n`};writeFileSync(join(runDir,`${run}-identity-${vid}.json`),JSON.stringify(proof),{mode:0o600});}

for(const sdk of [33,31])test(`SDK${sdk}原始成功回执与文件生成同run资格工件，保留raw摘要且同输入重入不覆盖`,async t=>{
 assert.equal(typeof api.buildRecordingProof,'function');const f=fixture(t,sdk);const got=api.buildRecordingProof(f);
 assert.equal(got.proof.video_id,vid);assert.equal(got.proof.run,run);assert.equal(got.proof.capture_audio_verified,true);assert.equal(got.audioPath,f.audioPath);
 assert.equal(got.proof.source_receipts_sha256.start,sha(f.started));assert.equal(got.proof.native_audio.start.uid,10203);assert.equal(got.proof.native_audio.end.uid,10203);
 const file=join(f.runDir,`${run}-recording-${vid}.json`),before=readFileSync(file);assert.deepEqual(api.buildRecordingProof(f).proof,got.proof);assert.deepEqual(readFileSync(file),before);
 assert.throws(()=>api.buildRecordingProof({...f,stopped:f.stopped.replace('mean_volume_db=-25','mean_volume_db=-24')}),/AGENT_|RECORD_/);assert.deepEqual(readFileSync(file),before);
});

test('录音原件错hash、外来UID、缺stop、静音、symlink及跨目录均不生成成功工件',async t=>{
 assert.equal(typeof api.buildRecordingProof,'function');
 for(const mutate of [f=>{writeFileSync(join(f.evidenceRoot,eid+'-playback-start.audio.txt'),'changed');},f=>{f.stopped=f.stopped.replace('native_audio_uid=10203','native_audio_uid=99');},f=>{f.stopped='';},f=>{f.stopped=f.stopped.replace('mean_volume_db=-25','mean_volume_db=-100');},f=>{const p=join(f.evidenceRoot,eid+'.capture-sdk.txt');rmSync(p);symlinkSync(join(f.evidenceRoot,eid+'-playback-start.audio.txt'),p);},f=>{f.extracted=f.extracted.replace('path='+f.audioPath,'path='+join(f.base,'foreign.wav'));}]){
  const f=fixture(t);mutate(f);assert.throws(()=>api.buildRecordingProof(f),/AGENT_RECORDING|RECORD_/);assert.equal(existsSync(join(f.runDir,`${run}-recording-${vid}.json`)),false);
 }
});

test('SDK31解码与恢复音轨缺口不能由起止stdout填绿',async t=>{
 assert.equal(typeof api.buildRecordingProof,'function');
 for(const [from,to] of [['decoded_audio_verified=true','decoded_audio_verified=false'],['native_audio_restored_foreign_started=0','native_audio_restored_foreign_started=1'],['decoded_audio_samples=400000','decoded_audio_samples=16000']]){const f=fixture(t,31);f.stopped=f.stopped.replace(from,to);assert.throws(()=>api.buildRecordingProof(f),/AGENT_RECORDING|RECORD_/);}
});
test('SDK31真实stop同值mean_volume_db重复可消费，冲突字段不得以后值覆盖',async t=>{
 const f=fixture(t,31);f.stopped+=' mean_volume_db=-25';assert.equal(api.buildRecordingProof(f).proof.mean_volume_db,-25);
 const bad=fixture(t,31);bad.stopped+=' mean_volume_db=-24';assert.throws(()=>api.buildRecordingProof(bad),/AGENT_RECORDING_RECEIPT_INVALID/);assert.equal(existsSync(join(bad.runDir,run+'-recording-'+vid+'.json')),false);
});

test('真实identity与同公司PG判定构成资格进度；pending保partial且不列入合格VID',async t=>{
 assert.equal(typeof api.recordQualificationResult,'function');const f=fixture(t);identity(f.runDir);api.buildRecordingProof(f);
 const readback={video_id:vid,judgment_status:'matched',judgment_config:{company_id:'company',version:3,run_id:run},process_status:'处理中:'+run};
 const result=api.recordQualificationResult({runDir:f.runDir,scope:f.scope,leased:[{video_id:vid}],results:[{video_id:vid,judgment:{verdict:'matched'},readback}]});
 assert.equal(result.matched,1);assert.equal(result.recordings_required,1);assert.equal(result.videos_verified,1);assert.deepEqual(result.failures,[]);
 const p=JSON.parse(readFileSync(join(f.runDir,run+'-qualification-progress.json')));assert.deepEqual(p.qualified_video_ids,[vid]);assert.equal(p.videos[0].settled,true);assert.match(p.videos[0].identity_snapshot_sha256,/^[a-f0-9]{64}$/);
 const pending=fixture(t);identity(pending.runDir);const partial=api.recordQualificationResult({runDir:pending.runDir,scope:pending.scope,leased:[{video_id:vid}],results:[{video_id:vid,judgment:{verdict:'pending'},readback:{...readback,judgment_status:'pending'}}]});assert.equal(partial.status,'partial');assert.equal(partial.matched,0);
 assert.deepEqual(JSON.parse(readFileSync(join(pending.runDir,run+'-qualification-progress.json'))).qualified_video_ids,[]);
});

test('资格缓存也必须有真实同run身份及既有公司政策，跨租户或未领VID拒绝',async t=>{
 assert.equal(typeof api.recordQualificationResult,'function');
 for(const change of ['foreign_company','unleased','missing_identity']){
  const f=fixture(t);if(change!=='missing_identity')identity(f.runDir);
  const args={runDir:f.runDir,scope:f.scope,leased:[{video_id:vid}],results:[{video_id:vid,cached:true,judgment:{verdict:'matched'},readback:{video_id:vid,judgment_status:'matched',judgment_config:{company_id:'company',version:3,run_id:'prior102'},process_status:'处理中:'+run}}]};
  if(change==='foreign_company')args.results[0].readback.judgment_config.company_id='other';if(change==='unleased')args.leased=[];
  assert.throws(()=>api.recordQualificationResult(args),/AGENT_QUALIFICATION|SAMPLING_/);
 }
});

function collectionFixture(t){
 const f=fixture(t);identity(f.runDir);
 const policy={company_id:'company',version:3,run_id:'prior102'};
 api.recordQualificationResult({runDir:f.runDir,scope:f.scope,leased:[{video_id:vid}],results:[{video_id:vid,cached:true,judgment:{verdict:'matched'},readback:{video_id:vid,judgment_status:'matched',judgment_config:policy,process_status:'处理中:'+run}}]});
 const phone=join(f.base,'phone'),evidenceRoot=join(phone,'evidence','legacy');mkdirSync(evidenceRoot,{recursive:true});const previous=process.env.DOUYIN_PHONE_TMP_ROOT;process.env.DOUYIN_PHONE_TMP_ROOT=phone;t.after(()=>{if(previous===undefined)delete process.env.DOUYIN_PHONE_TMP_ROOT;else process.env.DOUYIN_PHONE_TMP_ROOT=previous;});
 const prefix=`${run}-v${vid}-collection`,profileEid=prefix+'-person1-t1',videoEid=prefix+'-after-card1',pkg='com.ss.android.ugc.aweme';
 const profile=`<hierarchy><node package="${pkg}" text="本人" content-desc="本人，复制名字和修改备注"/><node package="${pkg}" text="抖音号：person987"/></hierarchy>`;
 const returned=`<hierarchy><node package="${pkg}" class="android.widget.TextView" resource-id="${pkg}:id/title" text="4条评论"/><node package="${pkg}" class="android.widget.EditText" resource-id="${pkg}:id/ety"/><node package="${pkg}" class="android.widget.FrameLayout" resource-id="${pkg}:id/fhn" text="" content-desc="本人,在哪里报名,09-27, · 山东,回复 按钮,"/></hierarchy>`;
 const profilePath=join(evidenceRoot,profileEid+'-profile.xml'),returnedPath=join(evidenceRoot,profileEid+'-returned.xml');writeFileSync(profilePath,profile,{mode:0o600});writeFileSync(returnedPath,returned,{mode:0o600});
 const ip=join(f.runDir,run+'-identity-'+vid+'.json'),p=JSON.parse(readFileSync(ip));p.evidence_id=videoEid;writeFileSync(ip,JSON.stringify(p),{mode:0o600});
 const videoUrl='https://www.douyin.com/video/'+vid,{capture}=createRequire(import.meta.url)('../queued-recipient-evidence.js');
 const proof=capture({runDir:f.runDir,line:'jinuo',run,sourceRun:'source101',videoId:vid,videoUrl,profile:'legacy',douyinId:'person987',nickname:'本人',commentBody:'在哪里报名',started:Math.floor(Date.now()/1000)-1,profilePath,returnedPath,profileEid,videoEid});
 const comment={nickname:'本人',douyinId:'person987',commentBody:'在哪里报名',sourceVideoUrl:videoUrl,recipientEvidence:JSON.parse(readFileSync(proof.file))};
 const row={id:'11111111-2222-4333-8444-555555555555',douyinId:'person987',commentBody:'在哪里报名',sourceVideoUrl:videoUrl};
 const scope={...f.scope,run_id:'douyin_video_processing-source102__a1',line:'jinuo',line_key:'jinuo',source_run:'source101',profile:'legacy'};
 const samplingInput={schema_version:1,workflow_key:'douyin_video_processing',run_tag:run,profile:'legacy',serial:'NO-DEVICE',line:'jinuo',source_run:'source101',comment_limit:1};
 const input={runDir:f.runDir,scope,evidenceRoot,samplingInput,qualifiedVideoIds:[vid],videos:[{video_id:vid,video_url:videoUrl,operation:'collect_partial',comments:[comment],history:[],historyReceipt:{version:1,status:'verified',line:'jinuo',line_key:'jinuo',run,source_run:'source101',video_id:vid,video_url:videoUrl,rows:[]},stored:{inserted:1,comments:1,video_id:vid,history_verified:0,coverage:1,status:'partial'},historyReadback:{verified:true,video_id:vid,history_verified:0,ids:[]},pgReadback:{verified:true,video_id:vid,coverage:1,rows:[row]},stop_reason:'quota_reached',rescan_count:0,avatar_recovery_count:0}]};
 return {f,input};
}
test('采样结果只由同VID原生身份与精确PG行集合生成，原独立admission可读回',async t=>{
 assert.equal(typeof api.recordCollectionResult,'function');const {f,input}=collectionFixture(t),out=api.recordCollectionResult(input);
 assert.equal(out.comments_inserted,1);assert.equal(out.videos_sampled,1);assert.equal(out.videos_collected,0);assert.equal(out.coverage,1);assert.equal(out.sampling_receipts[0].all_comments_scanned,false);
 const admitted=samplingAdmissionEvidence({dir:f.runDir,artifact:{result:out},frozen:{sampling_input:input.samplingInput,deployment:{source_commit:'a'.repeat(40)}},binding:{run_id:input.scope.run_id,id:'binding-id'}});
 assert.deepEqual(admitted.videos[0].comment_ids,['11111111-2222-4333-8444-555555555555']);assert.equal(admitted.videos[0].qualification.mode,'cached');
});
test('采样错PG身份、膨胀coverage、无footer证明或无零评论原件均不得生成成功回执',async t=>{
 assert.equal(typeof api.recordCollectionResult,'function');
 for(const change of ['wrong_identity','wrong_coverage','missing_footer','missing_no_comments']){const {f,input}=collectionFixture(t),v=input.videos[0];
  if(change==='wrong_identity')v.pgReadback.rows[0].douyinId='other';if(change==='wrong_coverage')v.stored.coverage=2;if(change==='missing_footer')v.stop_reason='footer_reached';if(change==='missing_no_comments')v.stop_reason='no_comments';
  assert.throws(()=>api.recordCollectionResult(input),/AGENT_COLLECTION|NO_COMMENTS_/);assert.equal(existsSync(join(f.runDir,run+'-sampling-readback.json')),false);
 }
});
test('预算partial保留已提交行而不兑现采样完成，不生成completed采样工件',async t=>{
 assert.equal(typeof api.recordCollectionResult,'function');const {f,input}=collectionFixture(t);input.videos[0].stop_reason='partial';
 const out=api.recordCollectionResult(input);assert.equal(out.status,'partial');assert.equal(out.comments_inserted,1);assert.equal(out.coverage,1);assert.equal(out.sampling_readback_count,0);assert.equal(out.videos_processed,0);assert.equal(existsSync(join(f.runDir,run+'-sampling-readback.json')),false);
 assert.match(readFileSync(join(f.runDir,'comments.tsv'),'utf8'),/COLLECTION\t7637880891511528896\tpartial\t1/);
});
test('真实作者footer可以零覆盖完成范围，不能冒充UI零评论',async t=>{
 assert.equal(typeof api.recordCollectionResult,'function');const {f,input}=collectionFixture(t),v=input.videos[0];v.comments=[];v.operation='collect';v.stored={inserted:0,comments:0,video_id:vid,history_verified:0,coverage:0};v.pgReadback={verified:true,video_id:vid,coverage:0,rows:[]};v.stop_reason='footer_reached';
 const file=join(input.evidenceRoot,`${run}-v${vid}-collection-screen1.xml`),raw=readFileSync(new URL('./fixtures/honor-e1b-recipient/author-footer.xml',import.meta.url));writeFileSync(file,raw,{mode:0o600});v.footer_evidence={file,sha256:sha(raw)};
 const out=api.recordCollectionResult(input);assert.equal(out.comments_inserted,0);assert.equal(out.videos_collected,1);assert.equal(out.sampling_receipts[0].stop_reason,'footer_reached');assert.equal(existsSync(join(f.runDir,run+'-no-comments-'+vid+'.json')),false);
});

test('original collection artifacts consume the Code-owned recipient parser seam',t=>{
 const {input}=collectionFixture(t),native=createRequire(import.meta.url)('../queued-recipient-evidence.js');let reads=0;
 input.recipientNative={parseNative(...args){reads++;return native.parseNative(...args);}};
 const out=api.recordCollectionResult(input);assert.equal(out.videos_sampled,1);assert.equal(reads,1,'must use Code parser rather than hidden default process');
});
test('Code recipient parser rejection is retained without falling back to the legacy parser',t=>{
 const {input}=collectionFixture(t);input.recipientNative={parseNative(){throw Error('CODE_PARSE_REJECTED');}};
 assert.throws(()=>api.recordCollectionResult(input),/CODE_PARSE_REJECTED/);assert.equal(existsSync(join(input.runDir,run+'-agent-collection-receipts.json')),false);
});

for(const accepted of [true,false])test('original footer predicate consumes Code reader with exact immutable bytes '+accepted,t=>{
 const {input}=collectionFixture(t),v=input.videos[0];v.comments=[];v.operation='collect';v.stored={inserted:0,comments:0,video_id:vid,history_verified:0,coverage:0};v.pgReadback={verified:true,video_id:vid,coverage:0,rows:[]};v.stop_reason='footer_reached';const file=join(input.evidenceRoot,`${run}-v${vid}-collection-seam.xml`),raw=readFileSync(new URL('./fixtures/honor-e1b-recipient/author-footer.xml',import.meta.url));writeFileSync(file,raw,{mode:0o600});v.footer_evidence={file,sha256:sha(raw)};let reads=0;input.verifyFooter=(bytes,context)=>{reads++;assert.deepEqual(bytes,raw);assert.equal(context.sha256,sha(raw));assert.equal(context.video_id,vid);return accepted;};if(accepted)assert.equal(api.recordCollectionResult(input).videos_collected,1);else assert.throws(()=>api.recordCollectionResult(input),/AGENT_COLLECTION_FOOTER_UNVERIFIED/);assert.equal(reads,1,'must consume the Code reader rather than start the default Python');
});
