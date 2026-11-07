// Adapts trusted primitive receipts into the original independently checked artifacts.
// This module performs no phone operation, model call or database write.
import {createHash} from 'node:crypto';
import {closeSync,constants,existsSync,fsyncSync,lstatSync,openSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {assertCaptureStrategy} from './capture-strategy.mjs';
import {freezeQualificationIdentity} from './qualification-identity-snapshot.mjs';
import {spawnSync} from 'node:child_process';
import history from './queued-comment-history.js';
import recipient from './queued-recipient-evidence.js';
import {verifyNoComments} from './no-comments-evidence.mjs';
import {commentSamplingInput} from './runtime-definition.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const video=/^\d{16,24}$/,tag=/^[A-Za-z0-9_-]{1,120}$/,sha=/^[a-f0-9]{64}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const canonical=x=>Array.isArray(x)?x.map(canonical):object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const fail=reason=>{throw Error(reason);};
function scopeIdentity(scope){if(!tag.test(scope?.run||'')||scope.video_id!==undefined&&!video.test(scope.video_id))fail('AGENT_RECORDING_SCOPE_INVALID');}
function fileBytes(file,root,{privateFile=false,maxBytes=128*1024*1024}={}){
 const stat=lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.uid!==process.getuid()||(stat.mode&(privateFile?0o077:0o022))!==0||stat.size<1||stat.size>maxBytes||realpathSync(dirname(file))!==realpathSync(root))fail('AGENT_RECORDING_FILE_INVALID');
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{return readFileSync(fd);}finally{closeSync(fd);}
}
function immutable(file,body,root){
 const bytes=Buffer.from(JSON.stringify(body));
 try{const fd=openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}}
 catch(error){if(error.code!=='EEXIST')throw error;const prior=JSON.parse(fileBytes(file,root,{privateFile:true,maxBytes:4*1024*1024}));const withoutTime=x=>{const {observed_at,...rest}=x;return rest;};if(!same(withoutTime(prior),withoutTime(body)))fail('AGENT_ARTIFACT_IMMUTABLE_CHANGED');return prior;}
 return body;
}
function fields(raw,marker){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>128*1024||!raw.trim().startsWith(marker+' ')||/[\r\n]/.test(raw.trim()))fail('AGENT_RECORDING_RECEIPT_INVALID');
 const parts=raw.trim().split(/\s+/);if(parts.shift()!==marker)fail('AGENT_RECORDING_RECEIPT_INVALID');const out={};
 for(const part of parts){const at=part.indexOf('=');if(at<1)fail('AGENT_RECORDING_RECEIPT_INVALID');const key=part.slice(0,at),value=part.slice(at+1);if(!/^[a-z_][a-z0-9_]*$/.test(key)||Object.hasOwn(out,key)&&out[key]!==value||!value)fail('AGENT_RECORDING_RECEIPT_INVALID');out[key]=value;}
 return out;
}
const integer=v=>/^\d+$/.test(v||'')&&Number.isSafeInteger(Number(v))?Number(v):null;
const number=v=>v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
function referenced(root,name,digest){
 if(typeof name!=='string'||basename(name)!==name||!/^[A-Za-z0-9_.-]{1,250}$/.test(name)||!sha.test(digest||''))fail('AGENT_RECORDING_REFERENCE_INVALID');
 const bytes=fileBytes(join(root,name),root);if(hash(bytes)!==digest)fail('AGENT_RECORDING_RAW_HASH_MISMATCH');return bytes;
}
function native(fields,prefix,root,restored=false){
 const name=restored?'native_audio_restored_':'native_audio_';
 const value={state:fields[name+'state'],uid:integer(fields[name+'uid']),pid:integer(fields[name+'pid']),piid:integer(fields[name+'piid']),foreign_started:integer(fields[name+'foreign_started']),package_uid_verified:fields[name+'package_uid_verified']==='true'};
 if(!(restored?['started','inactive'].includes(value.state):value.state==='started')||value.uid<1||!Number.isSafeInteger(value.uid)||!value.package_uid_verified||value.foreign_started!==0||!restored&&(!Number.isSafeInteger(value.pid)||value.pid<1||!Number.isSafeInteger(value.piid)||value.piid<1))fail('AGENT_RECORDING_NATIVE_UNVERIFIED');
 for(const [key,suffix] of [['evidence','audio.txt'],['package_uid','package-uid.txt'],['uid_owners','uid-owners.txt']]){
  const file=fields[name+key+'_file'],digest=fields[name+key+'_sha256'];if(file!==prefix+'.'+suffix)fail('AGENT_RECORDING_NATIVE_SCOPE_INVALID');referenced(root,file,digest);value[key+'_file']=file;value[key+'_sha256']=digest;
 }
 return value;
}

export function buildRecordingProof({runDir,scope,started,stopped,extracted,expectedSeconds,evidenceRoot}){
 scopeIdentity(scope);if(!video.test(scope.video_id||'')||typeof scope.serial!=='string'||!scope.serial||!Number.isSafeInteger(expectedSeconds)||expectedSeconds<5||expectedSeconds>320)fail('AGENT_RECORDING_SCOPE_INVALID');
 const eid=`${scope.run}-v${scope.video_id}-qualification-record`;if(scope.evidence_id!==undefined&&scope.evidence_id!==eid)fail('AGENT_RECORDING_SCOPE_INVALID');
 const s=fields(started,'record_started'),e=fields(stopped,'record_stopped'),a=fields(extracted,'audio_extracted');
 const sdk=integer(s.capture_audio_sdk),mode=s.capture_audio_mode;
 const sdkFile=eid+'.capture-sdk.txt';if(s.capture_audio_sdk_evidence_file!==sdkFile||String(sdk)!==referenced(evidenceRoot,sdkFile,s.capture_audio_sdk_evidence_sha256).toString().trim())fail('AGENT_RECORDING_SDK_UNVERIFIED');
 const runtimeKeys=['client_sha256','server_sha256','evidence_file','evidence_sha256'];
 const runtime=Object.fromEntries(runtimeKeys.map(k=>[k,s['capture_runtime_'+k]])),runtimeEnd=Object.fromEntries(runtimeKeys.map(k=>[k,e['capture_runtime_'+k]]));
 if(runtime.evidence_file!==eid+'.capture-runtime.json')fail('AGENT_RECORDING_RUNTIME_SCOPE_INVALID');
 const evidence=JSON.parse(referenced(evidenceRoot,runtime.evidence_file,runtime.evidence_sha256));
 if(evidence.runtime?.verified!==true||evidence.stage?.verified!==true||evidence.stage.execution_stop_unknown===true||evidence.stage.serial!==scope.serial||evidence.stage.owner!==scope.run||evidence.stage.evidence_id!==eid||evidence.runtime.client_sha256!==runtime.client_sha256||evidence.runtime.server_sha256!==runtime.server_sha256)fail('AGENT_RECORDING_RUNTIME_UNVERIFIED');
 const start=native(s,eid+'-playback-start',evidenceRoot),end=native(e,eid+'-playback-end',evidenceRoot);if(start.uid!==end.uid)fail('AGENT_RECORDING_NATIVE_UID_CHANGED');
 if(s.playback_proof_kind!=='native_audio'||e.playback_proof_kind!=='native_audio'||s.playback_package!=='com.ss.android.ugc.aweme'||e.playback_package!==s.playback_package||s.playback_verified!=='true')fail('AGENT_RECORDING_PLAYBACK_UNVERIFIED');
 const playback={};for(const [phase,f] of [['start',s],['end',e]]){
  const p=eid+'-playback-'+phase;playback[phase]={};
  for(const [key,suffix] of [['evidence','media-session.txt'],['foreground','foreground.txt']]){const name=f['playback_'+key+'_file'],digest=f['playback_'+key+'_sha256'];if(name!==p+'.'+suffix)fail('AGENT_RECORDING_PLAYBACK_SCOPE_INVALID');referenced(evidenceRoot,name,digest);playback[phase][key+'_file']=name;playback[phase][key+'_sha256']=digest;}
 }
 const mediaName=eid+(sdk===31?'.rec.wav':'.rec.mkv');if(s.path!==e.path||resolve(s.path||'')!==resolve(evidenceRoot,mediaName))fail('AGENT_RECORDING_MEDIA_SCOPE_INVALID');fileBytes(s.path,evidenceRoot);
 const duration=number(e.duration_seconds),mean=number(e.mean_volume_db),media=integer(s.media_volume);
 if(duration===null||duration<expectedSeconds*.8||mean===null||mean<=-80||!Number.isSafeInteger(media)||media<=0)fail('AGENT_RECORDING_AUDIO_UNVERIFIED');
 const audioPath=join(evidenceRoot,eid+'.16k.wav');if(resolve(a.path||'')!==resolve(audioPath)||a.sample_rate!=='16000'||a.channels!=='1'||number(a.duration_seconds)===null||Math.abs(number(a.duration_seconds)-duration)>1)fail('AGENT_RECORDING_EXTRACT_UNVERIFIED');
 const audio=fileBytes(audioPath,evidenceRoot);
 const decoded={verified:e.decoded_audio_verified==='true',decoder_exit_code:number(e.decoder_exit_code),sample_rate:integer(e.decoded_audio_sample_rate),samples:integer(e.decoded_audio_samples),seconds:number(e.decoded_audio_seconds),requested_seconds:integer(e.capture_requested_seconds),evidence_file:e.decoded_audio_evidence_file??null,evidence_sha256:e.decoded_audio_evidence_sha256??null};
 let restored=null;if(sdk===31){
  restored=native(e,eid+'-playback-restored',evidenceRoot,true);if(restored.uid!==start.uid)fail('RECORD_AUDIO_RESTORE_UNVERIFIED');
  if(decoded.evidence_file!==eid+'.decode.json'||decoded.requested_seconds!==expectedSeconds)fail('RECORD_AUDIO_DECODE_UNVERIFIED');
  const d=JSON.parse(referenced(evidenceRoot,decoded.evidence_file,decoded.evidence_sha256));
  if(d.verified!==true||d.decoder_exit_code!==decoded.decoder_exit_code||d.requested_seconds!==decoded.requested_seconds||d.decoded_sample_rate!==decoded.sample_rate||d.decoded_samples!==decoded.samples||d.decoded_seconds!==decoded.seconds||d.mean_volume_db!==mean)fail('RECORD_AUDIO_DECODE_UNVERIFIED');
 }
 const proof={version:2,run:scope.run,video_id:scope.video_id,evidence_id:eid,media_volume:media,media_volume_verified:true,playback_verified:true,playback_proof_kind:'native_audio',playback_package:s.playback_package,playback_state:number(s.playback_state),playback_end_state:number(e.playback_state),native_audio:{start,end},native_audio_restored:restored,playback_raw_evidence:playback,audio_status:'usable',mean_volume_db:mean,duration_seconds:duration,record_started_stdout:started,record_stopped_stdout:stopped,capture_audio_mode:mode,capture_audio_sdk:sdk,capture_audio_required:s.capture_audio_required==='true',capture_audio_sdk_evidence_file:s.capture_audio_sdk_evidence_file,capture_audio_sdk_evidence_sha256:s.capture_audio_sdk_evidence_sha256,capture_audio_end:{mode:e.capture_audio_mode,sdk:integer(e.capture_audio_sdk),required:e.capture_audio_required==='true',sdk_evidence_file:e.capture_audio_sdk_evidence_file,sdk_evidence_sha256:e.capture_audio_sdk_evidence_sha256},capture_runtime:runtime,capture_runtime_end:runtimeEnd,audio_streams:integer(e.audio_streams),video_streams:integer(e.video_streams),audio_codec:e.audio_codec,decoded_audio:decoded,capture_audio_verified:true,earliest_error:null,source_receipts_sha256:{start:hash(started),stop:hash(stopped),extract:hash(extracted)},audio_artifact:{file:basename(audioPath),sha256:hash(audio),bytes:audio.length},expected_seconds:expectedSeconds,observed_at:new Date().toISOString()};
 assertCaptureStrategy(proof);
 return {proof:immutable(join(runDir,`${scope.run}-recording-${scope.video_id}.json`),proof,runDir),audioPath};
}

function readIdentity(runDir,run,vid){
 let identity;try{identity=JSON.parse(fileBytes(join(runDir,`${run}-identity-${vid}.json`),runDir,{privateFile:true,maxBytes:1000000}));}catch{fail('AGENT_QUALIFICATION_IDENTITY_INVALID');}
 const lines=typeof identity.controller_stdout==='string'?identity.controller_stdout.trim().split('\n'):[];
 if(identity.verified!==true||identity.expected_video_id!==vid||identity.observed_video_id!==vid||identity.content_type!=='video'||identity.excluded_non_video!==false||lines.filter(v=>v.startsWith('video_id=')).length!==1||!lines.includes('video_id='+vid)||lines.filter(v=>v.startsWith('content_type=')).length!==1||!lines.includes('content_type=video'))fail('AGENT_QUALIFICATION_IDENTITY_INVALID');
 return identity;
}
export function recordQualificationResult({runDir,scope,leased,results}){
 scopeIdentity(scope);if(!/^[a-f0-9]{40}$/.test(scope.source_commit||'')||typeof scope.company_id!=='string'||!scope.company_id||!Number.isSafeInteger(scope.company_version)||scope.company_version<1||!Array.isArray(leased)||!Array.isArray(results)||leased.length>1000||results.length>leased.length)fail('AGENT_QUALIFICATION_SCOPE_INVALID');
 const ids=leased.map(v=>v.video_id);if(ids.some(id=>!video.test(id||''))||new Set(ids).size!==ids.length||new Set(results.map(r=>r.video_id)).size!==results.length||results.some(r=>!ids.includes(r.video_id)))fail('AGENT_QUALIFICATION_SCOPE_INVALID');
 const progress=[],qualified=[],failures=[];let verified=0,required=0,media=0,unverified=0;
 for(const vid of ids){
  const r=results.find(row=>row.video_id===vid);const facts={video_id:vid,settled:false,cached_judgment_run:null,recordingsRequired:0,mediaVerified:0,recordingSilentRejected:0,recordingOutcomesFailures:0,recordingsUnverified:0,attempts:1};
  if(!r||r.judgment?.verdict==='pending'){failures.push({video_id:vid,reason:'AGENT_QUALIFICATION_PENDING'});facts.recordingsUnverified=1;unverified++;progress.push(facts);continue;}
  const row=r.readback,policy=row?.judgment_config;
  if(row?.video_id!==vid||row.process_status!=='处理中:'+scope.run||!['matched','rejected'].includes(row.judgment_status)||r.judgment?.verdict!==row.judgment_status||policy?.company_id!==scope.company_id||policy.version!==scope.company_version||!tag.test(policy.run_id||''))fail('AGENT_QUALIFICATION_POLICY_READBACK_INVALID');
  readIdentity(runDir,scope.run,vid);verified++;
  if(r.cached===true){facts.cached_judgment_run=policy.run_id;}
  else{
   if(policy.run_id!==scope.run)fail('AGENT_QUALIFICATION_FRESH_RUN_INVALID');
   const proof=JSON.parse(fileBytes(join(runDir,`${scope.run}-recording-${vid}.json`),runDir,{privateFile:true,maxBytes:1000000}));
   if(proof.version!==2||proof.run!==scope.run||proof.video_id!==vid||proof.evidence_id!==`${scope.run}-v${vid}-qualification-record`||proof.capture_audio_verified!==true||proof.audio_status!=='usable'||proof.media_volume_verified!==true||proof.playback_verified!==true||!sha.test(proof.source_receipts_sha256?.start||'')||!sha.test(proof.audio_artifact?.sha256||''))fail('AGENT_QUALIFICATION_RECORDING_INVALID');
   assertCaptureStrategy(proof);facts.recordingsRequired=1;facts.mediaVerified=1;required++;media++;
  }
  facts.settled=true;if(row.judgment_status==='matched'){const snap=freezeQualificationIdentity({dir:runDir,run:scope.run,videoId:vid});facts.identity_snapshot_sha256=snap.sha256;qualified.push(vid);}progress.push(facts);
 }
 immutable(join(runDir,scope.run+'-qualification-progress.json'),{run:scope.run,source_commit:scope.source_commit,leased_video_ids:ids,qualified_video_ids:qualified,videos:progress},runDir);
 immutable(join(runDir,scope.run+'-agent-qualification-receipts.json'),{version:1,run:scope.run,source_commit:scope.source_commit,results},runDir);
 const lines=results.filter(r=>['matched','rejected'].includes(r.judgment?.verdict)).map(r=>`QUAL\t${r.video_id}\t${r.judgment.verdict}\t${r.cached===true?'cached':'judged'}`).join('\n')+'\n';
 const tsv=join(runDir,'qualification.tsv');if(existsSync(tsv)){if(fileBytes(tsv,runDir,{privateFile:true}).toString()!==lines)fail('AGENT_ARTIFACT_IMMUTABLE_CHANGED');}else{const fd=openSync(tsv,'wx',0o600);try{writeFileSync(fd,lines);fsyncSync(fd);}finally{closeSync(fd);}}
 return {claimed:ids.length,matched:qualified.length,videos_verified:verified,recordings_required:required,media_volume_verified:media,media_volume_failures:unverified?null:0,recordings_unverified:unverified,recordings_silent_rejected:0,recording_outcomes_failures:0,failures,...(failures.length?{status:'partial'}:{})};
}

function footerProof(proof,{root,run,vid,verifyFooter}){
 if(!proof||typeof proof.file!=='string'||!basename(proof.file).startsWith(`${run}-v${vid}-collection-`)||!proof.file.endsWith('.xml')||!sha.test(proof.sha256||''))fail('AGENT_COLLECTION_FOOTER_UNVERIFIED');
 const bytes=fileBytes(proof.file,root,{maxBytes:4*1024*1024});if(hash(bytes)!==proof.sha256)fail('AGENT_COLLECTION_FOOTER_UNVERIFIED');
 if(verifyFooter!==undefined){if(verifyFooter(Buffer.from(bytes),{file:proof.file,sha256:proof.sha256,run,video_id:vid})!==true)fail('AGENT_COLLECTION_FOOTER_UNVERIFIED');return {file:basename(proof.file),sha256:proof.sha256};}
 const script=`import sys,xml.etree.ElementTree as E,re
s=sys.stdin.read();assert '<!DOCTYPE' not in s and '<!ENTITY' not in s
r=E.fromstring(s);n=list(r.iter('node'));p='com.ss.android.ugc.aweme';assert r.tag=='hierarchy' and n and all(x.get('package')==p for x in n)
layout={'e19':'jqe','eyi':'jn1','e1b':'jqh'}
inputs=[x for x in n if x.get('resource-id') in [p+':id/'+k for k in layout]]
if inputs:
 assert len(inputs)==1 and inputs[0].get('class')=='android.widget.EditText'
 panel=[x for x in n if x.get('resource-id')==p+':id/'+layout[inputs[0].get('resource-id').split(':id/')[1]]];assert len(panel)==1
 n=list(panel[0].iter('node'));assert inputs[0] in n
else:assert any(x.get('resource-id')==p+':id/ety' and x.get('class')=='android.widget.EditText' for x in n)
assert any(re.fullmatch(r'(评论 ?[0-9万.]+|[0-9万.]+ ?条评论|暂无评论)',x.get('text','')) for x in n)
assert any(x.get('text')=='暂时没有更多了' or x.get('content-desc')=='暂时没有更多了' for x in n)
`;
 const result=spawnSync(process.env.DOUYIN_PYTHON_BIN||'python3',['-I','-c',script],{input:bytes,encoding:'utf8',timeout:3000,maxBuffer:32768});if(result.status!==0)fail('AGENT_COLLECTION_FOOTER_UNVERIFIED');return {file:basename(proof.file),sha256:proof.sha256};
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const count=x=>Number.isSafeInteger(x)&&x>=0;
const rowKey=row=>JSON.stringify([row.douyinId,row.commentBody,row.sourceVideoUrl]);
const tsv=value=>String(value??'').replace(/[\t\r\n]/g,' ');

export function recordCollectionResult({runDir,scope,samplingInput,qualifiedVideoIds,videos,evidenceRoot,recipientNative,verifyFooter}){
 if(recipientNative!==undefined&&typeof recipientNative?.parseNative!=='function')fail('AGENT_COLLECTION_PARSER_INVALID');
 if(verifyFooter!==undefined&&typeof verifyFooter!=='function')fail('AGENT_COLLECTION_PARSER_INVALID');
 scopeIdentity(scope);
 if(!/^[a-f0-9]{40}$/.test(scope.source_commit||'')||typeof scope.run_id!=='string'||!scope.run_id.startsWith('douyin_video_processing-'+scope.run+'__')||!tag.test(scope.source_run||'')||!scope.line||!scope.line_key||!Array.isArray(qualifiedVideoIds)||!Array.isArray(videos)||qualifiedVideoIds.length>1000||new Set(qualifiedVideoIds).size!==qualifiedVideoIds.length||qualifiedVideoIds.some(id=>!video.test(id))||new Set(videos.map(v=>v.video_id)).size!==videos.length||videos.some(v=>!qualifiedVideoIds.includes(v.video_id)))fail('AGENT_COLLECTION_SCOPE_INVALID');
 if(samplingInput){
  const q=samplingInput,parsed=commentSamplingInput({WF_BRAIN_WORKFLOW:'douyin_video_processing',WFR_TAG:scope.run,P:scope.profile,SERIAL:scope.serial,LEADGEN_LINE:scope.line,LEADGEN_SOURCE_RUN:scope.source_run,LEADGEN_COMMENT_LIMIT:String(q.comment_limit),...(Object.hasOwn(q,'collection_budget_s')?{QUEUED_VIDEO_COLLECTION_SECONDS:String(q.collection_budget_s)}:{})});
  if(!same(q,parsed))fail('AGENT_COLLECTION_SAMPLING_SCOPE_INVALID');
 }
 const qualification=JSON.parse(fileBytes(join(runDir,scope.run+'-qualification-progress.json'),runDir,{privateFile:true,maxBytes:3000000}));
 if(qualification.run!==scope.run||qualification.source_commit!==scope.source_commit||!Array.isArray(qualification.qualified_video_ids)||qualification.qualified_video_ids.length!==qualifiedVideoIds.length||qualifiedVideoIds.some(id=>!qualification.qualified_video_ids.includes(id)))fail('AGENT_COLLECTION_QUALIFICATION_SCOPE_INVALID');
 const receipts=[],failures=[],lines=[],proofs=[],historyArtifacts=[];const allIds=new Set();let comments=0,inserted=0,covered=0,oldCount=0,collected=0,sampled=0,rescans=0,avatars=0,historyCount=0;
 for(const vid of qualifiedVideoIds){
  const v=videos.find(v=>v.video_id===vid);if(!v){failures.push({video_id:vid,reason:'AGENT_COLLECTION_VIDEO_NOT_FINISHED'});continue;}
  const url=`https://www.douyin.com/video/${vid}`;
  if(v.video_url!==url||!['collect','collect_partial'].includes(v.operation)||!['quota_reached','footer_reached','no_comments','partial'].includes(v.stop_reason)||!Array.isArray(v.comments)||!Array.isArray(v.history)||!count(v.rescan_count)||!count(v.avatar_recovery_count))fail('AGENT_COLLECTION_VIDEO_SCOPE_INVALID');
  const isPartial=v.stop_reason==='partial',isQuota=v.stop_reason==='quota_reached';
  if(v.operation!==(isPartial||isQuota?'collect_partial':'collect')||isQuota&&!samplingInput)fail('AGENT_COLLECTION_OPERATION_INVALID');
  const h=v.historyReceipt;if(!h||h.status!=='verified')fail('AGENT_COLLECTION_HISTORY_SCOPE_INVALID');
  const historyFile=join(runDir,`${scope.run}-history-${vid}.json`);immutable(historyFile,h,runDir);const loaded=history.load(historyFile,runDir,{line:scope.line,run:scope.run,source_run:scope.source_run,video_id:vid,video_url:url});
  if(v.history_sha256!==undefined&&v.history_sha256!==loaded.sha256)fail('AGENT_COLLECTION_HISTORY_HASH_INVALID');
  const historical=[];
  for(const row of v.history){
   const original=loaded.rows.get(history.key(row.douyinId,row.commentBody));
   if(!original||original.id!==row.id||!uuid.test(row.id||'')||typeof row.identity_eid!=='string'||!row.identity_eid.startsWith(`${scope.run}-v${vid}-collection-person`)||row.history_sha256!==loaded.sha256)fail('AGENT_COLLECTION_HISTORY_IDENTITY_INVALID');
   const proof=JSON.parse(fileBytes(join(runDir,row.identity_eid+'-history-readback.json'),runDir,{privateFile:true,maxBytes:1000000}));
   if(proof.verified!==true||proof.id!==row.id||proof.video_id!==vid||proof.douyin_id!==row.douyinId||proof.comment_body!==row.commentBody||proof.identity_eid!==row.identity_eid||proof.history_sha256!==loaded.sha256||proof.comment_context_verified!==true||!sha.test(proof.profile_sha256||'')||!sha.test(proof.returned_sha256||''))fail('AGENT_COLLECTION_HISTORY_IDENTITY_INVALID');
   referenced(evidenceRoot,row.identity_eid+'-profile.xml',proof.profile_sha256);referenced(evidenceRoot,row.identity_eid+'-returned.xml',proof.returned_sha256);
   historical.push({...row,sourceVideoUrl:row.sourceVideoUrl||url});
  }
  for(const row of v.comments){
   if(!row.nickname||!row.douyinId||!row.commentBody||row.sourceVideoUrl!==url||row.recipientEvidence?.scope?.video_id!==vid||row.recipientEvidence.scope.profile!==scope.profile||row.recipientEvidence.scope.source_run!==scope.source_run)fail('AGENT_COLLECTION_RECIPIENT_INVALID');
   recipient.validateEvidence(row.recipientEvidence,{line_key:scope.line_key,run:scope.run,douyin_id:row.douyinId,nickname:row.nickname,comment_body:row.commentBody,comment_body_sha256:hash(row.commentBody),video_url:url},{companyBinding:scope.company_binding,...(recipientNative?{parseNative:recipientNative.parseNative}:{})});
  }
  const expected=[...historical,...v.comments].map(row=>({...row,sourceVideoUrl:row.sourceVideoUrl||url})),keys=expected.map(rowKey);
  if(new Set(expected.map(r=>JSON.stringify([r.douyinId,r.commentBody]))).size!==keys.length||samplingInput&&keys.length>samplingInput.comment_limit)fail('AGENT_COLLECTION_COVERAGE_INVALID');
  const stored=v.stored,hr=v.historyReadback,pg=v.pgReadback;
  if(stored?.video_id!==vid||!count(stored.inserted)||stored.inserted>v.comments.length||stored.comments!==v.comments.length||stored.history_verified!==historical.length||stored.coverage!==keys.length||hr?.verified!==true||hr.video_id!==vid||hr.history_verified!==historical.length||!Array.isArray(hr.ids)||hr.ids.length!==historical.length||new Set(hr.ids).size!==hr.ids.length||historical.some(r=>!hr.ids.includes(r.id)))fail('AGENT_COLLECTION_COMMIT_READBACK_INVALID');
  if(pg?.verified!==true||pg.video_id!==vid||pg.coverage!==keys.length||!Array.isArray(pg.rows)||pg.rows.length!==keys.length||new Set(pg.rows.map(rowKey)).size!==keys.length||pg.rows.some(r=>!uuid.test(r.id||'')||allIds.has(r.id)||!keys.includes(rowKey(r))))fail('AGENT_COLLECTION_PG_READBACK_INVALID');
  for(const r of pg.rows){allIds.add(r.id);const prior=historical.find(h=>rowKey(h)===rowKey(r));if(prior&&prior.id!==r.id)fail('AGENT_COLLECTION_PG_READBACK_INVALID');}
  if(new Set(pg.rows.map(r=>r.id)).size!==pg.rows.length)fail('AGENT_COLLECTION_PG_READBACK_INVALID');
  let footer=null;if(isQuota&&stored.coverage!==samplingInput.comment_limit)fail('AGENT_COLLECTION_QUOTA_UNVERIFIED');
  if(v.stop_reason==='footer_reached')footer=footerProof(v.footer_evidence,{root:evidenceRoot,run:scope.run,vid,verifyFooter});
  if(v.stop_reason==='no_comments'){if(stored.coverage!==0||v.comments.length||historical.length)fail('AGENT_COLLECTION_ZERO_INVALID');verifyNoComments({runDir,run:scope.run,videoId:vid});}
  if(!isPartial&&stored.inserted+stored.history_verified!==stored.coverage)fail('AGENT_COLLECTION_COVERAGE_NOT_ADMITTED');
  const hc={version:1,verified:true,line:scope.line,line_key:scope.line_key,run:scope.run,source_run:scope.source_run,video_id:vid,video_url:url,history_status:loaded.receipt.status,history_sha256:loaded.sha256,ids:historical.map(r=>r.id),rows:historical.map(r=>({id:r.id,douyin_id:r.douyinId,comment_body:r.commentBody,source_video_url:r.sourceVideoUrl,identity_eid:r.identity_eid})),history_verified:stored.history_verified,coverage:stored.coverage};historyArtifacts.push({vid,body:hc});
  for(const row of v.comments)lines.push(['LEAD',row.nickname,row.douyinId,row.accountType||'personal',row.commentBody,row.commentTime,row.region,row.sourceVideo,row.keyword,row.profileIp,row.profileUrl,row.sourceVideoUrl].map(tsv).join('\t'));
  const marker=isPartial?'partial':isQuota?'sampled':v.stop_reason==='no_comments'?'no_comments':'collected';lines.push(['COLLECTION',vid,marker,stored.comments,...(!isPartial?[stored.coverage,samplingInput?.comment_limit||0,...(marker==='collected'?['footer=1']:[])]:[])].join('\t'));lines.push(`RESCAN\t${vid}\t${v.rescan_count}`,`AVATAR_RECOVERY\t${vid}\t${v.avatar_recovery_count}`);
  comments+=stored.comments;inserted+=stored.inserted;covered+=stored.coverage;oldCount+=stored.history_verified;rescans+=v.rescan_count;avatars+=v.avatar_recovery_count;historyCount++;
  if(isPartial)failures.push({video_id:vid,reason:'AGENT_COLLECTION_PARTIAL_COMMITTED',comments_saved:stored.comments});
  else{if(isQuota)sampled++;else collected++;if(samplingInput)receipts.push({video_url:url,pg_rows:pg.rows,video_id:vid,source_run:scope.source_run,comment_limit:samplingInput.comment_limit,stop_reason:v.stop_reason,coverage:stored.coverage,comments:stored.comments,comments_inserted:stored.inserted,history_verified:stored.history_verified,all_comments_scanned:!isQuota});}
  proofs.push({video_id:vid,stored,history_readback:hr,pg_readback:pg,stop_reason:v.stop_reason,...(footer?{footer}:{}),native_recipient_sha256:v.comments.map(r=>hash(JSON.stringify(r.recipientEvidence)))});
 }
 // Only publish completion artifacts after all supplied rows and original proofs pass.
 for(const h of historyArtifacts)immutable(join(runDir,`${scope.run}-history-consumption-${h.vid}.json`),h.body,runDir);
 if(receipts.length)immutable(join(runDir,scope.run+'-sampling-readback.json'),{run_id:scope.run_id,sampling_input:samplingInput,verified:true,videos:receipts},runDir);
 immutable(join(runDir,scope.run+'-agent-collection-receipts.json'),{version:1,run_id:scope.run_id,source_commit:scope.source_commit,videos:proofs},runDir);
 const text=lines.join('\n')+'\n',file=join(runDir,'comments.tsv');if(existsSync(file)){if(fileBytes(file,runDir,{privateFile:true}).toString()!==text)fail('AGENT_ARTIFACT_IMMUTABLE_CHANGED');}else{const fd=openSync(file,'wx',0o600);try{writeFileSync(fd,text);fsyncSync(fd);}finally{closeSync(fd);}}
 const required=qualifiedVideoIds.length;
 return {sampling_receipts:receipts.map(({pg_rows,...rest})=>rest),fulfilled_sample_video_ids:receipts.map(r=>r.video_id),sampling_required_count:samplingInput?required:0,sampling_readback_count:receipts.length,collected,videos_collected:collected,videos_sampled:sampled,comment_sample_limit:samplingInput?.comment_limit||0,comments,comments_collected:comments,comments_inserted:inserted,history_verified:oldCount,coverage:covered,history_required_count:required,history_scoped_count:historyCount,history_consumption_count:historyCount,history_failures:required-historyCount,history_scope_verified:Number(required>0&&historyCount===required),history_consumption_readback:Number(required>0&&historyCount===required),videos_processed:collected+sampled,rescan_count:rescans,identity_rescan_count:rescans,avatar_recovery_count:avatars,identity_rescan_rate:required?rescans/required:0,rescan_rate:required?rescans/required:0,failures,...(failures.length?{status:'partial'}:required===0?{status:'empty'}:{})};
}
