'use strict';
// A completed 102 quota sample may leave the video open for later deep collection.
// Admit only that exact, independently verified comment set to 103; never mark the video fully collected.
const {createHash}=require('node:crypto');
const {lstatSync,readFileSync}=require('node:fs');
const {join}=require('node:path');
const {homedir}=require('node:os');
const {validateEvidence}=require('./queued-recipient-evidence.js');
const SHA=/^[a-f0-9]{40}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// One historical cross-SHA bridge for Issue 3004abdb-d5b8-448c-b35c-58203ef84e1d,
// development Task 1d7fcad9-c6ab-4103-af7d-9a26a834dd83. All other samples require same SHA.
const LEGACY=Object.freeze({
  run:'accept5dfb_jinuo102d_20261101t0354',
  source_commit:'5dfb33dd8ddd11f4063598989e891eec8685fbe3',
  binding_id:'92049edd-0cc7-46e3-bba3-5450aa1400ff',
  video_id:'7700992800439717605',
  line:'jinuo',limit:5,
});
function fail(reason){throw Error(`SAMPLED_ADMISSION_${reason}`);}
function hash(value){return createHash('sha256').update(value).digest('hex');}
function brainToken(){
  if(process.env.BRAIN_INTERNAL_TOKEN)return process.env.BRAIN_INTERNAL_TOKEN;
  const file=join(homedir(),'.credentials','brain.env');
  let stat,body;
  try{stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o600||stat.size>4096)fail('BRAIN_AUTH_UNAVAILABLE');
    body=readFileSync(file,'utf8');}catch{fail('BRAIN_AUTH_UNAVAILABLE');}
  const matches=[...body.matchAll(/^(?:export )?BRAIN_INTERNAL_TOKEN=(.+)$/gm)];
  if(matches.length!==1)fail('BRAIN_AUTH_UNAVAILABLE');
  const token=matches[0][1].trim().replace(/^(["'])(.*)\1$/,'$2');
  if(!token||/\s/.test(token))fail('BRAIN_AUTH_UNAVAILABLE');
  return token;
}
async function readRunProof(sourceRun){
  const base=(process.env.BRAIN_URL||'http://localhost:5221').replace(/\/$/,'');
  const token=brainToken();
  const runId=`douyin_video_processing-${sourceRun}__a1`;
  const read=async path=>{
    const response=await fetch(`${base}/api/brain${path}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(8000)});
    if(!response.ok)fail('BRAIN_PROOF_UNAVAILABLE');
    return response.json();
  };
  const [definition,reconciliation,run]=await Promise.all([
    read(`/runs/${encodeURIComponent(runId)}/definition`),
    read(`/runs/${encodeURIComponent(runId)}/reconciliation`),
    read(`/runs/${encodeURIComponent(runId)}?include=spans`),
  ]);
  const binding=definition?.binding;
  const spans=run?.spans;
  const collection=Array.isArray(spans)?spans.filter(s=>s?.evidence?.activity_key==='collection'):[];
  const activity=collection.find(s=>s.step_id==null&&s.outcome==='pass'&&s.evidence?.artifact==='activity-collection.json');
  const sample=activity?.evidence?.sampling_input||collection[0]?.evidence?.sampling_input;
  return {run_id:runId,binding_id:binding?.id,source_commit:definition?.workflow?.source_commit,
    source_run:sample?.source_run,business_outcome:reconciliation?.business_outcome,
    evidence_status:reconciliation?.evidence_status,gaps:reconciliation?.gaps,
    span_count:reconciliation?.span_count,expected_count:reconciliation?.expected_count,
    collection_outcome:activity?.outcome,collection_verified:collection.length>0&&collection.every(s=>s.outcome==='pass')
      &&collection.some(s=>s.evidence?.step_key==='douyin_video_processing.collection.collect_comments'),
    sampling_input:sample,
    identity_bound:binding?.run_id===runId&&reconciliation?.run_id===runId
      &&reconciliation?.run_binding_id===binding?.id&&reconciliation?.release_id===binding?.release_id
      &&binding?.workflow_definition_version_id===definition?.workflow?.id
      &&Array.isArray(spans)&&spans.length===reconciliation?.expected_count
      &&spans.every(s=>s.run_id===runId&&s.run_binding_id===binding?.id),
  };
}
function verifyNative(row,sourceRun,upstream,video,frozen,verifyRecipient){
  const e=row.recipient_evidence;
  if(!e||e.scope?.run!==sourceRun||e.scope.source_run!==upstream||e.scope.video_id!==video.video_id
    ||e.scope.video_url!==video.video_url)fail('RECIPIENT_SCOPE_INVALID');
  if(e.company_binding&&(e.company_binding.company_id!==frozen.company_id
    ||e.company_binding.tenant_id!==frozen.tenant_id||e.company_binding.version!==Number(frozen.version)
    ||e.company_binding.run_id!==sourceRun||e.company_binding.source_run!==upstream))fail('RECIPIENT_COMPANY_SCOPE_INVALID');
  try{const result=verifyRecipient(e,{...e.scope,line_key:row.line_key,run:sourceRun,
    douyin_id:row.douyin_id,nickname:row.nickname,comment_body:row.comment_body,
    comment_body_sha256:hash(row.comment_body),video_url:video.video_url},
    e.company_binding?{companyBinding:e.company_binding}:{});
    if(result===false)fail('RECIPIENT_EVIDENCE_INVALID');
  }catch{fail('RECIPIENT_EVIDENCE_INVALID');}
}
async function admittedRows(pool,{lineKey,run,sourceRun,sourceCommit,readProof=readRunProof,verifyRecipient=validateEvidence}={}){
  if(!sourceRun||!SHA.test(sourceCommit||'')||!lineKey||!run)return [];
  const videos=(await pool.query(`SELECT * FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND harvest_batch=$2
    AND process_status='待判定' AND judgment_status='matched'`,[lineKey,sourceRun])).rows;
  if(!videos.length)return [];
  if(videos.length!==1)fail('VIDEO_SET_AMBIGUOUS');
  const video=videos[0];
  if(!/^\d{16,24}$/.test(video.video_id||'')||video.video_url!==`https://www.douyin.com/video/${video.video_id}`
    ||video.line_key!==lineKey||video.harvest_batch!==sourceRun
    ||video.process_status!=='待判定'||video.judgment_status!=='matched')fail('VIDEO_SCOPE_INVALID');
  const proof=await readProof(sourceRun);
  const sample=proof?.sampling_input;
  if(proof?.run_id!==`douyin_video_processing-${sourceRun}__a1`
    ||proof.business_outcome!=='pass'||proof.evidence_status!=='verified'
    ||!Array.isArray(proof.gaps)||proof.gaps.length||!Number.isInteger(proof.span_count)
    ||proof.span_count<1||proof.span_count!==proof.expected_count
    ||proof.collection_outcome!=='pass'||proof.collection_verified!==true
    ||sample?.workflow_key!=='douyin_video_processing'||sample.run_tag!==sourceRun
    ||sample.line!==lineKey||sample.source_run!==proof.source_run
    ||!Number.isSafeInteger(sample.comment_limit)||sample.comment_limit<1||sample.comment_limit>50
    ||!SHA.test(proof.source_commit||''))fail('RUN_PROOF_INVALID');
  if(proof.identity_bound!==true)fail('RUN_BINDING_INVALID');
  const pinned=sourceRun===LEGACY.run;
  if(pinned){
    if(lineKey!==LEGACY.line||proof.source_commit!==LEGACY.source_commit
      ||proof.binding_id!==LEGACY.binding_id||video.video_id!==LEGACY.video_id
      ||sample.comment_limit!==LEGACY.limit)fail('LEGACY_SCOPE_INVALID');
  }else if(proof.source_commit!==sourceCommit||proof.identity_bound!==true)fail('SOURCE_COMMIT_MISMATCH');
  const frozen=(await pool.query('SELECT * FROM zenithjoy.company_config_runs WHERE run_id=$1',[sourceRun])).rows;
  const scoring=(await pool.query('SELECT * FROM zenithjoy.company_config_runs WHERE run_id=$1',[run])).rows;
  if(frozen.length!==1||scoring.length!==1)fail('FROZEN_CONFIG_MISSING');
  const source=frozen[0],target=scoring[0],s=source.snapshot,t=target.snapshot,c=video.judgment_config;
  if(source.run_id!==sourceRun||source.source_run!==sample.source_run||target.run_id!==run||target.source_run!==sourceRun
    ||source.company_id!==target.company_id||source.tenant_id!==target.tenant_id
    ||Number(source.version)!==Number(target.version)||s?.policy_id!==t?.policy_id
    ||s?.company_id!==source.company_id||s?.tenant_id!==source.tenant_id||Number(s?.version)!==Number(source.version)
    ||t?.company_id!==target.company_id||t?.tenant_id!==target.tenant_id||Number(t?.version)!==Number(target.version)
    ||s?.runtime_config?.routing?.line_key!==lineKey||t?.runtime_config?.routing?.line_key!==lineKey
    ||c?.company_id!==source.company_id||c?.tenant_id!==source.tenant_id||Number(c?.version)!==Number(source.version)
    ||c?.policy_id!==s.policy_id||c?.run_id!==sourceRun)fail('FROZEN_CONFIG_MISMATCH');
  const rows=(await pool.query(`SELECT * FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND harvest_batch=$2`,[lineKey,sourceRun])).rows;
  if(rows.length!==sample.comment_limit||new Set(rows.map(r=>r.id)).size!==rows.length)fail('COMMENT_SET_INVALID');
  for(const row of rows){
    if(!UUID.test(row.id||'')||row.line_key!==lineKey||row.harvest_batch!==sourceRun
      ||row.source_video_url!==video.video_url||row.source_video!==video.title
      ||!['待分拣','已分拣'].includes(row.process_status)
      ||typeof row.comment_body!=='string'||!row.comment_body)fail('COMMENT_SCOPE_INVALID');
    verifyNative(row,sourceRun,sample.source_run,video,source,verifyRecipient);
  }
  return rows;
}
module.exports={admittedRows,readRunProof,LEGACY};
