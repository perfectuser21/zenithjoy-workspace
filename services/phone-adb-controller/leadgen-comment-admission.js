// A failed 102 run may expose committed comments without certifying the video.
// This single source can enter one explicit 103 run only through an immutable audit receipt.
'use strict';
const {createHash}=require('node:crypto');
const {validateEvidence}=require('./queued-recipient-evidence.js');

const SOURCE_RUN='accept3a903_jinuo102g_20261030t0712';
const SOURCE_101='accept3a903_jinuo101f_20261030t0700';
const SOURCE_COMMIT='3a903aecca5327614057d069a75673ad1732ec93';
const VIDEO_ID='7699489394579915663';
const COMMENT_IDS=Object.freeze([
  '818dc556-0d01-409a-9b08-4d458e4a7bc1',
  '4d1375d8-7ef2-4393-a3ec-c56897f7d045',
  '8d95a060-25a0-4438-a5ad-c5bd91729883',
]);
const COMPANY_ID='ef8e14b0-4018-4e54-bc7a-866e51a0ce0b';
const TENANT_ID='a4ca8914-f5a7-4928-b1e3-6b69f9c0ab61';
const POLICY_ID='jinoshengyuan-existing-acquisition-rules-v1';
const PROJECT_ID='68ca6b4f-5e53-4ccf-a2aa-874e5c32bbe6';
const ACTION='leadgen_102g_comment_admission';
const ACTOR='codex:102g-comment-admission';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[a-f0-9]{64}$/;
const COMMIT=/^[a-f0-9]{40}$/;
const fail=code=>{const error=Error('ADMISSION_'+code);error.code=error.message;throw error;};
const canonical=x=>JSON.stringify(x instanceof Date?x.toJSON():x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):x);
const hash=x=>createHash('sha256').update(canonical(x)).digest('hex');
const bodyHash=value=>createHash('sha256').update(value).digest('hex');
const url=`https://www.douyin.com/video/${VIDEO_ID}`;

function scopeFor(input){return {scope_version:1,action:'admit_exact_failed_102_comments_to_one_103_run',
  project_id:PROJECT_ID,company_id:COMPANY_ID,tenant_id:TENANT_ID,policy_id:POLICY_ID,
  company_config_version:14,source_commit:SOURCE_COMMIT,candidate_source_commit:input.candidate_source_commit,source_run:SOURCE_RUN,
  source_101_run:SOURCE_101,video_id:VIDEO_ID,comment_ids:[...COMMENT_IDS],
  scoring_run:input.run,maintenance_task_id:input.maintenance_task_id,
  max_comments:3,keep_original_run_failed:true,keep_video_quarantined:true,allow_direct_messages:false};}
function validateInput(input){
  const keys=['candidate_source_commit','decision_id','line','maintenance_task_id','op','run','source_run','video_id'];
  if(!input||Object.keys(input).sort().join(',')!==keys.join(',')
    ||!['admit_102g_comments','admit_102g_readback'].includes(input.op)
    ||input.line!=='jinuo'||input.source_run!==SOURCE_RUN||input.video_id!==VIDEO_ID
    ||!COMMIT.test(input.candidate_source_commit||'')
    ||!UUID.test(input.decision_id||'')||!UUID.test(input.maintenance_task_id||'')
    ||typeof input.run!=='string'||!/^accept[a-zA-Z0-9_-]{1,110}$/.test(input.run)
    ||input.run===SOURCE_RUN)fail('SCOPE_INVALID');
}
function checkAuthority(authority,input){
  let decisionScope;try{decisionScope=JSON.parse(authority?.decision?.decision);}catch{fail('AUTHORITY_INVALID');}
  if(authority.decision.id!==input.decision_id||authority.decision.made_by!=='user'
    ||authority.decision.status!=='active'||canonical(decisionScope)!==canonical(scopeFor(input))
    ||authority.maintenanceTask?.id!==input.maintenance_task_id
    ||authority.maintenanceTask.project_id!==PROJECT_ID
    ||authority.maintenanceTask.status!=='in_progress'
    ||authority.maintenanceTask.claimed_by!==ACTOR)fail('AUTHORITY_INVALID');
}
function checkStop(stop){
  if(!stop||stop.source_run!==SOURCE_RUN||stop.source_commit!==SOURCE_COMMIT
    ||stop.run_status!=='failed'||stop.native_receipts!==11
    ||stop.observed_identities!==207||stop.same_live!==0||stop.group_members!==0
    ||stop.tagged_processes!==0||stop.local_tagged_processes!==0||!HEX.test(stop.evidence_sha256||'')
    ||!Number.isSafeInteger(stop.observed_at)||Date.now()-stop.observed_at>5000
    ||stop.observed_at>Date.now()+1000)fail('OLD_EXECUTION_UNKNOWN');
}
function checkVideo(video){
  const c=video?.judgment_config;
  if(video?.line_key!=='jinuo'||video.video_id!==VIDEO_ID||video.video_url!==url
    ||video.harvest_batch!==SOURCE_RUN||video.process_status!==`待人工核验:${SOURCE_RUN}`
    ||video.judgment_status!=='matched'||c?.company_id!==COMPANY_ID
    ||c.tenant_id!==TENANT_ID||Number(c.version)!==14||c.policy_id!==POLICY_ID
    ||c.run_id!==SOURCE_RUN)fail('VIDEO_SCOPE_INVALID');
}
function checkFrozen(frozen){
  const s=frozen?.snapshot;
  if(frozen?.company_id!==COMPANY_ID||frozen.tenant_id!==TENANT_ID
    ||frozen.run_id!==SOURCE_RUN||Number(frozen.version)!==14||frozen.source_run!==SOURCE_101
    ||s?.company_id!==COMPANY_ID||s.tenant_id!==TENANT_ID||Number(s.version)!==14
    ||s.policy_id!==POLICY_ID||s.runtime_config?.routing?.line_key!=='jinuo')fail('POLICY_SCOPE_INVALID');
  return hash(s);
}
function commentIdentity(row,video,{allowProcessed=false}={}){
  if(!COMMENT_IDS.includes(row?.id)||row.line_key!=='jinuo'||row.harvest_batch!==SOURCE_RUN
    ||row.source_video_url!==url||row.source_video!==video.title
    ||(!allowProcessed&&row.process_status!=='待分拣')
    ||(allowProcessed&&!['待分拣','已分拣'].includes(row.process_status))
    ||(!allowProcessed&&(row.relevance!==null||row.intent_grade!==null))
    ||typeof row.comment_body!=='string'||!row.comment_body)fail('COMMENT_SCOPE_INVALID');
  const e=row.recipient_evidence,b=e?.company_binding;
  if(e?.scope?.run!==SOURCE_RUN||e.scope.source_run!==SOURCE_101||e.scope.video_id!==VIDEO_ID
    ||b&&(b.company_id!==COMPANY_ID||b.tenant_id!==TENANT_ID||b.run_id!==SOURCE_RUN
      ||b.source_run!==SOURCE_101))fail('RECIPIENT_SCOPE_INVALID');
  try{validateEvidence(e,{...e.scope,line_key:'jinuo',run:SOURCE_RUN,
    douyin_id:row.douyin_id,nickname:row.nickname,comment_body:row.comment_body,
    comment_body_sha256:bodyHash(row.comment_body),video_url:url},b?{companyBinding:b}:{});}
  catch{fail('RECIPIENT_EVIDENCE_INVALID');}
  return hash({id:row.id,line_key:row.line_key,harvest_batch:row.harvest_batch,
    source_video:row.source_video,source_video_url:row.source_video_url,
    nickname:row.nickname,douyin_id:row.douyin_id,comment_body:row.comment_body,
    recipient_evidence:e});
}
function checkComments(rows,video,options){
  if(rows.length!==3||new Set(rows.map(r=>r.id)).size!==3
    ||COMMENT_IDS.some(id=>!rows.some(r=>r.id===id)))fail('COMMENT_SET_INVALID');
  return Object.fromEntries(rows.map(r=>[r.id,commentIdentity(r,video,options)]));
}
function checkReceipt(receipt,input,video,comments){
  const d=receipt?.detail;
  if(receipt?.id!==input.decision_id||receipt.action!==ACTION||receipt.org_id!==TENANT_ID
    ||receipt.member_id!==ACTOR||receipt.table_id!==null
    ||d?.version!==1||d.decision_id!==input.decision_id||d.scope_sha256!==hash(scopeFor(input))
    ||d.candidate_source_commit!==input.candidate_source_commit
    ||d.scoring_run!==input.run||d.source_run!==SOURCE_RUN||d.video_id!==VIDEO_ID
    ||d.video_sha256!==hash(video)||!HEX.test(d.policy_sha256||'')
    ||!HEX.test(d.stop_sha256||'')||canonical(d.comment_hashes)!==canonical(comments))fail('RECEIPT_INVALID');
  return d;
}
async function admittedRows(pool,{lineKey,run,sourceRun,requireScoringFrozen=true}){
  if(lineKey!=='jinuo'||sourceRun!==SOURCE_RUN)return [];
  const receipts=(await pool.query(`SELECT * FROM zenithjoy.db_audit WHERE action=$1 AND detail->>'source_run'=$2 AND detail->>'scoring_run'=$3`,[ACTION,SOURCE_RUN,run])).rows;
  if(!receipts.length)return [];
  if(receipts.length!==1)fail('RECEIPT_AMBIGUOUS');
  const receipt=receipts[0],decisionId=receipt.detail?.decision_id;
  const input={op:'admit_102g_comments',line:'jinuo',run,source_run:SOURCE_RUN,video_id:VIDEO_ID,
    decision_id:decisionId,maintenance_task_id:receipt.detail?.maintenance_task_id,
    candidate_source_commit:receipt.detail?.candidate_source_commit};
  validateInput(input);
  const frozen=(await pool.query('SELECT * FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=$2',[COMPANY_ID,SOURCE_RUN])).rows;
  if(frozen.length!==1||checkFrozen(frozen[0])!==receipt.detail?.policy_sha256)fail('POLICY_SCOPE_INVALID');
  if(requireScoringFrozen){
    const scoring=(await pool.query('SELECT * FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=$2',[COMPANY_ID,run])).rows;
    const score=scoring[0],s=score?.snapshot;
    if(scoring.length!==1||score.tenant_id!==TENANT_ID||Number(score.version)!==14||score.source_run!==SOURCE_RUN
      ||s?.company_id!==COMPANY_ID||s.tenant_id!==TENANT_ID||Number(s.version)!==14
      ||s.policy_id!==POLICY_ID||s.runtime_config?.routing?.line_key!=='jinuo'
      ||hash(s)!==receipt.detail.policy_sha256)fail('SCORING_POLICY_SCOPE_INVALID');
  }
  const videos=(await pool.query('SELECT * FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_id=$2',[lineKey,VIDEO_ID])).rows;
  if(videos.length!==1)fail('VIDEO_SCOPE_INVALID');checkVideo(videos[0]);
  const rows=(await pool.query('SELECT * FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND harvest_batch=$2 AND source_video_url=$3',[lineKey,SOURCE_RUN,url])).rows;
  // Scored rows keep their original native identity; only status and judgment may advance.
  const fingerprints=checkComments(rows,videos[0],{allowProcessed:true});
  checkReceipt(receipt,input,videos[0],fingerprints);
  return rows;
}
async function readback(pool,input){
  validateInput(input);
  const rows=await admittedRows(pool,{lineKey:'jinuo',run:input.run,sourceRun:SOURCE_RUN,requireScoringFrozen:false});
  if(!rows.length)return {status:'unknown',decision_id:input.decision_id,video_id:VIDEO_ID};
  const receipt=(await pool.query('SELECT * FROM zenithjoy.db_audit WHERE id=$1',[input.decision_id])).rows;
  if(receipt.length!==1||receipt[0].detail?.maintenance_task_id!==input.maintenance_task_id
    ||receipt[0].detail?.scoring_run!==input.run)fail('RECEIPT_INVALID');
  return {status:'already_applied',decision_id:input.decision_id,video_id:VIDEO_ID,comment_ids:[...COMMENT_IDS]};
}
async function admit(pool,input,deps={}){
  validateInput(input);
  if(input.op!=='admit_102g_comments')fail('SCOPE_INVALID');
  const authority=deps.readAuthority&&deps.inspectStopped?deps:require('./leadgen-comment-admission-authority.js');
  checkAuthority(await authority.readAuthority(input),input);
  checkStop(await authority.inspectStopped());
  const client=await pool.connect();let commitStarted=false,committed=false,discard=false;
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`leadgen-admission:${SOURCE_RUN}:${VIDEO_ID}`]);
    const videos=(await client.query('SELECT * FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_id=$2 FOR UPDATE',['jinuo',VIDEO_ID])).rows;
    if(videos.length!==1)fail('VIDEO_SCOPE_INVALID');const video=videos[0];checkVideo(video);
    const frozen=(await client.query('SELECT * FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=$2',[COMPANY_ID,SOURCE_RUN])).rows;
    if(frozen.length!==1)fail('POLICY_SCOPE_INVALID');const policyHash=checkFrozen(frozen[0]);
    const rows=(await client.query('SELECT * FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND harvest_batch=$2 AND source_video_url=$3 FOR UPDATE',['jinuo',SOURCE_RUN,url])).rows;
    const prior=(await client.query(`SELECT * FROM zenithjoy.db_audit WHERE id=$1 OR (action=$2 AND detail->>'source_run'=$3 AND detail->>'video_id'=$4)`,[input.decision_id,ACTION,SOURCE_RUN,VIDEO_ID])).rows;
    if(prior.length){if(prior.length!==1)fail('RECEIPT_AMBIGUOUS');
      checkReceipt(prior[0],input,video,checkComments(rows,video,{allowProcessed:true}));
      await client.query('ROLLBACK');return {status:'already_applied',decision_id:input.decision_id,video_id:VIDEO_ID,comment_ids:[...COMMENT_IDS]};}
    const commentHashes=checkComments(rows,video);
    const outbox=(await client.query('SELECT comment_id FROM zenithjoy.leadgen_bridge_outbox WHERE line_key=$1 AND comment_id=ANY($2::uuid[])',['jinuo',COMMENT_IDS])).rows;
    if(outbox.length)fail('OLD_OUTBOX_PRESENT');
    checkAuthority(await authority.readAuthority(input),input);
    const stop=await authority.inspectStopped();checkStop(stop);
    const detail={version:1,decision_id:input.decision_id,maintenance_task_id:input.maintenance_task_id,
      candidate_source_commit:input.candidate_source_commit,
      scope_sha256:hash(scopeFor(input)),scoring_run:input.run,source_run:SOURCE_RUN,video_id:VIDEO_ID,
      video_sha256:hash(video),policy_sha256:policyHash,comment_hashes:commentHashes,
      stop_sha256:stop.evidence_sha256};
    await client.query(`INSERT INTO zenithjoy.db_audit(id,org_id,table_id,member_id,action,detail)
      VALUES($1,$2,NULL,$3,$4,$5::jsonb)`,[input.decision_id,TENANT_ID,ACTOR,ACTION,JSON.stringify(detail)]);
    commitStarted=true;await client.query('COMMIT');committed=true;
    return {status:'applied',decision_id:input.decision_id,video_id:VIDEO_ID,comment_ids:[...COMMENT_IDS],receipt_sha256:hash(detail)};
  }catch(error){
    if(commitStarted&&!committed){const e=Error('ADMISSION_COMMIT_UNKNOWN_READBACK_REQUIRED');e.code='ADMISSION_COMMIT_UNKNOWN';throw e;}
    try{await client.query('ROLLBACK');}catch{discard=true;error.rollback_code='ADMISSION_ROLLBACK_UNKNOWN';}throw error;
  }finally{client.release(discard||commitStarted&&!committed?true:undefined);}
}
module.exports={admit,readback,admittedRows,scopeFor,validateInput,checkAuthority,checkStop,checkVideo,checkFrozen,
  checkComments,checkReceipt,SOURCE_RUN,SOURCE_101,SOURCE_COMMIT,VIDEO_ID,COMMENT_IDS,ACTION,ACTOR,hash};
