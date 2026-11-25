'use strict';
// Explicit operations command. It recovers one existing outbox before any delivery attempt.
const {routeOf}=require('../services/phone-adb-controller/line-routes.js');
const {digest,nativeIntent}=require('../services/phone-adb-controller/leadgen-outreach-bridge.js');

async function revalidateBridge(pool,input,{lock,freezeCompanyConfig,qualifyRecipient}={}){
 const {outbox_id:id,comment_id:commentId,run,source_run:sourceRun}=input;
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const runKey=/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
 const need=(condition,reason)=>{if(!condition)throw Error('BRIDGE_REVALIDATION_'+reason);};
 need([id,commentId].every(v=>typeof v==='string'&&uuid.test(v))&&
   [run,sourceRun].every(v=>typeof v==='string'&&runKey.test(v)),'SCOPE_INVALID');
 const {key:lineKey}=routeOf(input.line),outreach=require('../services/phone-adb-controller/leadgen-outreach-orders.js');
 return (lock||outreach.withOrderLock)(lineKey,async()=>{
  const [row]= (await pool.query(`SELECT * FROM zenithjoy.leadgen_bridge_outbox
    WHERE line_key=$1 AND id=$2 AND comment_id=$3 AND run_tag=$4 AND source_run=$5`,
    [lineKey,id,commentId,run,sourceRun])).rows;
  const p=row?.payload;
  need(row?.id===id&&row.comment_id===commentId&&row.run_tag===run&&row.state==='unknown'&&
    row.qualification_status==='unknown'&&row.attempted_at===null&&row.feishu_record_id===null&&
    row.fields===null&&row.fields_sha256===null&&row.last_error===null&&p?.version===1&&
    p.qualification?.status==='unknown'&&p.qualification.reason==='native_profile_proof_missing_or_invalid'&&
    p.qualification.model_call_count===0&&row.source_run===sourceRun&&p.source_run===sourceRun&&p.comment_run===sourceRun&&
    p.comment_id===commentId&&p.lead_id===row.lead_id&&p.lead_identity&&
    p.recipient_evidence?.status==='verified'&&digest(p)===row.payload_sha256,'ORIGINAL_CHANGED');
  const [comment]=(await pool.query('SELECT *,updated_at::text AS recovery_updated_at FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND id=$2',[lineKey,commentId])).rows;
  const [lead]=(await pool.query('SELECT id,line_key,douyin_id FROM zenithjoy.leadgen_leads WHERE line_key=$1 AND id=$2',[lineKey,row.lead_id])).rows;
  need(comment?.id===commentId&&comment.line_key===lineKey&&comment.process_status==='已分拣'&&comment.relevance==='相关'&&
    comment.harvest_batch===sourceRun&&comment.judgment_config?.run_id===p.scoring_run&&
    comment.recipient_evidence?.status==='verified'&&typeof comment.recovery_updated_at==='string'&&
    comment.douyin_id===p.target_douyin_id&&lead?.id===row.lead_id&&lead.line_key===lineKey&&
    lead.douyin_id===comment.douyin_id&&digest(lead)===digest(p.lead_identity)&&
    digest(comment.recipient_evidence)===digest(p.recipient_evidence)&&
    ['nickname','comment_body','profile_url','source_video','source_video_url','intent_grade','judgment_reason']
      .every(key=>comment[key]===p[key])&&new Date(comment.collected_at).getTime()===new Date(p.collected_at).getTime(),'IDENTITY_CHANGED');
  const freeze=freezeCompanyConfig||require('../services/phone-adb-controller/company-config-lib.js').freezeCompanyConfig;
  const snapshot=await freeze(pool,{lineHint:lineKey,runId:run,sourceRun,step:'103'});
  const companyBinding=p.recipient_evidence.company_binding===undefined?undefined:
    await require('../services/phone-adb-controller/company-config-lib.js').readCollectionAccountBinding(pool,{
      lineKey,run:sourceRun,sourceRun:p.recipient_evidence.scope?.source_run});
  const qualify=qualifyRecipient||require('../services/phone-adb-controller/judge-recipient.js').qualifyRecipientFromScore;
  const qualification=await qualify(comment,snapshot,{companyBinding});
  const candidate={...p,qualification};
  need(qualification?.status==='passed'&&qualification.model_call_count===0&&
    qualification.company_id===snapshot.company_id&&qualification.tenant_id===snapshot.tenant_id&&
    String(qualification.company_version)===String(snapshot.version)&&
    qualification.policy_id===(snapshot.policy_id||snapshot.runtime_config?.policy_id),'EVIDENCE_NOT_VERIFIED');
  const payloadDigest=digest(candidate);
  try{nativeIntent({...row,payload:candidate,payload_sha256:payloadDigest,qualification_status:'passed'},{companyBinding});}
  catch{throw Error('BRIDGE_REVALIDATION_EVIDENCE_NOT_VERIFIED');}
  // Recheck durable identities and no-attempt state atomically before exposing the original outbox again.
  const saved=await pool.query(`UPDATE zenithjoy.leadgen_bridge_outbox SET
    state='pending',qualification_status='passed',payload=$5::jsonb,payload_sha256=$6,updated_at=now()
    WHERE line_key=$1 AND id=$2 AND comment_id=$3 AND payload_sha256=$4 AND run_tag=$7 AND source_run=$8
      AND state='unknown' AND qualification_status='unknown' AND attempted_at IS NULL
      AND feishu_record_id IS NULL AND fields IS NULL AND fields_sha256 IS NULL AND last_error IS NULL
      AND EXISTS (SELECT 1 FROM zenithjoy.leadgen_comments c WHERE c.id=$3 AND c.line_key=$1
        AND c.updated_at=$9 AND c.process_status='已分拣')
      AND EXISTS (SELECT 1 FROM zenithjoy.leadgen_leads l WHERE l.id=$10 AND l.line_key=$1 AND l.douyin_id=$11)
    RETURNING id,state,qualification_status,payload,payload_sha256`,
    [lineKey,id,commentId,row.payload_sha256,JSON.stringify(candidate),payloadDigest,run,sourceRun,
      comment.recovery_updated_at,row.lead_id,comment.douyin_id]);
  const actual=saved.rows[0];
  need(saved.rows.length===1&&actual.id===id&&actual.state==='pending'&&actual.qualification_status==='passed'&&
    actual.payload_sha256===payloadDigest&&digest(actual.payload)===payloadDigest,'WRITE_NOT_CONFIRMED');
  return {verified:true,id,comment_id:commentId,state:actual.state,qualification_status:actual.qualification_status};
 });
}
async function main(){
 let pool;
 try{
  const input=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
  pool=require('../services/phone-adb-controller/leadgen-db-connect.js').getPool();
  const result=await revalidateBridge(pool,input);
  process.stdout.write(JSON.stringify({ok:true,result})+'\n');
 }catch(error){
  const code=/^BRIDGE_REVALIDATION_[A-Z_]+$/.test(error?.message)?error.message:'BRIDGE_REVALIDATION_FAILED';
  process.stdout.write(JSON.stringify({ok:false,code})+'\n');
  process.exitCode=1;
 }finally{if(pool)await pool.end();}
}
if(require.main===module)main();
module.exports={revalidateBridge};
