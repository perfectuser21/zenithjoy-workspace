// 单次操作员维护；不改变判定、旧运行结果或其他视频。
'use strict';
const {createHash}=require('node:crypto');
const DECISION='ab68977b-2670-4a90-9d84-bdd3b25f3e04';
const RECOVERY_RUN='single_video_recovery_ab68977b_a2';
const SCOPE=Object.freeze({scope_version:1,action:'restore_single_quarantined_video_to_comment_collection',project_id:'67bd1fc3-3027-4f13-83c8-c656e3408bfc',root_task_id:'93723f83-9474-465a-93ec-bc3782053638',company_id:'ef8e14b0-4018-4e54-bc7a-866e51a0ce0b',tenant_id:'a4ca8914-f5a7-4928-b1e3-6b69f9c0ab61',policy_id:'jinoshengyuan-existing-acquisition-rules-v1',company_config_version:14,video_ids:['7699316353698753663'],original_task_id:'0c764ecc-9260-4a3b-a85e-29c75c8966dc',original_run:'cicd24c9_102_20261023_2052',source_status:'待人工核验:cicd24c9_102_20261023_2052',target_status:'待采评论',requirements:['独立核验旧执行停止','精确匹配公司、政策、原run及原owner','保留原失败及其他待人工记录','恢复写入具备审计及幂等','最多采5条评论','继续限批验收102/103'],max_comments_per_video:5,allow_direct_messages:false,allow_other_video_recovery:false});
const canonical=x=>JSON.stringify(x instanceof Date?x.toJSON():x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):x);
const hash=x=>createHash('sha256').update(canonical(x)).digest('hex');
const fail=code=>{throw Error('RECOVERY_'+code);};
function createRecovery({scope,decision,run,authority:authorityFactory}){
const SCOPE=scope,DECISION=decision,RECOVERY_RUN=run;
const qualificationRun=SCOPE.qualification_run||SCOPE.original_run;
const scopeHash=hash(SCOPE),hex=/^[a-f0-9]{64}$/;
function checkAuthority(a,input){
 let s;try{s=JSON.parse(a?.decision?.decision);}catch{fail('DECISION_INVALID');}
 if(a.decision.id!==DECISION||a.decision.made_by!=='user'||a.decision.status!=='active'||hash(s)!==scopeHash)fail('DECISION_INVALID');
 if(a.originalTask?.id!==SCOPE.original_task_id||a.originalTask.status!=='failed'||a.maintenanceTask?.id!==input.maintenance_task_id
  ||a.maintenanceTask.project_id!==SCOPE.project_id||a.maintenanceTask.parent_task_id!==SCOPE.root_task_id||a.maintenanceTask.status!=='in_progress'
  ||a.actor!=='codex:single-video-recovery'||a.maintenanceTask.claimed_by!==a.actor||!hex.test(a.evidence_sha256||''))fail('AUTHORITY_INVALID');
}
async function checkGuard(guard,input){
 const s=await guard.read();
 if(!s||s.old_session_terminal!==true||s.old_native_stopped!==true||s.pending!==0||s.active!==0||s.guard_held!==true
  ||s.local_owner!==input.run||s.central_owner!==input.maintenance_task_id||!Number.isSafeInteger(s.observed_at)||Date.now()-s.observed_at>5000
  ||s.observed_at>Date.now()+1000||!hex.test(s.evidence_sha256||''))fail('RESOURCE_UNKNOWN');
 return s.evidence_sha256;
}
function validateInput(input){
 if(input.decision_id!==DECISION||input.video_id!==SCOPE.video_ids[0]||input.line!=='jinuo'||input.run!==RECOVERY_RUN
  ||!/^[-a-f0-9]{36}$/.test(input.maintenance_task_id||'')||Object.keys(input).some(k=>!['op','line','run','decision_id','maintenance_task_id','video_id','evidence_root'].includes(k)))fail('SCOPE_INVALID');
}
function receiptResult(receipts,row,authority,input){
 if(!receipts.length)return null;const r=receipts[0];
 if(receipts.length!==1||!row||r.action!=='leadgen_single_video_recovery'||r.org_id!==SCOPE.tenant_id||r.table_id!==null||r.member_id!==authority.actor
  ||r.detail?.scope_sha256!==scopeHash||r.detail?.video_id!==input.video_id||r.detail?.decision_id!==DECISION||!hex.test(r.detail?.before_sha256||'')||!hex.test(r.detail?.after_sha256||''))fail('RECEIPT_CONFLICT');
 if(row.process_status===SCOPE.target_status&&hash(row)===r.detail.after_sha256)return {status:'already_applied',decision_id:DECISION,video_id:input.video_id};
 const c=row.judgment_config;
 if(row.line_key!=='jinuo'||row.video_id!==input.video_id||row.video_url!==`https://www.douyin.com/video/${input.video_id}`||row.judgment_status!=='matched'
  ||c?.company_id!==SCOPE.company_id||c.tenant_id!==SCOPE.tenant_id||c.version!==14||c.policy_id!==SCOPE.policy_id||![qualificationRun,row.harvest_batch].includes(c.run_id)
  ||!/^处理中:[a-zA-Z0-9_-]+$/.test(row.process_status)&&row.process_status!=='评论已采'
  ||row.process_status.startsWith('处理中:')&&row.harvest_batch!==row.process_status.slice(4))fail('RECEIPT_STATE_CONFLICT');
 return {status:'consumed',decision_id:DECISION,video_id:input.video_id};
}
// 仅显式V2资格来源启用；V1仍沿原单run合同。
async function qualificationPolicy(pool){
 const rows=(await pool.query('SELECT * FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=ANY($2::text[])',[SCOPE.company_id,[SCOPE.original_run,qualificationRun]])).rows;
 if(rows.length!==2||[SCOPE.original_run,qualificationRun].some(run=>rows.filter(f=>f.run_id===run).length!==1)
  ||rows.some(f=>f.company_id!==SCOPE.company_id||f.tenant_id!==SCOPE.tenant_id||f.version!==SCOPE.company_config_version||f.source_run!=='cicd24c9_101_20261023_2013'
   ||f.snapshot?.company_id!==SCOPE.company_id||f.snapshot.tenant_id!==SCOPE.tenant_id||f.snapshot.version!==SCOPE.company_config_version||f.snapshot.policy_id!==SCOPE.policy_id)
  ||hash(rows[0].snapshot)!==hash(rows[1].snapshot))fail('QUALIFICATION_SOURCE_CONFLICT');
 return hash(rows[0].snapshot);
}
async function consumedSource(pool,row,result){
 const policyHash=SCOPE.qualification_run?await qualificationPolicy(pool):null;
 if(result?.status==='consumed'){
  const a=(await pool.query('SELECT * FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=$2',[SCOPE.company_id,row.harvest_batch])).rows;
  const f=a[0];if(a.length!==1||f.tenant_id!==SCOPE.tenant_id||f.version!==14||f.source_run!=='cicd24c9_101_20261023_2013'||f.snapshot?.policy_id!==SCOPE.policy_id||policyHash&&hash(f.snapshot)!==policyHash)fail('RECEIPT_SOURCE_CONFLICT');
 }
 return result;
}
async function readbackSingleVideo(pool,input,deps){
 validateInput(input);deps=deps||(authorityFactory?authorityFactory(input):require('./single-video-recovery-authority.js'));const a=await deps.readAuthority(input);checkAuthority(a,input);
 const result=(await pool.query(`SELECT to_jsonb(a) receipt,to_jsonb(v) video FROM zenithjoy.db_audit a
  LEFT JOIN zenithjoy.leadgen_videos v ON v.line_key=$2 AND v.video_id=$3 WHERE a.id=$1`,[DECISION,'jinuo',input.video_id])).rows;
 if(!result.length)return {status:'unknown',decision_id:DECISION,video_id:input.video_id};
 return consumedSource(pool,result[0].video,receiptResult(result.map(r=>r.receipt),result[0].video,a,input));
}
async function recoverSingleVideo(pool,input,deps){
 validateInput(input);
 deps=deps||(authorityFactory?authorityFactory(input):require('./single-video-recovery-authority.js'));
 const authority=await deps.readAuthority(input);checkAuthority(authority,input);
 const existing=await readbackSingleVideo(pool,input,deps);if(existing.status!=='unknown')return existing;
 const guard=await deps.acquireGuard(input);let client,commitStarted=false,committed=false,discardConnection=false,failure;
 try{
  client=await pool.connect();
  await checkGuard(guard,input);
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['single-video-recovery:'+DECISION]);
  const rows=(await client.query('SELECT to_jsonb(v) AS video FROM zenithjoy.leadgen_videos v WHERE line_key=$1 AND video_id=$2 FOR UPDATE',['jinuo',input.video_id])).rows;
  if(rows.length!==1)fail('VIDEO_NOT_UNIQUE');const row=rows[0].video;
  const receipts=(await client.query('SELECT * FROM zenithjoy.db_audit WHERE id=$1',[DECISION])).rows;
  if(receipts.length){const result=await consumedSource(client,row,receiptResult(receipts,row,authority,input));await client.query('ROLLBACK');return result;}
  const c=row.judgment_config;
  if(row.process_status!==SCOPE.source_status||row.judgment_status!=='matched'||row.harvest_batch!==SCOPE.original_run||row.video_url!==`https://www.douyin.com/video/${input.video_id}`
   ||c?.company_id!==SCOPE.company_id||c.tenant_id!==SCOPE.tenant_id||c.version!==14||c.policy_id!==SCOPE.policy_id||c.run_id!==qualificationRun)fail('VIDEO_SCOPE_CONFLICT');
  const frozen=(await client.query('SELECT * FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=$2',[SCOPE.company_id,SCOPE.original_run])).rows;
  const f=frozen[0];if(frozen.length!==1||f.tenant_id!==SCOPE.tenant_id||f.version!==14||f.source_run!=='cicd24c9_101_20261023_2013'
   ||f.snapshot?.company_id!==SCOPE.company_id||f.snapshot.tenant_id!==SCOPE.tenant_id||f.snapshot.version!==14||f.snapshot.policy_id!==SCOPE.policy_id)fail('POLICY_CONFLICT');
  if(SCOPE.qualification_run)await qualificationPolicy(client);
  const comments=(await client.query('SELECT id FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND source_video_url=$2 LIMIT 1',['jinuo',row.video_url])).rows;
  if(comments.length)fail('COMMENTS_PRESENT');
  // 事务持锁后再次读取真实资源与决定，不能信调用方的布尔值或缓存批准。
  const fresh=await deps.readAuthority(input);checkAuthority(fresh,input);
  const safetyHash=await checkGuard(guard,input);
  const after=(await client.query(`UPDATE zenithjoy.leadgen_videos SET process_status=$4,updated_at=now()
    WHERE line_key=$1 AND video_id=$2 AND process_status=$3 AND judgment_status='matched' AND judgment_config=$5::jsonb AND harvest_batch=$6 RETURNING to_jsonb(leadgen_videos) AS video`,
   ['jinuo',input.video_id,SCOPE.source_status,SCOPE.target_status,JSON.stringify(c),SCOPE.original_run])).rows;
  if(after.length!==1)fail('CAS_CONFLICT');
  const detail={decision_id:DECISION,video_id:input.video_id,original_task_id:SCOPE.original_task_id,original_run:SCOPE.original_run,scope_sha256:scopeHash,
   before_sha256:hash(row),after_sha256:hash(after[0].video),evidence_sha256:fresh.evidence_sha256,safety_sha256:safetyHash,maintenance_task_id:input.maintenance_task_id,action:'restore_to_comment_collection'};
  await client.query('INSERT INTO zenithjoy.db_audit(id,org_id,table_id,member_id,action,detail) VALUES($1,$2,NULL,$3,$4,$5::jsonb)',[DECISION,SCOPE.tenant_id,authority.actor,'leadgen_single_video_recovery',JSON.stringify(detail)]);
  await checkGuard(guard,input);commitStarted=true;await client.query('COMMIT');committed=true;
  return {status:'applied',decision_id:DECISION,video_id:input.video_id,receipt_sha256:hash(detail)};
 }catch(error){
  if(commitStarted&&!committed){const unknown=Error('RECOVERY_COMMIT_UNKNOWN_READBACK_REQUIRED');unknown.code='RECOVERY_COMMIT_UNKNOWN';failure=unknown;throw unknown;}
  failure=error;try{if(client)await client.query('ROLLBACK');}catch{discardConnection=true;error.rollback_code='RECOVERY_ROLLBACK_UNKNOWN';}throw error;
 }finally{client?.release(discardConnection||commitStarted&&!committed?true:undefined);try{await guard.release();}catch{if(failure)failure.cleanup_code='RECOVERY_LOCK_RELEASE_UNKNOWN';else{const e=Error('RECOVERY_LOCK_RELEASE_UNKNOWN_READBACK_REQUIRED');e.code='RECOVERY_LOCK_RELEASE_UNKNOWN';throw e;}}}
}
return {recoverSingleVideo,readbackSingleVideo};
}
const legacy=createRecovery({scope:SCOPE,decision:DECISION,run:RECOVERY_RUN});
module.exports={...legacy,SCOPE,DECISION,RECOVERY_RUN,hash,createRecovery};
