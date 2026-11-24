// Execution state only. No model, phone, business verdict or new schema.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const need=(v,c)=>{if(!v)throw Error(c);};
const text=v=>Array.isArray(v)?v.map(x=>x.text||'').join(''):(v?.name??String(v??''));
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const hash=v=>createHash('sha256').update(v).digest('hex');
// Same JSONB normalization/key order as leadgen-outreach-bridge.digest, distinct from action journals.
const bridgeCanonical=v=>Array.isArray(v)?v.map(bridgeCanonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,bridgeCanonical(v[k])])):v;
const bridgeHash=v=>hash(JSON.stringify(bridgeCanonical(JSON.parse(JSON.stringify(v)))));
const equal=(row,fields)=>Object.entries(fields).every(([k,v])=>text(row.fields?.[k])===String(v));

/** Caller holds the original order/process locks and has checked exact Task authority. */
export async function releaseOwnClaim({api,row,journal:j,claimFields,artifactDir,saveJournal,authorize,identity,stable}){
 need(j&&j.reserved_budget===0&&!j.terminal_fields&&!j.terminal_outcome,'RELEASE_PROTECTED');
 need(!['send-input.json','phone-invocation.json'].some(n=>fs.existsSync(path.join(artifactDir,n))),'RELEASE_PROTECTED');
 need(identity(row)&&stable(row),'RELEASE_IDENTITY');
 const fields={'状态':'待触达','回复结果':'[104 清场释放未准备订单:'+j.scope.run_tag+']'};
 const released={...claimFields,...fields};
 if(j.phase==='released'){
  need(!j.pending_write&&equal(row,released),'RELEASE_READBACK_CHANGED');
  return {status:'released',record:row,replayed:true};
 }
 if(j.phase==='release_intent'){
  need(canonical(j.pending_write?.fields)===canonical(fields)&&j.pending_write?.phase==='released','RELEASE_JOURNAL');
  if(!equal(row,released))return {status:'unknown',record:row,reason:'RELEASE_PUT_UNCONFIRMED'};
  j.phase='released';delete j.pending_write;saveJournal();return {status:'released',record:row,replayed:true};
 }
 // A lost claim response can be reconciled from this exact original row, never a prepare intent.
 if(j.phase==='claimed_intent'){
  need(j.pending_write?.phase==='claimed'&&canonical(j.pending_write.fields)===canonical(claimFields)&&equal(row,claimFields),'RELEASE_CLAIM_UNCONFIRMED');
  j.phase='claimed';delete j.pending_write;saveJournal();
 }
 need(j.phase==='claimed'&&!j.pending_write&&equal(row,claimFields),'RELEASE_NOT_OWN_CLAIM');
 j.phase='release_intent';j.pending_write={fields,phase:'released'};saveJournal();
 await authorize('release');
 try{await api.put(row.record_id,fields);}catch{/* A failed response is not proof of a failed write. */}
 let back;try{back=await api.get(row.record_id);}catch{return {status:'unknown',reason:'RELEASE_GET_UNCONFIRMED'};}
 if(!identity(back)||!stable(back)||!equal(back,released))return {status:'unknown',record:back,reason:'RELEASE_PUT_UNCONFIRMED'};
 j.phase='released';delete j.pending_write;saveJournal();return {status:'released',record:back};
}

function scopeOf(c,s){
 const t=c?.tasks?.['104'];
 need(t?.task_id&&t.run_id&&t.run_tag&&c.company_id&&c.tenant_id&&c.line&&c.sender_id,'LEAD_SCOPE');
 for(const k of ['record_id','comment_id','lead_id','target_douyin_id','profile_url','source_102_run','source_103_run'])need(typeof s?.[k]==='string'&&s[k],'LEAD_SCOPE');
 need(canonical(s)===canonical(c.verification?.['104']),'LEAD_SCOPE_CHANGED');return t;
}
async function originalRows(db,c,s,{lock=false,directRecord}={}){
 scopeOf(c,s);
 const identity=(await db.query('SELECT current_database() AS db')).rows[0];need(identity?.db==='zenithjoy','LEAD_DATABASE');
 const profiles=(await db.query('SELECT company_id,tenant_id,config_version,runtime_config FROM zenithjoy.tenant_company_profiles WHERE company_id=$1',[c.company_id])).rows;
 need(profiles.length===1&&profiles[0].tenant_id===c.tenant_id&&Number(profiles[0].config_version)===c.verification.policy_version&&profiles[0].runtime_config?.policy_id===c.verification.policy_id,'LEAD_COMPANY_SCOPE');
 const outboxes=(await db.query("SELECT * FROM zenithjoy.leadgen_bridge_outbox WHERE line_key=$1 AND comment_id=$2 AND lead_id=$3 AND feishu_record_id=$4 AND state='confirmed' AND qualification_status='passed'"+(lock?' FOR SHARE':''),[c.line,s.comment_id,s.lead_id,s.record_id])).rows;
 need(outboxes.length===1,'LEAD_OUTBOX_UNIQUE');const o=outboxes[0],p=o.payload,q=p?.qualification;
 need(bridgeHash(p)===o.payload_sha256&&p.line_key===c.line&&p.lead_id===s.lead_id&&p.comment_id===s.comment_id&&p.target_douyin_id===s.target_douyin_id&&p.profile_url===s.profile_url&&p.comment_run===s.source_102_run&&p.scoring_run===s.source_103_run,'LEAD_OUTBOX_SCOPE');
 need(o.line_key===c.line&&o.comment_id===s.comment_id&&o.lead_id===s.lead_id&&o.feishu_record_id===s.record_id&&o.state==='confirmed'&&o.qualification_status==='passed'&&typeof p.run==='string'&&p.run.length>0&&o.run_tag===p.run&&o.source_run===p.source_run,'LEAD_OUTBOX_LINEAGE');
 const exactSource=p.source_run===s.source_102_run;
 const partialSource=p.source_run===null&&Array.isArray(p.committed_partial_ids)&&p.committed_partial_ids.length===1&&p.committed_partial_ids[0]===s.comment_id;
 need(exactSource||partialSource,'LEAD_OUTBOX_LINEAGE');
 if(directRecord){
  need(o.fields&&Object.keys(o.fields).length>0&&o.fields_sha256===bridgeHash(o.fields),'LEAD_ORDER_SOURCE_FIELDS');
  const stable=Object.fromEntries(Object.entries(o.fields).filter(([key])=>!['状态','发送状态'].includes(key)));
  need(equal(directRecord,stable)&&text(directRecord.fields?.['合规核验状态'])===`[103 bridge:${o.id}:${o.payload_sha256}]`,'LEAD_ORDER_SOURCE_FIELDS');
 }
 need(p.lead_identity?.id===s.lead_id&&p.lead_identity.line_key===c.line&&p.lead_identity.douyin_id===s.target_douyin_id,'LEAD_OUTBOX_LEAD_IDENTITY');
 need(q?.status==='passed'&&q.company_id===c.company_id&&q.tenant_id===c.tenant_id&&Number(q.company_version)===c.verification.policy_version&&q.policy_id===c.verification.policy_id,'LEAD_OUTBOX_COMPANY');
 const rows=(await db.query('SELECT id,line_key,douyin_id,profile_url,status,send_status,reached_at,script_version,feishu_record_id FROM zenithjoy.leadgen_leads WHERE id=$1 AND line_key=$2'+(lock?' FOR UPDATE':''),[s.lead_id,c.line])).rows;
 need(rows.length===1,'LEAD_ROW_UNIQUE');const lead=rows[0];
 need(lead.douyin_id===s.target_douyin_id&&lead.profile_url===s.profile_url&&(!lead.feishu_record_id||lead.feishu_record_id===s.record_id),'LEAD_ROW_IDENTITY');
 return {lead,source:{company_id:c.company_id,tenant_id:c.tenant_id,outbox_id:o.id,comment_id:s.comment_id,record_id:s.record_id,source_102_run:s.source_102_run,source_103_run:s.source_103_run,payload_sha256:o.payload_sha256}};
}
/** Read-only provider: raw fields and provenance; no business passed/verified decision. */
export async function readLeadResult({pool,context:c,scope:s}){
 const db=await pool.connect();try{await db.query('BEGIN READ ONLY');await db.query("SET LOCAL statement_timeout='10000ms'");const result=await originalRows(db,c,s);await db.query('ROLLBACK');return result;}catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
function terminalFields(c,s,j,row,native){
 const t=scopeOf(c,s),outcome=j?.terminal_outcome;
 need(['sent','restricted','rate_limited'].includes(outcome)&&native?.source_verified===true&&native.outcome===outcome,'LEAD_NATIVE_TERMINAL');
 need(j.scope?.task_id===t.task_id&&j.scope?.run_id===t.run_id&&j.scope?.run_tag===t.run_tag&&j.scope?.company_id===c.company_id&&j.scope?.tenant_id===c.tenant_id&&j.scope?.record_id===s.record_id&&j.scope?.comment_id===s.comment_id&&j.scope?.target_douyin_id===s.target_douyin_id,'LEAD_ACTION_SCOPE');
 need(j.scope.source===(c.marker_source||c.source_commit)&&j.scope.line===c.line&&j.scope.profile===c.profile&&j.scope.serial===c.serial&&j.scope.sender_id===c.sender_id&&j.scope.profile_url===s.profile_url&&j.action_key===hash(canonical(j.scope)),'LEAD_ACTION_SCOPE');
 need(row?.record_id===s.record_id&&j.terminal_fields&&equal(row,j.terminal_fields),'LEAD_ORDER_TERMINAL');
 const f=row.fields,at=typeof f['触达时间']==='number'?f['触达时间']:Date.parse(text(f['触达时间']));
 need(Number.isSafeInteger(native.sent_at_ms)&&at===native.sent_at_ms&&at>0,'LEAD_CONTACT_TIME');
 need(text(f['实际分发号'])===`${c.profile}(${c.sender_id})`&&text(f['话术ID'])==='task-'+t.task_id&&text(f['话术版本'])==='task-authorized','LEAD_SENDER_SCRIPT');
 need(hash(text(f['话术内容']))===j.scope.message_sha256&&text(f['抖音号'])===s.target_douyin_id&&text(f['主页链接'])===s.profile_url,'LEAD_ORDER_SCOPE');
 need(text(f['回复结果']).startsWith(`[104 ${outcome}:${t.run_tag}:${j.scope.source}] ${j.scope.message_sha256} `),'LEAD_ORDER_MARKER');
 const status=outcome==='sent'?'已触达':'触达受阻',send_status=outcome==='sent'?'已发送':'发送失败';
 need(text(f['状态'])===status&&text(f['发送状态'])===send_status,'LEAD_RESULT_FIELDS');
 return {status,send_status,reached_at:new Date(at).toISOString(),script_version:text(f['话术版本']),feishu_record_id:s.record_id};
}
const same=(lead,f)=>Object.entries(f).every(([k,v])=>k==='reached_at'?lead[k]!=null&&new Date(lead[k]).toISOString()===v:lead[k]===v);
/** Original write_back operation calls this only after its terminal original-order GET. */
export async function syncLeadResult({pool,context:c,scope:s,journal,record,native}){
 return persistLeadResult({pool,context:c,scope:s,record,fields:terminalFields(c,s,journal,record,native)});
}

async function persistLeadResult({pool,context:c,scope:s,record,fields,directRecord,dryRun=false}){
 const db=await pool.connect();let released=false;
 try{
  await db.query(dryRun?'BEGIN READ ONLY':'BEGIN');await db.query("SET LOCAL statement_timeout='10000ms'");await db.query("SET LOCAL lock_timeout='5000ms'");
  const before=await originalRows(db,c,s,{lock:!dryRun,directRecord});let changed=false;
  if(!same(before.lead,fields)){
   need(before.lead.status==='待触达'&&before.lead.send_status==='未发送'&&before.lead.reached_at==null&&before.lead.script_version==null,'LEAD_RESULT_CONFLICT');
   if(dryRun){await db.query('ROLLBACK');return {...before,changed:false};}
   const r=await db.query('UPDATE zenithjoy.leadgen_leads SET status=$3,send_status=$4,reached_at=$5,script_version=$6,feishu_record_id=$7,updated_at=now() WHERE id=$1 AND line_key=$2 RETURNING id',[s.lead_id,c.line,fields.status,fields.send_status,fields.reached_at,fields.script_version,fields.feishu_record_id]);
   need(r.rowCount===1,'LEAD_UPDATE_COUNT');changed=true;
  }
  if(dryRun){await db.query('ROLLBACK');return {...before,changed:false};}
  await db.query('COMMIT');
  db.release();released=true;
  // Independent committed read: a lost COMMIT response throws, never causes a blind second write.
  const result=await readLeadResult({pool,context:c,scope:s});need(same(result.lead,fields),'LEAD_COMMITTED_READBACK');
  return {...result,changed,order_fields:{sender_id:c.sender_id,sender_account_label:text(record.fields['实际分发号']),script_id:text(record.fields['话术ID']),script_version:text(record.fields['话术版本'])},delivery_verified:false};
 }catch(e){if(!released)await db.query('ROLLBACK').catch(()=>{});throw e;}finally{if(!released)db.release();}
}


/** Replay only a completed direct-send Task and an independently retrieved terminal order. */
export async function recoverDirectSentLead({pool,context:c,scope:s,record,originalTask,decisionId,messageSha256,dryRun=false}){
 const task=scopeOf(c,s),result=originalTask?.result,detail=result?.status_detail,order=detail?.order;
 need(originalTask?.id===task.task_id&&task.run_id===task.task_id&&originalTask.status==='completed'&&result?.actor==='codex','DIRECT_TASK_AUTHORITY');
 need(detail?.send_outcome==='sent'&&detail.native_command_calls===1&&detail.prepared_observed===true&&detail.delivery_verified===false,'DIRECT_SEND_RECEIPT');
 need(order?.order_id===s.record_id&&order.marker==='sent'&&order.own_marker===true&&order.order_status==='已触达'&&order.send_status==='已发送'&&Number.isSafeInteger(order.timestamp)&&order.timestamp>0,'DIRECT_TASK_ORDER');
 const f=record?.fields;
 need(record?.record_id===s.record_id&&f&&text(f['状态'])==='已触达'&&text(f['发送状态'])==='已发送'&&f['触达时间']===order.timestamp,'DIRECT_TERMINAL_ORDER');
 need(text(f['实际分发号'])===`${c.profile}(${c.sender_id})`&&text(f['抖音号'])===s.target_douyin_id&&text(f['主页链接'])===s.profile_url,'DIRECT_ORDER_IDENTITY');
 need(typeof decisionId==='string'&&decisionId&&text(f['话术ID'])===`session-${decisionId}`&&text(f['话术版本'])==='task-authorized','DIRECT_ORDER_AUTHORIZATION');
 const marker=c.marker_source||c.source_commit;
 need(/^[a-f0-9]{64}$/.test(messageSha256)&&hash(text(f['话术内容']))===messageSha256&&text(f['回复结果'])===`[104 sent:${task.run_tag}:${marker}] ${messageSha256} 送达未证`,'DIRECT_ORDER_CONTENT');
 const fields={status:'已触达',send_status:'已发送',reached_at:new Date(order.timestamp).toISOString(),script_version:'task-authorized',feishu_record_id:s.record_id};
 return persistLeadResult({pool,context:c,scope:s,record,fields,directRecord:record,dryRun});
}
