import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {constants,closeSync,fstatSync,openSync,readFileSync,realpathSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {publishNativeFile,readArtifact} from './standalone-native-evidence.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const action=/^[a-zA-Z0-9_-]{1,100}$/;
const fail=(reason,cause)=>{
  const code='STANDALONE_COLLECTION_PREPARE_'+reason;
  throw Object.assign(Error(code,{cause}),{code});
};

export function createStandaloneQualificationPreparation({runDirectory,runIdentity,verifyProof,getPolicy,transcribe}) {
  let attempted,prepared;
  return async function prepare(input,proof,videoId) {
    const {args,action_name:actionName}=input??{};
    const keys=Object.keys(input??{}).sort().join(',');
    if(!proof||!/^\d{16,24}$/.test(videoId??'')||!Array.isArray(args)||args.length!==2||args[0]!==videoId
      ||typeof args[1]!=='string'||!['args','action_name,args'].includes(keys)||actionName!==undefined&&!action.test(actionName))
      fail('SCOPE');
    const request=JSON.stringify({args,actionName,proof:proof.sha256});
    if(attempted){
      if(attempted!==request)fail('CONFLICT');
      if(!prepared)fail('ASR_UNRESOLVED');
      try {
        if(sha(readArtifact(prepared.dossier_ref.path,0))!==prepared.dossier_ref.sha256)fail('DOSSIER');
      } catch { fail('DOSSIER'); }
      return structuredClone(prepared);
    }
    const original=await verifyProof(proof,args);
    const actualPolicy=await getPolicy(videoId);
    if(actualPolicy.video_id!==videoId||typeof actualPolicy.policy!=='string'||actualPolicy.policy_sha256!==sha(actualPolicy.policy))
      fail('POLICY');
    let policy;
    try { policy=JSON.parse(actualPolicy.policy); } catch { fail('POLICY'); }
    attempted=request;
    let response;
    try { response=await transcribe(args[1],original.audio_sha256); } catch { fail('ASR_UNRESOLVED'); }
    if(typeof response?.text!=='string'||!response.text.trim()||Buffer.byteLength(response.text)>256*1024||!response.receipt)
      fail('ASR_UNRESOLVED');
    const provenance=Buffer.from(JSON.stringify(response.receipt)+'\n');
    if(provenance.length>65536)fail('ASR_UNRESOLVED');
    const asr=publishNativeFile(runDirectory,'qualification-asr.json',provenance);
    const dossier={
      scope:{...runIdentity,video_id:videoId,proof_sha256:proof.sha256},
      policy,policy_sha256:actualPolicy.policy_sha256,transcript:response.text,
      transcript_sha256:sha(JSON.stringify(response.text)),visual:original.visual,
      asr_receipt_sha256:asr.sha256,audio_sha256:original.audio_sha256,duration_seconds:original.duration_seconds,
    };
    const bytes=Buffer.from(JSON.stringify(dossier)+'\n');
    const ref=publishNativeFile(runDirectory,'qualification-dossier.json',bytes);
    const receipt={status:'prepared',preparation_action_name:actionName??randomUUID(),
      dossier_sha256:sha(JSON.stringify(dossier)),dossier_ref:{...ref,path:join(runDirectory,ref.path)},asr_receipt:asr};
    const proofOfPreparation=publishNativeFile(runDirectory,'qualification-prepared.json',Buffer.from(
      JSON.stringify({identity:runIdentity,args,proof_sha256:proof.sha256,...receipt})+'\n',
    ));
    prepared={...receipt,preparation_receipt:proofOfPreparation};
    return structuredClone(prepared);
  };
}

function checkedBytes(path,expected) {
  if(!/^[a-f0-9]{64}$/.test(expected??''))fail('SOURCE');
  const bytes=readFileSync(path);
  if(realpathSync(path)!==path||sha(bytes)!==expected)fail('SOURCE');
  return bytes;
}

export function createStandaloneQualificationEvidenceReader({frozen,runDirectory,runIdentity,execute}) {
  const readFrozenFile=name=>checkedBytes(join(runDirectory,name),frozen.files[name]);
  const phone=frozen.collection_phone_scope;
  return async function verify(proof,[videoId,audio]) {
    try{
      const bytes=readArtifact(join(runDirectory,proof.path),0);
      if(proof.path!=='native/qualification-proof.json'||sha(bytes)!==proof.sha256)fail('PROOF');
      const manifest=JSON.parse(bytes),evidence=manifest.qualification_evidence,spec=evidence?.[videoId];
      if(manifest.schema!=='activity-evidence/v1'||!isDeepStrictEqual(manifest.identity,runIdentity)
        ||spec?.wav?.path!==audio||sha(readArtifact(audio,0))!==spec.wav.sha256)fail('PROOF');

      const epochRef=phone.policy_binding.epoch_fence,epoch=JSON.parse(checkedBytes(epochRef.path,epochRef.sha256));
      const runtime=JSON.parse(readFrozenFile('runtime/runtime/runtime-policy-sdk33.json'));
      if(epoch.resource?.serial!==phone.serial||epoch.resource?.profile!==phone.profile||!epoch.resource?.adb_serial
        ||spec.serial!==epoch.resource.adb_serial||spec.local_owner!==runIdentity.run_tag
        ||['client_sha256','server_sha256'].some(key=>spec[key]!==runtime[key]))fail('ARTIFACT');
      const executable=phone.executables.python,program='runtime/qualification-artifacts.py';
      checkedBytes(executable.path,executable.sha256);
      readFrozenFile(program);
      const timeoutMs=Math.min(20000,frozen.standalone_skill.deadline_ms-Date.now());
      if(timeoutMs<=0)fail('ARTIFACT');
      const result=await execute(executable.path,['-I',join(runDirectory,program)],{
        input:JSON.stringify({kind:'recording',spec}),timeoutMs,
      });
      const recording=JSON.parse(result.stdout);
      if(result.code!==0||recording.capture_or_valid_cache!=='passed'||recording.native_video_identity!=='passed'
        ||recording.audio_sha256!==spec.wav.sha256||!Number.isFinite(recording.audio_seconds)
        ||recording.audio_seconds<1||recording.audio_seconds>185)fail('ARTIFACT');

      const {collectVisualEvidence}=await loadVisualVerifier(readFrozenFile);
      const reference=publishVisualReceipt({runDirectory,runIdentity,spec});
      const visual=collectVisualEvidence({proof:{...manifest,qualification_evidence:{
        ...spec,...evidence,audio:spec.wav,video_identity:reference,
      }},hostRoot:runDirectory,identity:runIdentity,videoId,audio,audioSha:recording.audio_sha256});
      return {audio_sha256:recording.audio_sha256,duration_seconds:recording.audio_seconds,visual};
    }catch(error){
      if(error.code?.startsWith('STANDALONE_COLLECTION_PREPARE_'))throw error;
      fail('ARTIFACT',error);
    }
  };
}

async function loadVisualVerifier(readFrozenFile) {
  const archive=JSON.parse(readFrozenFile('runtime/leadgen-foundation/sources/102.json'));
  const entry=archive.files?.['qualification/visual-evidence.mjs'];
  if(typeof entry?.source!=='string'||sha(entry.source)!==entry.sha256)fail('SOURCE');
  return import('data:text/javascript;base64,'+Buffer.from(entry.source).toString('base64'));
}

function publishVisualReceipt({runDirectory,runIdentity,spec}) {
  const raw=readArtifact(spec.video_identity.path,0);
  if(sha(raw)!==spec.video_identity.sha256)fail('ARTIFACT');
  const receipt=JSON.parse(raw);
  const bytes=Buffer.from(JSON.stringify({state:'terminal',
    binding:{activity:'qualification',args:receipt.args,identity:runIdentity},
    result:{exit_code:receipt.exit_code,stdout:receipt.stdout},
  })+'\n');
  const ref=publishNativeFile(runDirectory,'qualification-visual-identity.json',bytes,'receipts');
  return {...ref,path:join(runDirectory,ref.path)};
}

const failLegacy=reason=>{
  const code='STANDALONE_COLLECTION_'+reason;
  throw Object.assign(Error(code),{code});
};

function nativeFields(output,marker){
  const lines=String(output).split('\n').filter(line=>line.startsWith(marker+' '));
  if(lines.length!==1)return {};
  return Object.fromEntries([...lines[0].matchAll(/(?:^| )([a-z0-9_]+)=([^ ]+)/g)]
    .map(([,key,value])=>[key,value]));
}
function verifiedWav(path){
  let fd;
  try {
    fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.size<1000||stat.size>16*1024*1024||stat.mode&0o022
      ||stat.uid!==process.getuid()||realpathSync(path)!==path)failLegacy('AUDIO_FILE');
    const bytes=readFileSync(fd),after=fstatSync(fd);
    if(bytes.length!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs
      ||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')failLegacy('AUDIO_FILE');
    return createHash('sha256').update(bytes).digest('hex');
  } catch {
    failLegacy('AUDIO_FILE');
  } finally {
    if(fd!==undefined)closeSync(fd);
  }
}

export async function prepareStandaloneCollectionAudio({evidenceRoot,recordingId,stoppedOutput,audioOutput,transcribe}){
  const stopped=nativeFields(stoppedOutput,'record_stopped');
  if(!(Number(stopped.audio_streams)>0)||stopped.playback_restored!=='true'||stopped.playback_proof_kind!=='native_audio'
    ||!Number.isFinite(Number(stopped.mean_volume_db))||Number(stopped.mean_volume_db)<=-80)failLegacy('RECORDING_PROOF');
  const audio=nativeFields(audioOutput,'audio_extracted'),duration=Number(audio.duration_seconds);
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(recordingId??'')||!evidenceRoot||realpathSync(evidenceRoot)!==evidenceRoot
    ||audio.path!==join(evidenceRoot,recordingId+'.16k.wav')||audio.sample_rate!=='16000'||audio.channels!=='1'
    ||!Number.isFinite(duration)||duration<1||duration>185)failLegacy('AUDIO_FILE');
  const hash=verifiedWav(audio.path);
  if(typeof transcribe!=='function')failLegacy('ASR_UNAVAILABLE');
  const transcript=await transcribe(audio.path);
  if(typeof transcript!=='string'||!transcript.trim()||Buffer.byteLength(transcript)>256*1024)failLegacy('ASR_EMPTY');
  if(verifiedWav(audio.path)!==hash)failLegacy('AUDIO_CHANGED');
  return {transcript,audio_sha256:hash,duration_seconds:duration};
}


export function reviewStandalonePreparedDecision({runDirectory,runIdentity,videoId,audio,preparationSha,proposal}) {
  const reject=reason=>{
    const code='STANDALONE_COLLECTION_SUBMIT_'+reason;
    throw Object.assign(Error(code),{code});
  };
  let dossier,receipt;
  try {
    const preparation=readArtifact(join(runDirectory,'native/qualification-prepared.json'),0);
    receipt=JSON.parse(preparation);
    const dossierPath=join(runDirectory,'native/qualification-dossier.json');
    const raw=readArtifact(dossierPath,0);
    dossier=JSON.parse(raw);
    const currentProof=readArtifact(join(runDirectory,'native/qualification-proof.json'),0);
    const asr=readArtifact(join(runDirectory,'native/qualification-asr.json'),0);
    if(sha(preparation)!==preparationSha||receipt.status!=='prepared'||!isDeepStrictEqual(receipt.identity,runIdentity)
      ||!isDeepStrictEqual(receipt.args,[videoId,audio])||receipt.dossier_ref.path!==dossierPath||receipt.dossier_ref.sha256!==sha(raw)
      ||receipt.dossier_sha256!==sha(JSON.stringify(dossier))||sha(currentProof)!==receipt.proof_sha256
      ||dossier.asr_receipt_sha256!==sha(asr)||receipt.asr_receipt.sha256!==sha(asr)
      ||!isDeepStrictEqual(dossier.scope,{...runIdentity,video_id:videoId,proof_sha256:receipt.proof_sha256}))
      reject('PREPARATION');
  } catch {
    reject('PREPARATION');
  }
  const {verdict,reason,transcript_quote:quote,frame_labels:frameLabels}=proposal??{};
  if(Object.keys(proposal??{}).sort().join(',')!=='dossier_sha256,frame_labels,preparation_action_name,reason,transcript_quote,verdict'
    ||proposal.dossier_sha256!==receipt.dossier_sha256||proposal.preparation_action_name!==receipt.preparation_action_name
    ||!['matched','rejected'].includes(verdict)||typeof reason!=='string'||!reason.trim()||reason.length>2000
    ||typeof quote!=='string'||!quote.trim()||quote.length>1000||!dossier.transcript.includes(quote)
    ||!Array.isArray(frameLabels)||!frameLabels.length||new Set(frameLabels).size!==frameLabels.length
    ||!frameLabels.every(label=>dossier.visual.frames.some(frame=>frame.label===label)))reject('EVIDENCE');
  return {
    verdict,reason,quote,transcript:dossier.transcript,policy_sha256:dossier.policy_sha256,
    audio_sha256:dossier.audio_sha256,duration_seconds:dossier.duration_seconds,
    provenance:{source:'activity_agent',identity:runIdentity,dossier_sha256:receipt.dossier_sha256,
      proof_sha256:receipt.proof_sha256,preparation_action_name:receipt.preparation_action_name,
      preparation_sha256:preparationSha,asr_receipt_sha256:dossier.asr_receipt_sha256,
      frame_labels:[...frameLabels],visual_sha256:dossier.visual.sha256},
  };
}

export function standaloneQualificationDecisionId(reviewed,actionName) {
  return sha(JSON.stringify({action_name:actionName,verdict:reviewed.verdict,reason:reviewed.reason,
    quote:reviewed.quote,provenance:reviewed.provenance}));
}

export function createStandaloneQualificationSubmission({runDirectory,runIdentity,scope,queue}) {
  let write;
  const reject=reason=>{
    const code='STANDALONE_COLLECTION_SUBMIT_'+reason;
    throw Object.assign(Error(code),{code});
  };
  return async function submit(input,prepared,videoId) {
    const {args,action_name:requestedAction}=input??{};
    const keys=Object.keys(input??{}).sort().join(',');
    if(!prepared||!videoId||!Array.isArray(args)||args.length!==3||args[0]!==videoId
      ||typeof args[1]!=='string'||typeof args[2]!=='string'||Buffer.byteLength(args[2])>65536
      ||!['args','action_name,args'].includes(keys)||requestedAction!==undefined&&!action.test(requestedAction))reject('SCOPE');
    let proposal;
    try { proposal=JSON.parse(args[2]); } catch { reject('EVIDENCE'); }
    const actionName=requestedAction??'submit-'+prepared.preparation_receipt.sha256;
    if(actionName===prepared.preparation_action_name)reject('SCOPE');
    const preparationSha=prepared.preparation_receipt.sha256;
    const reviewed=reviewStandalonePreparedDecision({runDirectory,runIdentity,videoId,audio:args[1],preparationSha,proposal});
    const decisionSha=standaloneQualificationDecisionId(reviewed,actionName);
    if(write&&write!==decisionSha)reject('CONFLICT');
    if(!write){
      write=decisionSha;
      try {
        await queue('qualification_submit',{video_id:videoId,committed_origin_run:scope.source_run,proposal,
          audio_path:args[1],preparation_sha256:preparationSha,submission_action_name:actionName,decision_sha256:decisionSha});
      } catch {
        // An interrupted commit is resolved by the same video and decision readback.
      }
    }
    let rows;
    try { rows=await queue('inspect_videos',{video_ids:[videoId]}); } catch { reject('READBACK'); }
    const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
    const config=row?.judgment_config;
    if(row?.video_id!==videoId||row.judgment_status!==reviewed.verdict||row.harvest_batch!==scope.run_tag
      ||row.process_status!=='处理中:'+scope.run_tag||config?.run_id!==scope.run_tag
      ||!['company_id','tenant_id','version','policy_id'].every(key=>config[key]===scope.company[key])
      ||config.qualification_agent?.preparation_sha256!==preparationSha
      ||config.qualification_agent?.decision_sha256!==decisionSha)reject('READBACK');
    const result={verified:true,video_id:videoId,verdict:reviewed.verdict,decision_sha256:decisionSha,submission_action_name:actionName};
    const receipt=publishNativeFile(runDirectory,'qualification-submitted.json',
      Buffer.from(JSON.stringify({identity:runIdentity,...result})+'\n'));
    return {...result,submission_receipt:receipt};
  };
}
