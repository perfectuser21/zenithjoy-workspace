'use strict';
// Ordinary API activities may hand off exact committed comments before a video is exhausted.
// This is not formal sampled-run admission: both ordinary snapshots retain source_run=null.
const {isDeepStrictEqual}=require('node:util');
const native=require('./queued-recipient-evidence.js');
const {readCollectionAccountBinding}=require('./company-config-lib.js');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/;
const fail=code=>{throw Error(`COMMITTED_PARTIAL_${code}`);};
const OPS=new Set(['score_scope','score','score_recovery','score_exclusion_readback','policy_review','score_readback','mark_leads','mark_readback']);
function explicitIds(input,sourceRun){
 if(!Object.hasOwn(input,'committed_partial_ids'))return null;
 const ids=input.committed_partial_ids;
 if(sourceRun!==null||!OPS.has(input.op)||!Array.isArray(ids)||!ids.length||ids.length>50
   ||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!UUID.test(id)))fail('SCOPE_INVALID');
 if(input.ids!==undefined&&(!Array.isArray(input.ids)||input.ids.some(id=>!ids.includes(id))))fail('IDS_OUTSIDE_SCOPE');
 return ids;
}
async function readFrozen(pool,lineKey,run){
 if(!RUN.test(run||''))fail('RUN_INVALID');
 const rows=(await pool.query(`SELECT company_id,tenant_id,version,run_id,source_run,snapshot,task_inputs
   FROM zenithjoy.company_config_runs WHERE run_id=$1
   AND snapshot->'runtime_config'->'routing'->>'line_key'=$2`,[run,lineKey])).rows;
 const f=rows[0],s=f?.snapshot;
 if(rows.length!==1||f.run_id!==run||f.source_run!==null||!s||s.config_status!=='enabled'
   ||typeof s.company_id!=='string'||!s.company_id||typeof s.tenant_id!=='string'||!s.tenant_id
   ||!Number.isSafeInteger(s.version)||s.version<1||f.company_id!==s.company_id
   ||f.tenant_id!==s.tenant_id||Number(f.version)!==s.version||!s.policy_id
   ||s.runtime_config?.routing?.line_key!==lineKey||!s.runtime_config.comment_scoring)fail('FROZEN_CONFIG_INVALID');
 return f;
}
function samePolicy(a,b){return ['company_id','tenant_id','version','policy_id'].every(k=>a[k]===b[k])
 &&isDeepStrictEqual(a.runtime_config.comment_scoring,b.runtime_config.comment_scoring);}
function verifyIdentity(row,video,source,binding){
 const e=row.recipient_evidence,s=source.snapshot,c=video?.judgment_config;
 if(!UUID.test(row.id||'')||row.line_key!==s.runtime_config.routing.line_key||row.harvest_batch!==source.run_id
   ||!['待分拣','已分拣'].includes(row.process_status)||typeof row.comment_body!=='string'||!row.comment_body
   ||typeof row.nickname!=='string'||!row.nickname||typeof row.douyin_id!=='string'||!row.douyin_id
   ||typeof row.profile_url!=='string'||!/^https:\/\/(?:www|v)\.douyin\.com\/[A-Za-z0-9._/-]+$/.test(row.profile_url)
   ||!video||video.line_key!==row.line_key||video.harvest_batch!==row.harvest_batch
   ||!/^\d{16,24}$/.test(video.video_id||'')||video.video_url!==`https://www.douyin.com/video/${video.video_id}`
   ||row.source_video_url!==video.video_url||row.source_video!==video.title||video.judgment_status!=='matched'
   ||!['待判定','评论已采',`处理中:${row.harvest_batch}`].includes(video.process_status)
   ||c?.run_id!==row.harvest_batch||c.company_id!==s.company_id||c.tenant_id!==s.tenant_id
   ||Number(c.version)!==s.version||c.policy_id!==s.policy_id)fail('ROW_VIDEO_INVALID');
 if(e?.status!=='verified'||!e.company_binding||e.scope?.source_run!==null
   ||e.scope.video_id!==video.video_id||e.scope.video_url!==row.source_video_url)fail('RECIPIENT_UNVERIFIED');
 native.validateEvidence(e,{line_key:row.line_key,run:row.harvest_batch,douyin_id:row.douyin_id,
   nickname:row.nickname,comment_body:row.comment_body,comment_body_sha256:native.hash(row.comment_body),
   video_url:row.source_video_url},{companyBinding:binding});
 return row;
}
async function readOne(pool,{lineKey,id,run,requireLease=false}){
 const rows=(await pool.query('SELECT * FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND id=$2'+(requireLease?' FOR UPDATE':''),[lineKey,id])).rows;
 if(rows.length!==1||rows[0].id!==id)fail('COMMENT_MISSING');
 const row=rows[0],source=await readFrozen(pool,lineKey,row.harvest_batch);
 const videos=(await pool.query('SELECT * FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_url=$2'+(requireLease?' FOR UPDATE':''),[lineKey,row.source_video_url])).rows;
 if(videos.length!==1)fail('VIDEO_AMBIGUOUS');
 const video=videos[0];
 if(requireLease&&(row.harvest_batch!==run||video.process_status!==`处理中:${run}`))fail('LEASE_NOT_OWNED');
 const binding=await readCollectionAccountBinding(pool,{lineKey,run:row.harvest_batch,sourceRun:null});
 return {row,source,video,binding};
}
async function admittedRows(pool,{lineKey,run,ids}){
 if(!Array.isArray(ids)||!ids.length||ids.length>50||new Set(ids).size!==ids.length||ids.some(id=>!UUID.test(id||'')))fail('SCOPE_INVALID');
 const target=await readFrozen(pool,lineKey,run),out=[];
 for(const id of ids){
  const {row,source,video,binding}=await readOne(pool,{lineKey,id});
  if(!samePolicy(source.snapshot,target.snapshot))fail('POLICY_MISMATCH');
  out.push(verifyIdentity(row,video,source,binding));
 }
 return out;
}
const identityKeys=['id','line_key','harvest_batch','source_video','source_video_url','douyin_id','nickname','comment_body','profile_url','recipient_evidence'];
function contains(rows,row){return Boolean(row&&rows.some(a=>identityKeys.every(k=>isDeepStrictEqual(a[k],row[k]))));}
async function certify(pool,input,{lineKey}){
 const {comment_id:id,comment,video_id:videoId,video_url:videoUrl,run}=input;
 if(!UUID.test(id||'')||!comment||!/^\d{16,24}$/.test(videoId||'')||videoUrl!==`https://www.douyin.com/video/${videoId}`||input.source_run!=null)fail('CERTIFICATION_SCOPE_INVALID');
 const {row,source,video,binding}=await readOne(pool,{lineKey,id,run,requireLease:true});
 if(video.video_id!==videoId||row.source_video_url!==videoUrl||row.process_status!=='待分拣'
   ||row.relevance!==null||row.intent_grade!==null||row.judgment_reason!==null||row.judgment_config!==null
   ||row.nickname!==comment.nickname||row.douyin_id!==comment.douyinId||row.comment_body!==comment.commentBody
   ||row.profile_url!==comment.profileUrl||row.source_video!==comment.sourceVideo||row.source_video_url!==comment.sourceVideoUrl)fail('CERTIFICATION_ROW_CHANGED');
 const candidate={...row,recipient_evidence:comment.recipientEvidence};verifyIdentity(candidate,video,source,binding);
 if(row.recipient_evidence?.status==='verified'){
  if(!isDeepStrictEqual(row.recipient_evidence,comment.recipientEvidence))fail('ALREADY_CERTIFIED');
  return {certified:0,already_certified:true,id,video_id:videoId};
 }
 const updated=await pool.query(`UPDATE zenithjoy.leadgen_comments SET recipient_evidence=$2::jsonb,updated_at=now()
   WHERE id=$1 AND line_key=$3 AND harvest_batch=$4 AND process_status='待分拣'
   AND relevance IS NULL AND intent_grade IS NULL AND judgment_config IS NULL
   AND COALESCE(recipient_evidence->>'status','')<>'verified' RETURNING id`,[id,JSON.stringify(comment.recipientEvidence),lineKey,run]);
 if(updated.rowCount!==1||updated.rows[0]?.id!==id)fail('CERTIFICATION_NOT_PERSISTED');
 return {certified:1,id,video_id:videoId};
}
async function certificationReadback(pool,input,{lineKey}){
 if(!UUID.test(input.comment_id||'')||input.source_run!=null)fail('CERTIFICATION_SCOPE_INVALID');
 const {row,source,video,binding}=await readOne(pool,{lineKey,id:input.comment_id});
 if(row.harvest_batch!==input.run||video.video_id!==input.video_id)fail('CERTIFICATION_SCOPE_INVALID');
 verifyIdentity(row,video,source,binding);
 return {verified:true,id:row.id,video_id:video.video_id,recipient_status:'verified',douyin_id:row.douyin_id};
}
module.exports={explicitIds,admittedRows,contains,certify,certificationReadback};
