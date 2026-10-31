// 103 评分终态与恢复读回；所有写入由调用方已有事务包裹。
'use strict';
const {createHash}=require('node:crypto');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashText=value=>createHash('sha256').update(String(value)).digest('hex');

async function scoreRecovery(pool,input,{lineKey,sourceRun,run,validSources}){
 const ids=input.ids;
 if(!sourceRun&&!validSources(ids,input.sources)||!Array.isArray(ids)||ids.length>1000
   ||new Set(ids).size!==ids.length||ids.some(id=>!uuid.test(id)))throw Error('POLICY_SCORE_RECOVERY_SCOPE_INVALID');
 if(!ids.length)return {ids:[],scored:0,excluded:0,excluded_ids:[],excluded_reasons:[],verified:true};
 const frozen=(await pool.query(`SELECT company_id,tenant_id,version,run_id,snapshot FROM zenithjoy.company_config_runs
   WHERE run_id=$1 AND snapshot->'runtime_config'->'routing'->>'line_key'=$2`,[run,lineKey])).rows;
 if(frozen.length!==1||frozen[0].run_id!==run||!frozen[0].snapshot
   ||frozen[0].snapshot.company_id!==frozen[0].company_id||frozen[0].snapshot.tenant_id!==frozen[0].tenant_id
   ||Number(frozen[0].snapshot.version)!==Number(frozen[0].version))throw Error('POLICY_SCORE_RECOVERY_AMBIGUOUS');
 const snapshot=frozen[0].snapshot;
 const rows=(await pool.query(`SELECT id,harvest_batch,line_key,process_status,relevance,intent_grade,
   comment_body,source_video,source_video_url,judgment_config FROM zenithjoy.leadgen_comments
   WHERE line_key=$1 AND ($2::text IS NULL OR harvest_batch=$2) AND id=ANY($3::uuid[])`,[lineKey,sourceRun,ids])).rows;
 if(rows.length!==ids.length||new Set(rows.map(r=>r.id)).size!==ids.length)throw Error('POLICY_SCORE_RECOVERY_AMBIGUOUS');
 const committed=[],excluded=[],excludedReasons=[];
 for(const row of rows){
  if(row.line_key!==lineKey||!ids.includes(row.id)||row.harvest_batch!==(sourceRun||input.sources[row.id]))throw Error('POLICY_SCORE_RECOVERY_AMBIGUOUS');
  const c=row.judgment_config;
  if(c?.run_id!==run)continue;
  if(c.exclusion_reason){
   const reviews=c.policy_reviews;
   if(c.company_id!==snapshot.company_id||c.tenant_id!==snapshot.tenant_id||c.policy_id!==snapshot.policy_id
     ||Number(c.version)!==Number(snapshot.version)||row.process_status!=='已排除'
     ||row.relevance!==null||row.intent_grade!==null
     ||c.exclusion_source?.comment_sha256!==hashText(row.comment_body)
     ||c.exclusion_source?.video_sha256!==hashText(row.source_video)
     ||c.exclusion_source?.video_url_sha256!==hashText(row.source_video_url)
     ||c.exclusion_source?.harvest_batch!==row.harvest_batch
     ||!['personal_intent_evidence_missing','audience_or_topic_evidence_missing'].includes(c.exclusion_reason)
     ||!Array.isArray(reviews)||reviews.length!==2
     ||reviews.some(v=>v?.status!=='unknown'||v.reason!==c.exclusion_reason||!v.model||!v.response_id
       ||!v.evidence_sha256||!v.original_sha256||!['A','B','C'].includes(v.candidate_grade))
     ||reviews[0].candidate_grade!==reviews[1].candidate_grade
     ||reviews[0].response_id===reviews[1].response_id
     ||reviews[0].evidence_sha256===reviews[1].evidence_sha256
     ||reviews[0].original_sha256!==reviews[1].original_sha256)throw Error('POLICY_SCORE_RECOVERY_AMBIGUOUS');
   excluded.push(row.id);excludedReasons.push({id:row.id,reason:c.exclusion_reason});continue;
  }
  if(c.company_id!==snapshot.company_id||c.tenant_id!==snapshot.tenant_id||c.policy_id!==snapshot.policy_id||Number(c.version)!==Number(snapshot.version)
    ||!c.policy_audit||c.policy_audit.status!=='pass'||!c.policy_audit.response_id
    ||!c.model_audit?.response_id||!c.model_audit?.model
    ||!['相关','不相关'].includes(row.relevance)||row.relevance==='相关'&&!['A','B','C'].includes(row.intent_grade))throw Error('POLICY_SCORE_RECOVERY_AMBIGUOUS');
  committed.push(row.id);
 }
 return {ids:committed,scored:committed.length,excluded:excluded.length,excluded_ids:excluded,
   excluded_reasons:excludedReasons,verified:true};
}

async function exclusionReadback(pool,input,context){
 const ids=input.ids;
 if(!Array.isArray(ids)||ids.length>50||ids.some(id=>!uuid.test(id))||new Set(ids).size!==ids.length)
   throw Error('POLICY_SCORE_EXCLUSION_IDS_INVALID');
 const recovery=await scoreRecovery(pool,input,context);
 const outbox=ids.length?(await pool.query(`SELECT comment_id FROM zenithjoy.leadgen_bridge_outbox
   WHERE line_key=$1 AND comment_id=ANY($2::uuid[])`,[context.lineKey,ids])).rows:[];
 const failures=ids.filter(id=>!recovery.excluded_ids.includes(id)).length+outbox.length;
 return {verified:failures===0,failures,ids,excluded_reasons:recovery.excluded_reasons};
}

async function commitExclusion(client,{row,verdict,semantic,evidence,lineKey,nextCursor}){
 const safeReviews=semantic.reviews.map(v=>({status:'unknown',reason:v.reason,candidate_grade:v.candidate_grade,
   model:v.model,response_id:v.response_id,evidence_sha256:v.evidence_sha256,original_sha256:v.original_sha256}));
 const audit={...evidence,model_audit:{model:verdict.audit.model,response_id:verdict.audit.response_id},
   exclusion_reason:semantic.reason,policy_reviews:safeReviews,
   exclusion_source:{harvest_batch:row.harvest_batch,comment_sha256:hashText(row.comment_body),
     video_sha256:hashText(row.source_video),video_url_sha256:hashText(row.source_video_url)}};
 const outbox=(await client.query(`SELECT comment_id FROM zenithjoy.leadgen_bridge_outbox
   WHERE line_key=$1 AND comment_id=$2 LIMIT 1`,[lineKey,row.id])).rows;
 if(outbox.length)throw Error('POLICY_SCORE_EXCLUSION_OUTBOX_EXISTS');
 const updated=await client.query(`UPDATE zenithjoy.leadgen_comments SET process_status='已排除',
   relevance=NULL,intent_grade=NULL,judgment_reason=$2,judgment_config=$3::jsonb,updated_at=now()
   WHERE id=$1 AND line_key=$4 AND process_status='待分拣'`,
 [row.id,`policy_excluded:${semantic.reason}`,JSON.stringify(audit),lineKey]);
 if(updated.rowCount!==1)throw Error('POLICY_SCORE_EXCLUSION_WRITE_FAILED');
 return {id:row.id,cursor:nextCursor,excluded:true,reason:semantic.reason};
}

module.exports={scoreRecovery,exclusionReadback,commitExclusion};
