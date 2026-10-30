// v2/v3仅交接已保存且仍待判定的一行；v3必须同时核恢复审计与新consumer固定来源。
'use strict';
const {isDeepStrictEqual}=require('node:util');
async function claimPendingProducer(pool,input,deps={}){
 const {validateProducerDescriptor}=await import('./producer-descriptor.mjs');
 const fail=()=>{throw Error('PRODUCER_PENDING_CLAIM_SCOPE_INVALID');};
 const d=validateProducerDescriptor(input.producer_descriptor);
 if(![2,3].includes(d.schema_version)||input.op!=='claim_videos'||input.line!==d.line||input.source_run!==d.run_tag||input.limit!==1
  ||input.config_required!==true||input.prefer_matched===true||!Array.isArray(input.video_ids)||input.video_ids.length!==1||input.video_ids[0]!==d.video_ids[0])fail();
 if(d.schema_version===3&&deps.sourceCommit!==d.consumer_source_commit)fail();
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const rows=(await c.query(`SELECT company_id,tenant_id,version,run_id,snapshot,source_run,task_inputs FROM zenithjoy.company_config_runs
   WHERE company_id=$1 AND run_id=ANY($2::text[]) FOR SHARE`,[d.company_id,[d.run_tag,input.run]])).rows;
  for(const run of [d.run_tag,input.run]){
   const matches=rows.filter(r=>r.run_id===run),r=matches[0],s=r?.snapshot;
   if(matches.length!==1||r.company_id!==d.company_id||r.tenant_id!==d.tenant_id||r.version!==d.company_config_version
    ||s?.company_id!==d.company_id||s.tenant_id!==d.tenant_id||s.version!==d.company_config_version||s.policy_id!==d.policy_id
    ||s.config_status!=='enabled'||s.runtime_config?.routing?.line_key!==d.line
    ||run===d.run_tag&&(r.source_run??null)!==null||run===input.run&&r.source_run!==d.run_tag)fail();
   const accounts=s.runtime_config.platform_accounts?.filter(a=>a.profile===d.profile&&a.enabled!==false),a=accounts?.[0];
   if(accounts?.length!==1||a.enabled!==true||a.verification_status!=='verified'||a.platform!==undefined&&a.platform!=='douyin'||a.company_id!==d.company_id||a.tenant_id!==d.tenant_id||a.device_serial!==d.serial
    ||a.douyin_id!==(d.schema_version===3?'langzi63485':'44997267357'))fail();
   // 固定legacy源沿原M4原生账号前置；不为兼容补写旧资料，也不放宽MMV的强制绑定。
   if(run===input.run&&Object.hasOwn(r.task_inputs||{},'device_binding')&&!isDeepStrictEqual(r.task_inputs.device_binding,{profile:d.profile,device_serial:d.serial}))fail();
  }
  if(!isDeepStrictEqual(rows.find(r=>r.run_id===d.run_tag).snapshot,rows.find(r=>r.run_id===input.run).snapshot))fail();
  if(d.schema_version===3){
   const {SCOPE,intentId,digest}=require('./qualification-quarantine-recovery-102n.js');
   const audit=(await c.query('SELECT * FROM zenithjoy.db_audit WHERE id=$1',[intentId(d.decision_id,d.video_ids[0])])).rows;
   const videos=(await c.query('SELECT to_jsonb(v) AS video FROM zenithjoy.leadgen_videos v WHERE line_key=$1 AND video_id=$2 FOR UPDATE',[d.line,d.video_ids[0]])).rows;
   const a=audit[0],r=videos[0]?.video,detail=a?.detail;
   if(audit.length!==1||videos.length!==1||a.action!=='leadgen_102n_qualification_recovery'||a.org_id!==SCOPE.tenant_id
    ||a.member_id!=='codex:qualification-recovery-102n'||detail?.decision_id!==d.decision_id||detail.video_id!==d.video_ids[0]
    ||detail.scope_sha256!==digest(SCOPE)||!/^([a-f0-9]{64})$/.test(detail.before_sha256||'')
    ||detail.after_sha256!==digest(r)||r.process_status!=='待判定'||r.harvest_batch!==d.run_tag
    ||r.judgment_status!=='pending'||r.judgment_config!==null||r.video_url!==`https://www.douyin.com/video/${d.video_ids[0]}`)fail();
  }
  const claimed=await c.query(`WITH pending AS (
   SELECT id FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_id=$2
   AND judgment_status='pending' AND judgment_config IS NULL AND process_status='待判定' AND harvest_batch=$3
   FOR UPDATE SKIP LOCKED)
   UPDATE zenithjoy.leadgen_videos v SET process_status=$4,harvest_batch=$5,updated_at=now()
   FROM pending p WHERE v.id=p.id RETURNING v.*`,[d.line,d.video_ids[0],d.run_tag,`处理中:${input.run}`,input.run]);
  if(claimed.rows.length>1)fail();
  await c.query('COMMIT');return claimed.rows;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
module.exports={claimPendingProducer};
