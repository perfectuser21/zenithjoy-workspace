import {isDeepStrictEqual} from 'node:util';
import {digest} from './runtime-definition.mjs';
const action='qualification_maintenance_return_pending_claim';
const need=value=>{if(!value)throw Error('MAINTENANCE_PG_SCOPE_CHANGED');};
// 正式历史producer原快照；不是读取current后拿其自身作恢复基线。
export async function readHistoricalCompanySnapshot(pool,{authorization:a,company_receipt:r}) {
 const s=a?.scope,hash=s?.original_evidence?.company_snapshot_sha256;
 need(a&&s&&a.contract_sha256===digest(s)&&a.original_task_id===s.original_task_id&&/^[a-f0-9]{64}$/.test(hash||''));
 need(r?.company_id===s.company_id&&r.tenant_id===s.tenant_id&&r.version===s.config_version
  &&r.policy_id===s.policy_id&&r.run_id===s.run_tag);
 const rows=(await pool.query('SELECT company_id,tenant_id,version,run_id,source_run,snapshot FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=$2',[s.company_id,s.producer_run])).rows;
 const row=rows[0],snapshot=row?.snapshot;
 need(rows.length===1&&row.company_id===s.company_id&&row.tenant_id===s.tenant_id&&row.version===s.config_version
  &&row.run_id===s.producer_run&&row.source_run===null&&snapshot?.company_id===s.company_id
  &&snapshot.tenant_id===s.tenant_id&&snapshot.version===s.config_version&&snapshot.policy_id===s.policy_id
  &&snapshot.config_status==='enabled'&&snapshot.runtime_config?.routing?.line_key===s.line_key
  &&digest(snapshot)===hash&&isDeepStrictEqual(snapshot.product_ids,r.product_ids));
 return structuredClone(snapshot);
}
function context(input,{requireEffects=true}={}) {
 const a=input?.authorization,s=a?.scope;
 need(a&&s&&a.contract_sha256===digest(s)&&a.original_task_id===s.original_task_id
  &&Array.isArray(s.video_ids)&&s.video_ids.length===1&&(!requireEffects||/^[a-f0-9]{64}$/.test(input.effects_receipt_sha256||''))
  &&input.expected_snapshot?.company_id===s.company_id&&input.expected_snapshot.tenant_id===s.tenant_id
  &&input.expected_snapshot.version===s.config_version&&input.expected_snapshot.policy_id===s.policy_id);
 return {a,s};
}
function auditMatches(row,input) {
 const {a,s}=context(input,{requireEffects:false}),d=row?.detail;
 return row?.id===s.intent_id&&row.action===action&&row.org_id===s.tenant_id&&row.member_id===a.actor
  &&d?.contract_sha256===a.contract_sha256&&/^[a-f0-9]{64}$/.test(d.effects_receipt_sha256||'')
  &&(input.effects_receipt_sha256===undefined||d.effects_receipt_sha256===input.effects_receipt_sha256)
  &&d.company_snapshot_sha256===digest(input.expected_snapshot)&&d.video_id===s.video_ids[0]
  &&d.original_task_id===s.original_task_id&&d.maintenance_task_id===a.maintenance_task_id
  &&d.from_process_status==='处理中:'+s.run_tag&&d.from_batch===s.run_tag
  &&d.to_process_status==='待判定'&&d.to_batch===s.producer_run;
}
// 内部事务组件；公开入口必须自行在guard内重验Task、候选、effects，不能接CLI proof JSON。
export async function restorePendingClaim(pool,input) {
 const {a,s}=context(input),c=await pool.connect();let commitSent=false,destroyConnection=false;
 try {
  await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[s.intent_id]);
  const old=(await c.query('SELECT * FROM zenithjoy.db_audit WHERE id=$1',[s.intent_id])).rows;
  // 已有意图只能走独立readback；不再执行业务UPDATE。
  if(old.length)throw Error('MAINTENANCE_PG_READBACK_REQUIRED');
  const profiles=(await c.query('SELECT * FROM zenithjoy.tenant_company_profiles WHERE company_id=$1 FOR SHARE',[s.company_id])).rows;
  need(profiles.length===1&&profiles[0].tenant_id===s.tenant_id&&profiles[0].config_version===s.config_version&&profiles[0].config_status==='enabled'
   &&isDeepStrictEqual(profiles[0].runtime_config,input.expected_snapshot.runtime_config));
  const versions=(await c.query('SELECT snapshot FROM zenithjoy.company_config_versions WHERE company_id=$1 AND tenant_id=$2 AND version=$3 FOR SHARE',[s.company_id,s.tenant_id,s.config_version])).rows;
  need(versions.length===1&&isDeepStrictEqual(versions[0].snapshot,input.expected_snapshot));
  const runs=(await c.query('SELECT * FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=ANY($2::text[]) FOR SHARE',[s.company_id,[s.producer_run,s.run_tag]])).rows;
  for(const run of [s.producer_run,s.run_tag]) {
   const matches=runs.filter(r=>r.run_id===run),r=matches[0];
   need(matches.length===1&&r.tenant_id===s.tenant_id&&r.version===s.config_version
    &&(r.source_run??null)===(run===s.producer_run?null:s.producer_run)
    &&isDeepStrictEqual(r.snapshot,input.expected_snapshot));
  }
  const videos=(await c.query('SELECT to_jsonb(v) AS row FROM zenithjoy.leadgen_videos v WHERE line_key=$1 AND video_id=$2 FOR UPDATE',[s.line_key,s.video_ids[0]])).rows;
  const v=videos[0]?.row;need(videos.length===1&&v.judgment_status==='pending'&&v.judgment_config===null
   &&v.transcript===null&&v.judgment_reason===null&&v.process_status==='处理中:'+s.run_tag&&v.harvest_batch===s.run_tag);
  const comments=(await c.query('SELECT count(*)::int AS n FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND harvest_batch=$2',[s.line_key,s.run_tag])).rows[0];need(comments.n===0);
  const updated=await c.query(`UPDATE zenithjoy.leadgen_videos v SET process_status='待判定',harvest_batch=$1
   WHERE id=$2 AND process_status=$3 AND harvest_batch=$4 AND judgment_status='pending'
   AND transcript IS NULL AND judgment_config IS NULL AND judgment_reason IS NULL RETURNING to_jsonb(v) AS row`,[s.producer_run,v.id,'处理中:'+s.run_tag,s.run_tag]);
  need(updated.rows.length===1);
  const expected={...v,process_status:'待判定',harvest_batch:s.producer_run};need(isDeepStrictEqual(updated.rows[0].row,expected));
  const detail={contract_sha256:a.contract_sha256,effects_receipt_sha256:input.effects_receipt_sha256,
   company_snapshot_sha256:digest(input.expected_snapshot),video_id:s.video_ids[0],original_task_id:s.original_task_id,
   maintenance_task_id:a.maintenance_task_id,from_process_status:v.process_status,from_batch:v.harvest_batch,
   to_process_status:'待判定',to_batch:s.producer_run,before_row_sha256:digest(v),after_row_sha256:digest(expected)};
  await c.query('INSERT INTO zenithjoy.db_audit(id,org_id,member_id,action,detail) VALUES($1,$2,$3,$4,$5::jsonb)',[s.intent_id,s.tenant_id,a.actor,action,JSON.stringify(detail)]);
  commitSent=true;await c.query('COMMIT');
  return {status:'db_committed',intent_id:s.intent_id,audit_sha256:digest(detail)};
 }catch(error) {
  if(commitSent){destroyConnection=true;return {status:'commit_unknown',intent_id:s.intent_id};}
  try{await c.query('ROLLBACK');}catch{destroyConnection=true;}
  throw error;
 }finally{c.release(destroyConnection);}
}
// 提交未知后只读对账，不UPDATE、不再COMMIT、不代清新owner。
export async function readPendingClaimOutcome(pool,input) {
 const {s}=context(input,{requireEffects:false});
 const audits=(await pool.query('SELECT * FROM zenithjoy.db_audit WHERE id=$1',[s.intent_id])).rows;
 const videos=(await pool.query('SELECT to_jsonb(v) AS row FROM zenithjoy.leadgen_videos v WHERE line_key=$1 AND video_id=$2',[s.line_key,s.video_ids[0]])).rows;
 const v=videos[0]?.row;
 // 只是此刻未见已提交audit且原claim在；不保证没有in-flight COMMIT。
 // 后续唯一事务仍先持相同intent advisory lock再查audit，绝不凭此读回重发COMMIT。
 if(audits.length===0&&videos.length===1&&v.process_status==='处理中:'+s.run_tag&&v.harvest_batch===s.run_tag
  &&v.judgment_status==='pending'&&v.transcript===null&&v.judgment_config===null&&v.judgment_reason===null)
  return {status:'db_not_committed',intent_id:s.intent_id,observation:'original_claim_present_no_committed_audit_observed'};
 if(audits.length===1&&auditMatches(audits[0],input)&&videos.length===1&&v.process_status==='待判定'
  &&v.harvest_batch===s.producer_run&&v.judgment_status==='pending'&&v.transcript===null&&v.judgment_config===null&&v.judgment_reason===null
  &&audits[0].detail.after_row_sha256===digest(v)
  &&audits[0].detail.before_row_sha256===digest({...v,process_status:'处理中:'+s.run_tag,harvest_batch:s.run_tag}))
  return {status:'db_committed',intent_id:s.intent_id,audit_sha256:digest(audits[0].detail),
   effects_receipt_sha256:audits[0].detail.effects_receipt_sha256,effects_evidence:'historical_audit_not_fresh_stop'};
 return {status:'blocked',reason:'MAINTENANCE_PG_OUTCOME_UNPROVEN',intent_id:s.intent_id};
}
