import {constants,closeSync,fstatSync,openSync,readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const sha=value=>createHash('sha256').update(value).digest('hex');

const tag = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/;
const videoId = /^\d{16,24}$/;
const fail = reason => {
  const code='STANDALONE_COLLECTION_'+reason;
  throw Object.assign(Error(code),{code});
};

function checkSource(request,scope,operation='collect_claim') {
  if (scope?.workflow_key !== 'douyin_video_processing' || scope.limit !== 1
    || request.op !== operation || request.source_run !== null || request.limit !== 1
    || request.line !== scope.line || request.run !== scope.run_tag
    || ![scope.line,scope.run_tag,scope.source_run].every(value=>typeof value==='string'&&tag.test(value))
    || scope.source_run === scope.run_tag || request.committed_origin_run !== scope.source_run) fail('ORIGIN');
}

const observedOrigin = `discovery_metrics->'company_binding'->>'run_id'=$2
    AND discovery_metrics->'company_binding'->>'company_id'=$3
    AND discovery_metrics->'company_binding'->>'tenant_id'=$4
    AND discovery_metrics->'company_binding'->>'version'=$5
    AND discovery_metrics->'company_binding'->>'line_key'=$1`;

async function currentCollectionConfig(client,{line,run_tag:run,company}){
  const configs=(await client.query(`SELECT company_id,tenant_id,version,run_id,source_run,snapshot
    FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=$2 FOR SHARE`,[company.company_id,run])).rows;
  const config=configs[0];
  if(configs.length!==1||config.run_id!==run||config.tenant_id!==company.tenant_id||Number(config.version)!==company.version
    ||config.source_run!==null||config.snapshot?.config_status!=='enabled'||config.snapshot.runtime_config?.routing?.line_key!==line
    ||['company_id','tenant_id','version','policy_id'].some(key=>config.snapshot[key]!==company[key])) fail('COMPANY');
  return config.snapshot;
}

// 仅领取已核原来源的视频。保留此批次在普通采集账上的身份，供 103 按精确来源读取。
export async function claimStandaloneCollectionVideo(pool,request,scope) {
  checkSource(request,scope);
  const {line,run_tag:run,source_run:origin,company}=scope;
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['standalone-102:'+line+':'+run]);
    await currentCollectionConfig(client,scope);
    const claimed='处理中:'+run;
    const parameters=[line,origin,company.company_id,company.tenant_id,String(company.version),run,claimed];
    let rows=(await client.query(`SELECT video_id,video_url,title,judgment_status,process_status,harvest_batch
      FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND ${observedOrigin}
      AND harvest_batch=$6 AND process_status=$7 LIMIT 2 FOR UPDATE`,parameters)).rows;
    if(!rows.length) {
      rows=(await client.query(`WITH pending AS (
        SELECT id FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND harvest_batch=$2 AND ${observedOrigin}
          AND judgment_status IN ('pending','matched') AND process_status IN ('待判定','待采评论')
        ORDER BY discovered_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
      UPDATE zenithjoy.leadgen_videos AS video SET process_status=$7,harvest_batch=$6,updated_at=now()
      FROM pending WHERE pending.id=video.id
      RETURNING video_id,video_url,title,judgment_status,process_status,harvest_batch`,parameters)).rows;
    }
    const row=rows[0];
    if(rows.length>1||row&&(!videoId.test(row.video_id)||row.video_url!=='https://www.douyin.com/video/'+row.video_id
      ||typeof row.title!=='string'||row.harvest_batch!==run||row.process_status!==claimed
      ||!['pending','matched'].includes(row.judgment_status))) fail('CLAIM_READBACK');
    await client.query('COMMIT');
    return {source_run:origin,video:row?{
      video_id:row.video_id,video_url:row.video_url,title:row.title,judgment_status:row.judgment_status,
    }:null};
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function reviewStandaloneCollectionQuote(proposal,{policy,transcript}){
  if(!proposal||Object.keys(proposal).sort().join(',')!=='policy_quote,quote,reason,verdict'
    ||!['matched','rejected'].includes(proposal.verdict)
    ||!['quote','policy_quote','reason'].every(key=>typeof proposal[key]==='string'&&proposal[key].trim()&&proposal[key].length<=1500)
    ||!transcript.includes(proposal.quote)||!policy.includes(proposal.policy_quote))fail('QUALIFICATION_QUOTE');
  return structuredClone(proposal);
}
async function ownedQualification(client,request,scope,{lock=false}={}){
  const {line,run_tag:run,source_run:origin,company}=scope;
  if(typeof request.video_id!=='string'||!videoId.test(request.video_id))fail('VIDEO_SCOPE');
  const snapshot=await currentCollectionConfig(client,scope);
  const candidates=(await client.query(`SELECT id,video_id,video_url,title,judgment_status,judgment_config,transcript
    FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND ${observedOrigin}
      AND harvest_batch=$6 AND process_status=$7 AND video_id=$8${lock?' FOR UPDATE':''}`,
    [line,origin,company.company_id,company.tenant_id,String(company.version),run,'处理中:'+run,request.video_id])).rows;
  const row=candidates[0];
  if(candidates.length!==1||row.video_url!=='https://www.douyin.com/video/'+request.video_id)fail('LEASE_READBACK');
  const policy=require('./company-config-lib.js').configTargetProfile(snapshot,'102');
  return {row,policy,snapshot};
}
export async function readStandaloneCollectionPolicy(pool,request,scope){
  checkSource(request,scope,'qualification_policy');
  const {row,policy}=await ownedQualification(pool,request,scope);
  return {video_id:row.video_id,policy,policy_sha256:sha(policy)};
}

export async function recordStandaloneCollectionQualification(pool,request,scope){
  checkSource(request,scope,'qualification_submit');
  const transcript=request.transcript;
  if(typeof transcript!=='string'||!transcript.trim()||Buffer.byteLength(transcript)>256*1024
    ||!/^[a-f0-9]{64}$/.test(request.audio_sha256??'')||!Number.isFinite(request.duration_seconds)
    ||request.duration_seconds<1||request.duration_seconds>185)fail('RECORDING_PROOF');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const {row,policy,snapshot}=await ownedQualification(client,request,scope,{lock:true});
    if(request.policy_sha256!==sha(policy))fail('QUALIFICATION_POLICY_CHANGED');
    const vote=reviewStandaloneCollectionQuote(request.proposal,{policy,transcript});
    const evidence={...require('./judge-video.js').configEvidence(snapshot,scope.run_tag),source_101_run:scope.source_run,
      actor:'codex',audio_sha256:request.audio_sha256,transcript_sha256:sha(transcript),policy_sha256:request.policy_sha256,
      duration_seconds:request.duration_seconds,quote:vote.quote,policy_quote:vote.policy_quote,
      verdict_sha256:sha(JSON.stringify(vote))};
    if(row.judgment_config?.run_id===scope.run_tag){
      if(row.judgment_config.verdict_sha256!==evidence.verdict_sha256||row.judgment_config.audio_sha256!==evidence.audio_sha256
        ||row.judgment_status!==vote.verdict||row.transcript!==transcript)fail('QUALIFICATION_CONFLICT');
    }else{
      const saved=await client.query(`UPDATE zenithjoy.leadgen_videos SET judgment_status=$2,judgment_reason=$3,
        transcript=$4,judgment_config=$5::jsonb,updated_at=now()
        WHERE id=$1 AND harvest_batch=$6 AND process_status=$7
        RETURNING video_id,judgment_status,transcript,judgment_config`,
        [row.id,vote.verdict,vote.reason,transcript,JSON.stringify(evidence),scope.run_tag,'处理中:'+scope.run_tag]);
      const actual=saved.rows[0];
      if(saved.rowCount!==1||actual.video_id!==row.video_id||actual.judgment_status!==vote.verdict
        ||actual.transcript!==transcript||actual.judgment_config?.audio_sha256!==evidence.audio_sha256)fail('QUALIFICATION_WRITE');
    }
    await client.query('COMMIT');
    return {verified:true,video_id:row.video_id,verdict:vote.verdict,policy_sha256:evidence.policy_sha256};
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{
    client.release();
  }
}

export async function readStandaloneCollectionComment(pool,request,scope){
  checkSource(request,scope,'collect_comment_readback');
  const {row}=await ownedQualification(pool,request,scope);
  if(row.judgment_status!=='matched'||row.judgment_config?.run_id!==scope.run_tag)fail('QUALIFICATION_REQUIRED');
  const {douyin_id,comment_body,profile_url}=request;
  if(![douyin_id,comment_body,profile_url].every(value=>typeof value==='string'&&value.length>0&&value.length<=8192))fail('COMMENT_SCOPE');
  const {rows}=await pool.query(`SELECT id FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND harvest_batch=$2
    AND source_video_url=$3 AND douyin_id=$4 AND comment_body=$5 AND profile_url=$6 LIMIT 2`,
    [scope.line,scope.run_tag,row.video_url,douyin_id,comment_body,profile_url]);
  if(rows.length!==1)fail('COMMENT_READBACK');
  const result=await require('./leadgen-queue.js').queueRequest(pool,{op:'certify_collected_comment_readback',
    line:scope.line,run:scope.run_tag,source_run:null,video_id:row.video_id,comment_id:rows[0].id});
  if(result.verified!==true||result.id!==rows[0].id||result.douyin_id!==douyin_id)fail('COMMENT_READBACK');
  return {verified:true,comment_id:result.id,video_id:row.video_id};
}

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
      ||stat.uid!==process.getuid()||realpathSync(path)!==path)fail('AUDIO_FILE');
    const bytes=readFileSync(fd),after=fstatSync(fd);
    if(bytes.length!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs
      ||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')fail('AUDIO_FILE');
    return createHash('sha256').update(bytes).digest('hex');
  } catch {
    fail('AUDIO_FILE');
  } finally {
    if(fd!==undefined)closeSync(fd);
  }
}

export async function prepareStandaloneCollectionAudio({evidenceRoot,recordingId,stoppedOutput,audioOutput,transcribe}){
  const stopped=nativeFields(stoppedOutput,'record_stopped');
  if(!(Number(stopped.audio_streams)>0)||stopped.playback_restored!=='true'||stopped.playback_proof_kind!=='native_audio'
    ||!Number.isFinite(Number(stopped.mean_volume_db))||Number(stopped.mean_volume_db)<=-80)fail('RECORDING_PROOF');
  const audio=nativeFields(audioOutput,'audio_extracted'),duration=Number(audio.duration_seconds);
  if(!tag.test(recordingId??'')||!evidenceRoot||realpathSync(evidenceRoot)!==evidenceRoot
    ||audio.path!==join(evidenceRoot,recordingId+'.16k.wav')||audio.sample_rate!=='16000'||audio.channels!=='1'
    ||!Number.isFinite(duration)||duration<1||duration>185)fail('AUDIO_FILE');
  const hash=verifiedWav(audio.path);
  if(typeof transcribe!=='function')fail('ASR_UNAVAILABLE');
  const transcript=await transcribe(audio.path);
  if(typeof transcript!=='string'||!transcript.trim()||Buffer.byteLength(transcript)>256*1024)fail('ASR_EMPTY');
  if(verifiedWav(audio.path)!==hash)fail('AUDIO_CHANGED');
  return {transcript,audio_sha256:hash,duration_seconds:duration};
}

const accountCommand = 'account-current';
const links = 'current-video-link';
const waitForRecord = new Set(['record-status','record-stop','record-extract-audio']);
const captureCommands = new Set(['ui-evidence','snapshot-evidence']);
const commandList = ['open-app',accountCommand,'open-video',links,'record-start',...waitForRecord,...captureCommands];
const operations = ['company_config','collect_claim','qualification_input','qualification_submit','qualification_readback','scan_comments','scroll_comments','prepare_comment','collect_submit'];
const projectFields = stdout => Object.fromEntries(String(stdout).split('\n')
  .filter(line=>line.includes('=')).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]));

export function createStandaloneCollectionTools({scope,rpc,phone,assertAuthority,evidenceRoot,transcribe,commentObserver}) {
  const {line,run_tag:run,source_run:origin,profile,serial,expected_account:account,company}=scope;
  checkSource({op:'collect_claim',line,run,source_run:null,committed_origin_run:origin,limit:1},scope);
  let verifiedAccount=false, binding=null, owned=null, verifiedVideo=false, recording=null, busy=false, claimInDoubt=false;
  const evidenceIds=new Set();
  let asrAttempted=false, submitted=false, qualificationInput, qualified=false;
  const preparedComments=new Map(),committedLookups=new Map(),pendingLookups=new Set();

  function evidence(id,{existing=false}={}) {
    if(typeof id!=='string'||!tag.test(id)||!id.startsWith(run+'-')||evidenceIds.has(id)!==existing)fail('EVIDENCE_ID');
    if(!existing)evidenceIds.add(id);
  }
  async function queue(op,fields) {
    const response=await rpc({kind:'queue',request:{op,line,run,source_run:null,limit:1,...fields}});
    if(response?.ok!==true||response.result==null)fail('RECEIPT');
    return response.result;
  }
  async function readComment(comment){
    return queue('collect_comment_readback',{video_id:owned.video_id,committed_origin_run:origin,
      douyin_id:comment.douyinId,comment_body:comment.commentBody,profile_url:comment.profileUrl});
  }
  async function performComments(operation,input){
    if(!qualified||!verifiedVideo||!owned)fail('QUALIFICATION_REQUIRED');
    if(!commentObserver||!Number.isInteger(scope.comment_limit)||scope.comment_limit<1||scope.comment_limit>5)fail('COMMENT_SCOPE');
    if(operation==='scan_comments'){
      const result=await commentObserver.scan();
      return result;
    }
    if(operation==='scroll_comments'){
      await commentObserver.advance();
      return {advanced:true};
    }
    if(operation==='prepare_comment'){
      if(preparedComments.size+committedLookups.size>=scope.comment_limit)fail('COMMENT_SCOPE');
      const result=await commentObserver.identify(input.index,owned,binding);
      if(result.excluded)return result;
      const id=randomUUID();
      const comment=result.comment;
      if([...preparedComments.values(),...committedLookups.values()].some(item=>item.douyinId===comment.douyinId&&item.commentBody===comment.commentBody)){
        return {duplicate:true};
      }
      preparedComments.set(id,comment);
      return {reference:id};
    }
    const reference=input.reference,comment=preparedComments.get(reference);
    if(!comment||committedLookups.size>=scope.comment_limit)fail('COMMENT_SCOPE');
    if(!pendingLookups.has(reference)){
      pendingLookups.add(reference);
      const result=await queue('collect_partial',{video_id:owned.video_id,video_url:owned.video_url,comments:[comment],history:[]});
      if(result.video_id!==owned.video_id||result.coverage!==1)fail('COMMENT_READBACK');
    }
    const proof=await readComment(comment);
    if(proof.verified!==true||proof.video_id!==owned.video_id||typeof proof.comment_id!=='string')fail('COMMENT_READBACK');
    committedLookups.set(proof.comment_id,comment);
    preparedComments.delete(reference);pendingLookups.delete(reference);
    return proof;
  }

  async function performBusiness(operation,proposal) {
    if(!verifiedAccount)fail('ACCOUNT_REQUIRED');
    if(operation==='company_config') {
      const result=await queue(operation,{step:'102',device_binding:{profile,device_serial:serial}});
      const device=result.device_binding;
      if(result.run_id!==run||['company_id','tenant_id','version','policy_id'].some(key=>result[key]!==company[key])
        ||['company_id','tenant_id','version'].some(key=>device?.[key]!==company[key])
        ||device.profile!==profile||device.device_serial!==serial||device.douyin_id!==account
        ||device.enabled!==true||device.verification_status!=='verified')fail('ACCOUNT_CONFIG');
      binding={...device,line_key:line,source_run:null};
      return result;
    }
    if(!binding)fail('COMPANY_REQUIRED');
    if(operation==='collect_claim') {
      if(owned)return {source_run:origin,video:structuredClone(owned)};
      claimInDoubt=true;
      const result=await queue(operation,{committed_origin_run:origin});
      if(result.source_run!==origin||result.video&&(!videoId.test(result.video.video_id||'')
        ||result.video.video_url!=='https://www.douyin.com/video/'+result.video.video_id))fail('CLAIM_RECEIPT');
      owned=result.video;claimInDoubt=false;
      return result;
    }
    if(!owned||!verifiedVideo)fail('VIDEO_UNVERIFIED');
    if(['scan_comments','scroll_comments','prepare_comment','collect_submit'].includes(operation))return performComments(operation,proposal);
    if(operation==='qualification_input'){
      if(qualificationInput)return structuredClone(qualificationInput);
      if(!recording?.stopped||!recording.audioOutput)fail('RECORDING_PROOF');
      if(asrAttempted)fail('ASR_ATTEMPTED');
      asrAttempted=true;
      const policy=await queue('qualification_policy',{video_id:owned.video_id,committed_origin_run:origin});
      if(policy.video_id!==owned.video_id||typeof policy.policy!=='string'||policy.policy_sha256!==sha(policy.policy))fail('QUALIFICATION_POLICY_CHANGED');
      const prepared=await prepareStandaloneCollectionAudio({evidenceRoot,recordingId:recording.id,
        stoppedOutput:recording.stoppedOutput,audioOutput:recording.audioOutput,transcribe});
      qualificationInput={video_id:owned.video_id,video_title:owned.title,source_run:origin,...prepared,policy:policy.policy,policy_sha256:policy.policy_sha256};
      return structuredClone(qualificationInput);
    }
    if(operation==='qualification_submit'){
      if(!qualificationInput)fail('RECORDING_PROOF');
      if(submitted)fail('QUALIFICATION_CONFLICT');
      const vote=reviewStandaloneCollectionQuote(proposal,qualificationInput);
      const {video_id,transcript,policy_sha256,audio_sha256,duration_seconds}=qualificationInput;
      submitted=true;
      const result=await queue('qualification_submit',{video_id,transcript,policy_sha256,audio_sha256,duration_seconds,
        committed_origin_run:origin,proposal:vote});
      if(result.verified!==true||result.video_id!==video_id||result.verdict!==vote.verdict)fail('QUALIFICATION_WRITE');
      return result;
    }
    const rows=await queue('inspect_videos',{video_ids:[owned.video_id]});
    const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
    if(!row||row.video_id!==owned.video_id||row.harvest_batch!==run||row.process_status!=='处理中:'+run)fail('LEASE_READBACK');
    const qualification=row.judgment_config;
    const currentPolicy=qualification?.run_id===run&&['company_id','tenant_id','version','policy_id'].every(key=>qualification[key]===company[key]);
    qualified=currentPolicy&&row.judgment_status==='matched';
    return {video_id:row.video_id,judgment_status:row.judgment_status,current_policy:currentPolicy};
  }

  async function performPhone(command,args) {
    if(!Array.isArray(args)||!commandList.includes(command))fail('PHONE_INPUT');
    if(command==='open-app') {
      if(args.length||owned)fail('PHONE_INPUT');
    } else if(command===accountCommand) {
      if(args.length!==1||owned)fail('PHONE_INPUT');
      evidence(args[0]);verifiedAccount=false;
    } else {
      if(!owned)fail('VIDEO_SCOPE');
      if(command==='open-video') {
        if(args.length!==2||args[0]!==owned.video_id||recording&&!recording.stopped)fail('VIDEO_SCOPE');
        evidence(args[1]);verifiedVideo=false;commentObserver?.reset();
      } else if(command===links||captureCommands.has(command)) {
        if(args.length!==1||recording&&!recording.stopped&&command===links)fail('PHONE_INPUT');
        evidence(args[0]);if(command===links)verifiedVideo=false;
      } else if(command==='record-start') {
        if(!verifiedVideo)fail('VIDEO_UNVERIFIED');
        if(args.length!==3||recording||args[2]!==owned.video_id||!Number.isInteger(args[1])||args[1]<10||args[1]>180)fail('RECORDING_SCOPE');
        evidence(args[0]);recording={id:args[0],stopped:false};
      } else if(waitForRecord.has(command)) {
        if(args.length!==1||recording?.id!==args[0]||command==='record-stop'&&recording.stopped
          ||command==='record-extract-audio'&&(!recording.stopped||recording.audioOutput))fail('RECORDING_SCOPE');
        evidence(args[0],{existing:true});
      }
    }
    const playback=!qualified&&['open-video',links].includes(command)?'continuous_identity':undefined;
    const result=await phone({command,args,profile,owner:run,playback});
    if(command===accountCommand) {
      verifiedAccount=projectFields(result.stdout).douyin_id===account;
      if(!verifiedAccount)fail('ACCOUNT');
    }
    if(command===links) {
      const fields=projectFields(result.stdout);
      verifiedVideo=fields.video_id===owned.video_id&&fields.content_type==='video';
      if(!verifiedVideo)fail('VIDEO_IDENTITY');
    }
    if(command==='record-stop'){
      recording.stopped=true;
      recording.stoppedOutput=result.stdout;
    }
    if(command==='record-extract-audio')recording.audioOutput=result.stdout;
    return result;
  }

  return {
    async readEvidence(){
      if(!owned||!qualified||!committedLookups.size||pendingLookups.size
        ||committedLookups.size!==scope.comment_limit)return null;
      await assertAuthority();
      for(const [id,comment] of committedLookups){
        const read=await readComment(comment);
        if(read.verified!==true||read.comment_id!==id)return null;
      }
      await assertAuthority();
      return {source_run:origin,video_id:owned.video_id,video_url:owned.video_url,comment_ids:[...committedLookups.keys()],
        qualification:'matched',sample_target:scope.comment_limit,coverage:'sampled'};
    },
    async stopRecording(){
      if(recording&&!recording.stopped)await performPhone('record-stop',[recording.id]);
    },
    async releaseOwned() {
      if(claimInDoubt)fail('CLAIM_RECEIPT');
      if(!owned)return;
      const result=await queue('release_video',{video_id:owned.video_id});
      if(result.released!==true)fail('LEASE_READBACK');
      owned=null;
    },
    async call(kind,input) {
      if(busy)fail('BUSY');busy=true;
      try {
        await assertAuthority();
        let result;
        if(kind==='inspect'&&Object.keys(input??{}).length===0) {
          result={stage:'102',source_run:origin,phone_commands:[...commandList],business_operations:[...operations]};
        } else if(kind==='phone'&&Object.keys(input??{}).sort().join(',')==='args,command'){
          result=await performPhone(input.command,input.args);
        } else if(kind==='business'&&operations.includes(input?.operation)){
          const keys=Object.keys(input).sort().join(',');
          const inputFields={prepare_comment:'index',collect_submit:'reference'}[input.operation];
          const requiresInput=input.operation==='qualification_submit'||inputFields;
          if(keys!==(requiresInput?'input,operation':'operation')
            ||inputFields&&Object.keys(input.input??{}).join(',')!==inputFields)fail('OPERATION');
          result=await performBusiness(input.operation,input.input);
        } else fail('OPERATION');
        await assertAuthority();
        return result;
      } finally {busy=false;}
    },
  };
}
