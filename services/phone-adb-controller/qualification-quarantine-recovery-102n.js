// 固定102n资格隔离范围；一条视频一笔事务，旧失败和旁行不改。
'use strict';
const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');

const SCOPE=Object.freeze({schema_version:1,action:'restore_102n_quarantined_pending_to_101n_qualification',
 project_id:'68ca6b4f-5e53-4ccf-a2aa-874e5c32bbe6',
 company_id:'ef8e14b0-4018-4e54-bc7a-866e51a0ce0b',tenant_id:'a4ca8914-f5a7-4928-b1e3-6b69f9c0ab61',
 policy_id:'jinoshengyuan-existing-acquisition-rules-v1',company_config_version:14,
 original_101_run:'accept7252_jinuo101n_20261031T0251',original_102_run:'accept7252_jinuo102n_20261031T0303',
 original_source_commit:'7252b6d2d6f279768753f086abc8c29ba968ea45',
 original_task_id:'51aef2df-78f8-40a3-be14-2574975e2585',
 video_ids:['7690206754872817819','7701984906457456467'],
 source_status:'待人工核验:accept7252_jinuo102n_20261031T0303',target_status:'待判定',
 max_comments_per_video:5,allow_direct_messages:false,allow_other_video_recovery:false});
const runFor=videoId=>'qualification_recovery_102n_'+videoId;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sha=/^[a-f0-9]{64}$/;
const fail=reason=>{throw Error('RECOVERY_102N_'+reason);};
const canonical=x=>JSON.stringify(x instanceof Date?x.toJSON():x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):x);
const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
function intentId(decisionId,videoId){
 const b=createHash('sha256').update('102n-qualification:'+decisionId+':'+videoId).digest().subarray(0,16);
 b[6]=(b[6]&15)|0x80;b[8]=(b[8]&63)|0x80;
 const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function validateRequest(input){
 if(!input||input.op!=='recover_102n_qualification'||input.line!=='jinuo'||input.run!==runFor(input.video_id)
  ||!uuid.test(input.decision_id||'')||!uuid.test(input.maintenance_task_id||'')
  ||!SCOPE.video_ids.includes(input.video_id)||Object.keys(input).sort().join(',')!=='decision_id,line,maintenance_task_id,op,run,video_id')fail('SCOPE_INVALID');
 return input;
}
function planBatch(videoIds,results){
 if(!Array.isArray(videoIds)||videoIds.length!==2||!isDeepStrictEqual(videoIds,SCOPE.video_ids)
  ||!Array.isArray(results)||results.length>2||new Set(results.map(r=>r.video_id)).size!==results.length
  ||results.some(r=>!videoIds.includes(r.video_id)||!['applied','already_applied','consumed','blocked','unknown','commit_unknown'].includes(r.status)))fail('BATCH_INVALID');
 const applied=results.filter(r=>['applied','already_applied'].includes(r.status)).map(r=>r.video_id);
 const consumed=results.filter(r=>r.status==='consumed').map(r=>r.video_id);
 const blocked=results.filter(r=>r.status==='blocked').map(r=>({video_id:r.video_id,reason:r.reason}));
 const unknown=results.filter(r=>['unknown','commit_unknown'].includes(r.status)).map(r=>({video_id:r.video_id,reason:r.reason||r.status}));
 return {status:unknown.length?'unknown':applied.length+consumed.length===2?'completed':'partial',applied,consumed,blocked,unknown,
  pending:videoIds.filter(id=>!results.some(r=>r.video_id===id))};
}
function validateBatch(input){
 if(!input||input.op!=='recover_102n_qualification_batch'||input.line!=='jinuo'
  ||!uuid.test(input.decision_id||'')||!uuid.test(input.maintenance_task_id||'')
  ||Object.keys(input).sort().join(',')!=='decision_id,line,maintenance_task_id,op')fail('BATCH_INVALID');
 return input;
}
function checkAuthority(a,input){
 let decisionScope;try{decisionScope=JSON.parse(a?.decision?.decision);}catch{fail('DECISION_INVALID');}
 if(a.decision.id!==input.decision_id||a.decision.made_by!=='user'||a.decision.status!=='active'
  ||!isDeepStrictEqual(decisionScope,SCOPE)||a.originalTask?.id!==SCOPE.original_task_id
  ||!['blocked','failed'].includes(a.originalTask.status)
  ||a.maintenanceTask?.id!==input.maintenance_task_id||a.maintenanceTask.project_id!==SCOPE.project_id
  ||a.maintenanceTask.status!=='in_progress'||a.maintenanceTask.claimed_by!=='codex:qualification-recovery-102n'
  ||a.actor!=='codex:qualification-recovery-102n'||!sha.test(a.evidence_sha256||''))fail('AUTHORITY_INVALID');
}
async function checkGuard(guard,input){
 const s=await guard.read();
 if(s?.original_run!==SCOPE.original_102_run||s.original_source_commit!==SCOPE.original_source_commit
  ||s.old_execution_stopped!==true||s.local_owner!==input.run||s.central_owner!==input.maintenance_task_id
  ||s.guard_held!==true||s.active!==0||s.pending!==0||!Number.isSafeInteger(s.observed_at)
  ||s.observed_at>Date.now()+1000||Date.now()-s.observed_at>5000||!sha.test(s.evidence_sha256||''))fail('RESOURCE_UNKNOWN');
 return s.evidence_sha256;
}
function checkAudit(a,row,input){
 const d=a?.detail,id=intentId(input.decision_id,input.video_id);
 if(a?.id!==id||a.action!=='leadgen_102n_qualification_recovery'||a.org_id!==SCOPE.tenant_id
  ||a.member_id!=='codex:qualification-recovery-102n'||d?.decision_id!==input.decision_id
  ||d.video_id!==input.video_id||d.scope_sha256!==digest(SCOPE)||!sha.test(d.before_sha256||'')
  ||!sha.test(d.after_sha256||''))fail('AUDIT_CONFLICT');
 if(row?.process_status===SCOPE.target_status&&row.harvest_batch===SCOPE.original_101_run
  &&digest(row)===d.after_sha256)return {status:'already_applied',video_id:input.video_id,intent_id:id};
 const leased=typeof row?.harvest_batch==='string'&&row.process_status===`处理中:${row.harvest_batch}`;
 const quarantined=typeof row?.harvest_batch==='string'&&row.process_status===`待人工核验:${row.harvest_batch}`;
 const settled=row?.process_status==='评论已采'&&row.judgment_status==='matched'
  ||row?.process_status==='待采评论'&&row.judgment_status==='matched';
 if(row?.video_id===input.video_id&&row.line_key==='jinuo'&&row.video_url===`https://www.douyin.com/video/${input.video_id}`
  &&row.harvest_batch!==SCOPE.original_101_run&&row.harvest_batch!==SCOPE.original_102_run
  &&(leased||quarantined||settled)&&['pending','matched','rejected'].includes(row.judgment_status))
  return {status:'consumed',video_id:input.video_id,intent_id:id};
 fail('AUDIT_STATE_CONFLICT');
}
async function verifyConsumedSource(pool,row,result){
 if(result.status!=='consumed')return result;
 const rows=(await pool.query(`SELECT company_id,tenant_id,version,source_run,snapshot FROM zenithjoy.company_config_runs
  WHERE company_id=$1 AND run_id=$2`,[SCOPE.company_id,row.harvest_batch])).rows;
 const r=rows[0],s=r?.snapshot;
 if(rows.length!==1||r.company_id!==SCOPE.company_id||r.tenant_id!==SCOPE.tenant_id||r.version!==14
  ||r.source_run!==SCOPE.original_101_run||s?.company_id!==SCOPE.company_id||s.tenant_id!==SCOPE.tenant_id
  ||s.version!==14||s.policy_id!==SCOPE.policy_id||s.config_status!=='enabled'
  ||s.runtime_config?.routing?.line_key!=='jinuo'
  ||row.judgment_status==='matched'&&(row.judgment_config?.company_id!==SCOPE.company_id
   ||row.judgment_config.tenant_id!==SCOPE.tenant_id||row.judgment_config.version!==14
   ||row.judgment_config.policy_id!==SCOPE.policy_id||row.judgment_config.run_id!==row.harvest_batch))fail('CONSUMED_SOURCE_CONFLICT');
 return result;
}
async function readback(pool,input,dep){
 validateRequest(input);dep=dep||require('./qualification-quarantine-recovery-102n-authority.js').createAuthority();
 const a=await dep.readAuthority(input);checkAuthority(a,input);
 const id=intentId(input.decision_id,input.video_id);
 const audits=(await pool.query('SELECT * FROM zenithjoy.db_audit WHERE id=$1',[id])).rows;
 if(!audits.length)return {status:'unknown',video_id:input.video_id,intent_id:id};
 const rows=(await pool.query('SELECT to_jsonb(v) AS video FROM zenithjoy.leadgen_videos v WHERE line_key=$1 AND video_id=$2',['jinuo',input.video_id])).rows;
 if(audits.length!==1||rows.length!==1)fail('AUDIT_STATE_CONFLICT');
 return verifyConsumedSource(pool,rows[0].video,checkAudit(audits[0],rows[0].video,input));
}
async function recover(pool,input,dep){
 validateRequest(input);dep=dep||require('./qualification-quarantine-recovery-102n-authority.js').createAuthority();
 if(!dep?.readAuthority||!dep?.acquireGuard)fail('AUTHORITY_UNAVAILABLE');
 const a=await dep.readAuthority(input);checkAuthority(a,input);
 const previous=await readback(pool,input,dep);if(previous.status!=='unknown')return previous;
 const guard=await dep.acquireGuard(input);let c,commitStarted=false,committed=false,destroy=false,failure;
 try{
  c=await pool.connect();await checkGuard(guard,input);await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  const id=intentId(input.decision_id,input.video_id);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[id]);
  const audits=(await c.query('SELECT * FROM zenithjoy.db_audit WHERE id=$1',[id])).rows;
  const rows=(await c.query('SELECT to_jsonb(v) AS video FROM zenithjoy.leadgen_videos v WHERE line_key=$1 AND video_id=$2 FOR UPDATE',['jinuo',input.video_id])).rows;
  if(rows.length!==1)fail('VIDEO_NOT_UNIQUE');const before=rows[0].video;
  if(audits.length){const outcome=await verifyConsumedSource(c,before,checkAudit(audits[0],before,input));await c.query('ROLLBACK');return outcome;}
  if(before.video_id!==input.video_id||before.video_url!==`https://www.douyin.com/video/${input.video_id}`
   ||before.process_status!==SCOPE.source_status||before.harvest_batch!==SCOPE.original_102_run
   ||before.judgment_status!=='pending'||before.judgment_config!==null||before.transcript!==null||before.judgment_reason!==null)fail('VIDEO_SCOPE_CONFLICT');
  const frozen=(await c.query(`SELECT company_id,tenant_id,version,run_id,source_run,snapshot FROM zenithjoy.company_config_runs
    WHERE company_id=$1 AND run_id=ANY($2::text[]) FOR SHARE`,[SCOPE.company_id,[SCOPE.original_101_run,SCOPE.original_102_run]])).rows;
  if(frozen.length!==2)fail('POLICY_CONFLICT');
  const producer=frozen.find(r=>r.run_id===SCOPE.original_101_run),consumer=frozen.find(r=>r.run_id===SCOPE.original_102_run);
  if(!producer||!consumer||producer.source_run!==null||consumer.source_run!==SCOPE.original_101_run
   ||[producer,consumer].some(r=>r.company_id!==SCOPE.company_id||r.tenant_id!==SCOPE.tenant_id||r.version!==14
    ||r.snapshot?.company_id!==SCOPE.company_id||r.snapshot.tenant_id!==SCOPE.tenant_id||r.snapshot.version!==14
    ||r.snapshot.policy_id!==SCOPE.policy_id||r.snapshot.config_status!=='enabled'
    ||r.snapshot.runtime_config?.routing?.line_key!=='jinuo')||!isDeepStrictEqual(producer.snapshot,consumer.snapshot))fail('POLICY_CONFLICT');
  const comments=(await c.query('SELECT id FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND source_video_url=$2 LIMIT 1',['jinuo',before.video_url])).rows;
  if(comments.length)fail('COMMENTS_PRESENT');
  checkAuthority(await dep.readAuthority(input),input);const evidence=await checkGuard(guard,input);
  const changed=(await c.query(`UPDATE zenithjoy.leadgen_videos v SET process_status=$4,harvest_batch=$5,updated_at=now()
    WHERE line_key=$1 AND video_id=$2 AND process_status=$3 AND harvest_batch=$6 AND judgment_status='pending'
    AND judgment_config IS NULL AND transcript IS NULL AND judgment_reason IS NULL RETURNING to_jsonb(v) AS video`,
   ['jinuo',input.video_id,SCOPE.source_status,SCOPE.target_status,SCOPE.original_101_run,SCOPE.original_102_run])).rows;
  if(changed.length!==1)fail('CAS_CONFLICT');
  const detail={decision_id:input.decision_id,video_id:input.video_id,scope_sha256:digest(SCOPE),maintenance_task_id:input.maintenance_task_id,
   original_101_run:SCOPE.original_101_run,original_102_run:SCOPE.original_102_run,
   before_sha256:digest(before),after_sha256:digest(changed[0].video),authority_sha256:a.evidence_sha256,
   guard_sha256:evidence};
  await c.query('INSERT INTO zenithjoy.db_audit(id,org_id,member_id,action,detail) VALUES($1,$2,$3,$4,$5::jsonb)',
   [id,SCOPE.tenant_id,'codex:qualification-recovery-102n','leadgen_102n_qualification_recovery',JSON.stringify(detail)]);
  await checkGuard(guard,input);commitStarted=true;await c.query('COMMIT');committed=true;
  return {status:'applied',video_id:input.video_id,intent_id:id,receipt_sha256:digest(detail)};
 }catch(e){failure=e;if(commitStarted&&!committed){destroy=true;const x=Error('RECOVERY_102N_COMMIT_UNKNOWN_READBACK_REQUIRED');x.code='RECOVERY_102N_COMMIT_UNKNOWN';failure=x;throw x;}
  try{if(c)await c.query('ROLLBACK');}catch{destroy=true;e.rollback_code='RECOVERY_102N_ROLLBACK_UNKNOWN';}throw e;
 }finally{c?.release(destroy);try{await guard.release();}catch{if(failure)failure.cleanup_code='RECOVERY_102N_GUARD_RELEASE_UNKNOWN';else fail('GUARD_RELEASE_UNKNOWN');}}
}
async function recoverBatch(pool,input,dep){
 validateBatch(input);const results=[];
 for(const video_id of SCOPE.video_ids){
  const one={...input,op:'recover_102n_qualification',video_id,run:runFor(video_id)};
  try{results.push(await recover(pool,one,dep));}
  catch(e){const code=e?.code||e?.message||'UNKNOWN';
   if(code==='RECOVERY_102N_COMMIT_UNKNOWN'){results.push({video_id,status:'commit_unknown'});break;}
   if(code.includes('UNKNOWN')||e?.cleanup_code){results.push({video_id,status:'unknown',reason:code});break;}
   results.push({video_id,status:'blocked',reason:code});
  }
 }
 return planBatch(SCOPE.video_ids,results);
}
module.exports={SCOPE,runFor,validateRequest,planBatch,intentId,readback,recover,recoverBatch,digest};
