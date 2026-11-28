import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fetchStandaloneNativeEvidence,publishStandaloneQualificationProof,withStandaloneQualificationReceipt} from './standalone-native-evidence.mjs';
import {createStandaloneQualificationPreparation,createStandaloneQualificationSubmission,prepareStandaloneCollectionAudio,reviewStandalonePreparedDecision,standaloneQualificationDecisionId} from './standalone-qualification-preparation.mjs';
export {prepareStandaloneCollectionAudio};
import {standaloneCollectionHandoff,readCommittedCollection,createCollectionEvidenceReceipt,createCollectionDeviceReader,collectionHostToolInputs, authorizeAccountNavigation, accountNavigationOutcome} from './standalone-collection-handoff.mjs';
import {checkSource,observedOrigin} from './standalone-collection-origin.mjs';
export {readStandaloneCollectionSource} from './standalone-collection-origin.mjs';

const require=createRequire(import.meta.url);
const sha=value=>createHash('sha256').update(value).digest('hex');

const tag = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/;
const videoId = /^\d{16,24}$/;
const fail = reason => {
  const code='STANDALONE_COLLECTION_'+reason;
  throw Object.assign(Error(code),{code});
};

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
  const requestedVideo = request.video_id;
  if (requestedVideo !== undefined && (typeof requestedVideo !== 'string' || !videoId.test(requestedVideo))) {
    fail('VIDEO_SCOPE');
  }
  const expectedDigest=request.evidence_digest;
  if(expectedDigest!==undefined&&(requestedVideo===undefined||!/^[a-f0-9]{64}$/.test(expectedDigest)))fail('SOURCE_EVIDENCE');
  const exactVideo = requestedVideo === undefined ? '' : ' AND video_id=$8';
  const exactDigest = expectedDigest === undefined ? '' : " AND discovery_metrics->>'digest'=$9";
  const {line,run_tag:run,source_run:origin,company}=scope;
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['standalone-102:'+line+':'+run]);
    await currentCollectionConfig(client,scope);
    const claimed='处理中:'+run;
    const parameters=[line,origin,company.company_id,company.tenant_id,String(company.version),run,claimed];
    let rows=(await client.query(`SELECT video_id,video_url,title,judgment_status,process_status,harvest_batch,discovery_metrics->>'digest' AS evidence_digest
      FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND ${observedOrigin}
      AND harvest_batch=$6 AND process_status=$7 LIMIT 2 FOR UPDATE`,parameters)).rows;
    if(!rows.length) {
      if (requestedVideo !== undefined) parameters.push(requestedVideo);
      if (expectedDigest !== undefined) parameters.push(expectedDigest);
      rows=(await client.query(`WITH pending AS (
        SELECT id FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND harvest_batch=$2 AND ${observedOrigin}
          AND judgment_status IN ('pending','matched') AND process_status IN ('待判定','待采评论')${exactVideo}${exactDigest}
        ORDER BY discovered_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
      UPDATE zenithjoy.leadgen_videos AS video SET process_status=$7,harvest_batch=$6,updated_at=now()
      FROM pending WHERE pending.id=video.id
      RETURNING video_id,video_url,title,judgment_status,process_status,harvest_batch,discovery_metrics->>'digest' AS evidence_digest`,parameters)).rows;
    }
    const row=rows[0];
    if(rows.length>1||row&&(requestedVideo!==undefined&&row.video_id!==requestedVideo||expectedDigest!==undefined&&row.evidence_digest!==expectedDigest||!videoId.test(row.video_id)||row.video_url!=='https://www.douyin.com/video/'+row.video_id
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
  const authority=scope.qualification_authority;
  let formal;
  if(authority){
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(request.submission_action_name??'')
      ||request.submission_action_name===request.proposal?.preparation_action_name)fail('SUBMIT_SCOPE');
    formal=reviewStandalonePreparedDecision({...authority,videoId:request.video_id,audio:request.audio_path,
      preparationSha:request.preparation_sha256,proposal:request.proposal});
    if(standaloneQualificationDecisionId(formal,request.submission_action_name)!==request.decision_sha256)fail('SUBMIT_EVIDENCE');
  }
  const {transcript,audio_sha256:audioSha,duration_seconds:duration,policy_sha256:policySha}=formal??request;
  if(typeof transcript!=='string'||!transcript.trim()||Buffer.byteLength(transcript)>256*1024
    ||!/^[a-f0-9]{64}$/.test(audioSha??'')||!Number.isFinite(duration)
    ||duration<1||duration>185)fail('RECORDING_PROOF');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const {row,policy,snapshot}=await ownedQualification(client,request,scope,{lock:true});
    if(policySha!==sha(policy))fail('QUALIFICATION_POLICY_CHANGED');
    const vote=formal??reviewStandaloneCollectionQuote(request.proposal,{policy,transcript});
    const evidence={...require('./judge-video.js').configEvidence(snapshot,scope.run_tag),source_101_run:scope.source_run,
      actor:'codex',audio_sha256:audioSha,transcript_sha256:sha(transcript),policy_sha256:policySha,
      duration_seconds:duration,quote:vote.quote,
      ...(formal?{qualification_agent:{...formal.provenance,submission_action_name:request.submission_action_name,
        decision_sha256:request.decision_sha256}}:{policy_quote:vote.policy_quote}),
      verdict_sha256:formal?request.decision_sha256:sha(JSON.stringify(vote))};
    if(row.judgment_config?.run_id===scope.run_tag){
      if(row.judgment_config.verdict_sha256!==evidence.verdict_sha256||row.judgment_config.audio_sha256!==evidence.audio_sha256
        ||row.judgment_status!==vote.verdict||row.transcript!==transcript
        ||formal&&row.judgment_config.qualification_agent?.decision_sha256!==request.decision_sha256)fail('QUALIFICATION_CONFLICT');
    }else{
      const saved=await client.query(`UPDATE zenithjoy.leadgen_videos SET judgment_status=$2,judgment_reason=$3,
        transcript=$4,judgment_config=$5::jsonb,updated_at=now()
        WHERE id=$1 AND harvest_batch=$6 AND process_status=$7
        RETURNING video_id,judgment_status,transcript,judgment_config`,
        [row.id,vote.verdict,vote.reason,transcript,JSON.stringify(evidence),scope.run_tag,'处理中:'+scope.run_tag]);
      const actual=saved.rows[0];
      if(saved.rowCount!==1||actual.video_id!==row.video_id||actual.judgment_status!==vote.verdict
        ||actual.transcript!==transcript||actual.judgment_config?.audio_sha256!==evidence.audio_sha256
        ||formal&&actual.judgment_config.qualification_agent?.decision_sha256!==request.decision_sha256)fail('QUALIFICATION_WRITE');
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

const accountCommand = 'account-current';
const links = 'current-video-link';
const waitForRecord = new Set(['record-status','record-stop','record-extract-audio']);
const captureCommands = new Set(['ui-evidence','snapshot-evidence']);
const commandList = ['open-app',accountCommand,'open-video',links,'record-start',...waitForRecord,...captureCommands,'account-visual-tap','back-evidence'];
const operations = ['company_config','collect_claim','qualification_input','qualification_submit','qualification_readback','scan_comments','scroll_comments','prepare_comment','collect_submit'];
const projectFields = stdout => Object.fromEntries(String(stdout).split('\n')
  .filter(line=>line.includes('=')).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]));

export function createStandaloneCollectionTools({scope,rpc,phone,assertAuthority,evidenceRoot,runDirectory,runIdentity,transcribe,verifyQualificationProof,commentObserver,activityPlaybook,readSourceHandoff,readAuthor,readDeviceContext,readCentralLease}) {
  const {line,run_tag:run,source_run:origin,profile,serial,expected_account:account,company}=scope;
  checkSource({op:'collect_claim',line,run,source_run:null,committed_origin_run:origin,limit:1},scope);
  let verifiedAccount=false, binding=null, owned=null, verifiedVideo=false, recording=null, busy=false, claimInDoubt=false;
  const evidenceIds=new Set(),returnedEvidenceIds=new Set(),observationFiles=new Set(),qualificationReceipts=new Map(),fetchedArtifacts=new Map();
  let linkFollowup=null;
  let accountNavigation=null, openedApp=false, reviewedVideo=null, openedReviewVideo=null, verifiedReviewVideo=false, authorProof=null, reviewedDigest=null;
  let deviceReady=!readDeviceContext;
  let asrAttempted=false, submitted=false, qualificationInput, qualified=false;
  const preparedComments=new Map(),committedLookups=new Map(),pendingLookups=new Set();
  let publishedProof,preparedQualification;
  const prepare=runIdentity&&verifyQualificationProof?createStandaloneQualificationPreparation({
    runDirectory,runIdentity,verifyProof:verifyQualificationProof,transcribe,
    getPolicy:vid=>queue('qualification_policy',{video_id:vid,committed_origin_run:origin}),
  }):null;
  const submit=prepare?createStandaloneQualificationSubmission({runDirectory,runIdentity,scope,queue}):null;
  const offeredOperations=prepare?operations.filter(op=>!['qualification_input','qualification_submit'].includes(op)):operations;
  const readDevice=readDeviceContext?createCollectionDeviceReader(readDeviceContext,value=>{deviceReady=value;}):undefined;
  const handoff=activityPlaybook&&runDirectory&&runIdentity?standaloneCollectionHandoff({runDirectory,runIdentity,scope,
    readCentralLease,readDevice,
    prepareComment:commentObserver?index=>performComments('prepare_comment',{index}):undefined,
    readComments:()=>readOwnedComments(),
  }):null;

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
      return handoff?createCollectionEvidenceReceipt({runDirectory,runIdentity,videoId:owned.video_id,id,comment,originals:result.originals}):{reference:id};
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
    if(!deviceReady)fail('DEVICE_CONTEXT');
    if(operation==='collect_source_read') {
      if(owned||claimInDoubt)fail('VIDEO_SCOPE');
      const result=await queue(operation,{committed_origin_run:origin,video_id:proposal?.video_id??null,...(readAuthor?{include_author_scope:true}:{})});
      if(result.source_run!==origin||result.video&&(!videoId.test(result.video.video_id)
        ||proposal?.video_id!=null&&result.video.video_id!==proposal.video_id))fail('SOURCE_READBACK');
      if(reviewedVideo!==result.video?.video_id||reviewedDigest!==result.video?.evidence_digest) {
        openedReviewVideo=null;
        verifiedReviewVideo=false;
        authorProof=null;
      }
      reviewedVideo=null;
      const handoff=result.video&&readSourceHandoff?await readSourceHandoff(result.video):null;
      reviewedVideo=result.video?.video_id??null;
      reviewedDigest=result.video?.evidence_digest??null;
      binding.own_douyin_ids=result.own_douyin_ids;
      return handoff?{source_run:result.source_run,video:result.video,handoff}:{source_run:result.source_run,video:result.video};
    }
    if(operation==='collect_author_read') {
      if(owned||claimInDoubt||!verifiedReviewVideo||!Array.isArray(binding.own_douyin_ids)
        ||!binding.own_douyin_ids.includes(account))fail('AUTHOR_UNVERIFIED');
      const proof=await readAuthor(reviewedVideo);
      if(proof.video_id!==reviewedVideo||!proof.douyin_id)fail('AUTHOR_UNVERIFIED');
      authorProof={...proof,own_account:binding.own_douyin_ids.includes(proof.douyin_id)};
      return structuredClone(authorProof);
    }
    if(operation==='collect_claim') {
      const requested=proposal?.video_id;
      if(activityPlaybook&&(!reviewedVideo||requested!==reviewedVideo))fail('SOURCE_READ_REQUIRED');
      if(owned)return {source_run:origin,video:structuredClone(owned)};
      if(readAuthor&&(!verifiedReviewVideo||!reviewedDigest||authorProof?.video_id!==requested||authorProof.own_account))
        fail('AUTHOR_UNVERIFIED');
      claimInDoubt=true;
      const result=await queue(operation,{committed_origin_run:origin,...(requested?{video_id:requested}:{}),...(readAuthor?{evidence_digest:reviewedDigest}:{})});
      if(result.source_run!==origin||result.video&&(!videoId.test(result.video.video_id||'')
        ||requested&&result.video.video_id!==requested||result.video.video_url!=='https://www.douyin.com/video/'+result.video.video_id))fail('CLAIM_RECEIPT');
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
    let argv=args;
    if(command==='open-app') {
      if(args.length||owned||accountNavigation)fail('PHONE_INPUT');
    } else if(command===accountCommand) {
      if(args.length!==1||owned||!openedApp||accountNavigation&&accountNavigation.state!=='tapped')fail('PHONE_INPUT');
      evidence(args[0]);verifiedAccount=false;
    } else if(command==='snapshot-evidence'&&!owned&&accountNavigation?.state==='needs_snapshot'){
      if(args.length!==1)fail('PHONE_INPUT');
      evidence(args[0]);
    } else if(command==='account-visual-tap'||command==='back-evidence'){
      const action=authorizeAccountNavigation(command,args,accountNavigation);
      if(!action)fail('PHONE_INPUT');
      evidence(action.evidenceId);
      argv=action.argv;
      accountNavigation.state='navigation_attempted';
    } else if(!owned) {
      if(!activityPlaybook||!verifiedAccount||!binding||!reviewedVideo||claimInDoubt)fail('VIDEO_SCOPE');
      if(command==='open-video') {
        if(args.length!==2||args[0]!==reviewedVideo)fail('VIDEO_SCOPE');
        evidence(args[1]);
        openedReviewVideo=null;
        verifiedReviewVideo=false;
        authorProof=null;
      } else if(command===links||captureCommands.has(command)) {
        if(args.length!==1||openedReviewVideo!==reviewedVideo||command!==links&&!verifiedReviewVideo)fail('VIDEO_SCOPE');
        evidence(args[0]);
        if(command===links){
          verifiedReviewVideo=false;
          authorProof=null;
        }
      } else fail('VIDEO_SCOPE');
    } else {
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
    if(command==='open-video')linkFollowup=null;
    if(command===links&&linkFollowup){
      if(linkFollowup==='used')fail('VIDEO_LINK_OBSERVATION_EXHAUSTED');
      linkFollowup='used';
    }
    const playback=!qualified&&['open-video',links].includes(command)?'continuous_identity':undefined;
    const verifyAccountOnly=command===accountCommand&&accountNavigation?.state==='tapped';
    const result=await phone({command,args:argv,profile,owner:run,playback,verifyAccountOnly});
    if(command==='open-video'){
      const lines=String(result.stdout).split('\n');
      const status=lines.filter(line=>line.startsWith('video_open_status='));
      if(status.length>0){
        const observationFile=args[1]+'-video-observation.png';
        const evidence=lines.filter(line=>line.startsWith('evidence='));
        if(status.length!==1||status[0]!=='video_open_status=visual_required'
          ||evidence.length!==1||evidence[0]!=='evidence='+join(evidenceRoot,observationFile)
          ||lines.some(line=>/^(video_opened|video_id)=/.test(line)))fail('VIDEO_OBSERVATION');
        observationFiles.add(observationFile);
        if(!owned)openedReviewVideo=reviewedVideo;
        return {...result,video_open_status:'visual_required',observation_file:observationFile,
          next_action:'用 fetch-native 读取本次截图。看到视频详情时，再用新的证据 ID 调用 current-video-link 核对授权视频身份。画面无法判断时说明具体原因并结束本次尝试。'};
      }
      if(!owned)openedReviewVideo=reviewedVideo;
    }
    for(const arg of args)if(command!=='back-evidence'&&evidenceIds.has(arg))returnedEvidenceIds.add(arg);
    if(command==='open-app')openedApp=true;
    if(command==='snapshot-evidence'&&!owned&&accountNavigation?.state==='needs_snapshot'){
      accountNavigation={...accountNavigation,state:'needs_tap',snapshot:args[0]};
      return accountNavigationOutcome(command,result,accountNavigation).reply;
    }
    if(command==='account-visual-tap'||command==='back-evidence'){
      const outcome=accountNavigationOutcome(command,result,{...accountNavigation,snapshot:args[1]});
      accountNavigation=outcome.navigation;
      if(command==='back-evidence'&&accountNavigation.state==='needs_tap')returnedEvidenceIds.add(args[1]);
      return outcome.reply;
    }
    if(command===accountCommand) {
      if(result.stdout.trim()==='account_status=visual_required'&&!accountNavigation){
        accountNavigation={state:'needs_snapshot'};
        return {account_status:'visual_required',reason:'uiautomator_idle_without_xml',
          next_action:'调用 snapshot-evidence [本轮新证据ID]，再按截图定位抖音底部「我」。'};
      }
      verifiedAccount=projectFields(result.stdout).douyin_id===account;
      if(!verifiedAccount)fail('ACCOUNT');
    }
    if(command===links) {
      const lines=result.stdout.trim().split('\n');
      const statusLines=lines.filter(line=>line.startsWith('video_link_status='));
      if(statusLines.length>0){
        const observationFile=args[0]+'-video-observation.png';
        if(playback!=='continuous_identity'||lines.length!==2||lines[0]!=='video_link_status=visual_required'
          ||lines[1]!=='evidence='+join(evidenceRoot,observationFile))fail('VIDEO_OBSERVATION');
        observationFiles.add(observationFile);
        if(!linkFollowup)linkFollowup='allowed';
        return {...result,video_link_status:'visual_required',observation_file:observationFile,
          next_action:linkFollowup==='allowed'
            ?'用 fetch-native 读取截图。若确认仍在视频详情页，可用新证据 ID 重试取链一次；画面不符时报告具体原因。截图不能证明视频身份。'
            :'本次打开的取链重试已用尽。用 fetch-native 读取截图并报告具体原因。截图不能证明视频身份。'};
      }
      const fields=projectFields(result.stdout);
      const matched=fields.video_id===(owned?.video_id??reviewedVideo)&&fields.content_type==='video';
      if(owned)verifiedVideo=matched;
      else verifiedReviewVideo=matched;
      if(!matched)fail('VIDEO_IDENTITY');
      linkFollowup=null;
    }
    if(command==='record-stop'){
      recording.stopped=true;
      recording.stoppedOutput=result.stdout;
    }
    if(command==='record-extract-audio')recording.audioOutput=result.stdout;
    return owned&&activityPlaybook&&runDirectory?withStandaloneQualificationReceipt({runDirectory,command,args,result,qualificationReceipts}):result;
  }

  const readOwnedComments=()=>readCommittedCollection({owned,qualified,pendingLookups,committedLookups,readComment,scope});
  return {
    async readEvidence(){
      if(!owned||!qualified||!committedLookups.size||pendingLookups.size
        ||committedLookups.size!==scope.comment_limit)return null;
      await assertAuthority();
      try{
        const result=await readOwnedComments();
        await assertAuthority();
        return result;
      }catch(error){
        if(error.code==='STANDALONE_COLLECTION_COMMENT_READBACK')return null;
        throw error;
      }
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
        if(kind==='inspect'&&readDeviceContext&&input?.view==='device_context'&&Object.keys(input).length===1) {
          result=await readDevice({refresh:true});
        } else if(kind==='inspect'&&Object.keys(input??{}).length===0) {
          const tools=['fetch-native',...(runIdentity?['proof']:[]),...(prepare?['qualify-prepare','qualify-submit']:[]),...(handoff?.tools??[])];
          const activityTools={activity_tools:tools,activity_tool_inputs:Object.fromEntries(tools.map(key=>[key,collectionHostToolInputs[key]]))};
          result={stage:'102',source_run:origin,...(activityPlaybook&&runDirectory?activityTools:{}),...(readDeviceContext?{inspect_views:['device_context']}:{}),phone_commands:[...commandList],business_operations:activityPlaybook?['collect_source_read',...(readAuthor?['collect_author_read']:[]),...offeredOperations]:[...offeredOperations],
            account_entry:'先 open-app 再 account-current；仅 visual_required 时按工具返回的 next_action 看截图、点「我」、再核验绑定账号。',
            ...(activityPlaybook?{activity_playbook:structuredClone(activityPlaybook),
              instructions:'执行本单前，先读取冻结的 Playbook 和方法清单，按清单顺序读取及执行对应的 Activity Skill。'}:{})};
        } else if(handoff?.tools.includes(kind)) {
          result=await handoff.call(kind,input);
        } else if(kind==='qualify-prepare'&&prepare) {
          result=await prepare(input,publishedProof,verifiedVideo&&owned?.video_id);
          preparedQualification=result;
        } else if(kind==='qualify-submit'&&submit) {
          result=await submit(input,preparedQualification,verifiedVideo&&owned?.video_id);
          qualified=result.verdict==='matched';
        } else if(kind==='proof'&&activityPlaybook&&runDirectory&&runIdentity) {
          result=publishStandaloneQualificationProof({input,runDirectory,runIdentity,videoId:verifiedVideo&&owned?.video_id,recording,qualificationReceipts,fetchedArtifacts});
          publishedProof=result.proof_manifest;
        } else if(kind==='fetch-native'&&activityPlaybook&&runDirectory) {
          result=fetchStandaloneNativeEvidence({input,evidenceRoot,runDirectory,startSeconds:scope.run_start_ts,returnedEvidenceIds,observationFiles});
          fetchedArtifacts.set(join(runDirectory,result.path),result.sha256);
        } else if(kind==='phone'&&Object.keys(input??{}).sort().join(',')==='args,command'){
          result=await performPhone(input.command,input.args);
        } else if(kind==='business'&&(offeredOperations.includes(input?.operation)||activityPlaybook&&input?.operation==='collect_source_read'||readAuthor&&input?.operation==='collect_author_read')){
          const keys=Object.keys(input).sort().join(',');
          const sourceRead=input.operation==='collect_source_read';
          const exactClaim=activityPlaybook&&input.operation==='collect_claim';
          const inputFields=exactClaim?'video_id':{prepare_comment:'index',collect_submit:'reference'}[input.operation];
          const optionalSourceId=sourceRead&&keys==='input,operation'&&Object.keys(input.input??{}).join(',')==='video_id';
          const requiresInput=input.operation==='qualification_submit'||inputFields;
          if(!optionalSourceId&&keys!==(requiresInput?'input,operation':'operation')
            ||inputFields&&Object.keys(input.input??{}).join(',')!==inputFields)fail('OPERATION');
          result=await performBusiness(input.operation,input.input);
        } else fail('OPERATION');
        await assertAuthority();
        return result;
      } finally {busy=false;}
    },
  };
}
