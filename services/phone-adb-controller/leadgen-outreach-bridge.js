"use strict";
// 标人事务保存桥接意图；没有原生主页证明的旧数据保守unknown，不能以等级冒资格。
const crypto=require('node:crypto');
async function enqueueBridge(client,{lineKey,run,sourceRun,comment,lead,config},deps={}){
 if(!lead?.id||!comment?.id||comment.line_key!==lineKey)throw Error('BRIDGE_IDENTITY_INVALID');
 const mapped=(await client.query('SELECT id,line_key,douyin_id FROM zenithjoy.leadgen_leads WHERE line_key=$1 AND id=$2',[lineKey,lead.id])).rows;
 const leadIdentity=mapped.length===1?mapped[0]:null;
 let qualification=await (deps.qualifyRecipient||require('./judge-recipient.js').qualifyRecipient)(comment,config);
 if(!['passed','excluded','unknown'].includes(qualification?.status))throw Error('BRIDGE_QUALIFICATION_INVALID');
 if(qualification.status==='passed'&&(!leadIdentity||leadIdentity.id!==lead.id||leadIdentity.line_key!==lineKey||leadIdentity.douyin_id!==comment.douyin_id))qualification={...qualification,status:'unknown',reason:'lead_identity_mapping_unverified'};
 const intent={version:1,line_key:lineKey,run,source_run:sourceRun,comment_run:comment.harvest_batch,comment_id:comment.id,lead_id:lead.id,lead_identity:leadIdentity,
   target_douyin_id:comment.douyin_id,nickname:comment.nickname,comment_body:comment.comment_body,
   profile_url:comment.profile_url,source_video:comment.source_video,source_video_url:comment.source_video_url,
   intent_grade:comment.intent_grade,judgment_reason:comment.judgment_reason,profile_ip:comment.profile_ip,region:comment.region,comment_time:comment.comment_time,recipient_evidence:comment.recipient_evidence||null,qualification};
 const payload=JSON.stringify(intent),sha=crypto.createHash('sha256').update(payload).digest('hex');
 await client.query(`INSERT INTO zenithjoy.leadgen_bridge_outbox(line_key,comment_id,lead_id,run_tag,source_run,payload,payload_sha256,qualification_status)
  VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT(line_key,comment_id) DO NOTHING`,
 [lineKey,comment.id,lead.id,run,sourceRun,payload,sha,qualification.status]);
 return intent;
}
module.exports={enqueueBridge};
const {routeOf}=require('./line-routes.js');
const {buildLeadCoreFields}=require('./lead-fields-lib.js');
const {txt}=require('./next-outreach-lib.js');
const evidence=require('./queued-recipient-evidence.js');
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function bridgeMarker(row){return `[103 bridge:${row.id}:${row.payload_sha256}]`;}
function nativeIntent(row){
 const p=row.payload;
 if(!p||row.line_key!==p.line_key||digest(p)!==row.payload_sha256||p.qualification?.status!=='passed'||row.qualification_status!=='passed')throw Error('BRIDGE_INTENT_INVALID');
 if(!p.lead_identity||p.lead_identity.id!==p.lead_id||p.lead_identity.line_key!==p.line_key||p.lead_identity.douyin_id!==p.target_douyin_id)throw Error('BRIDGE_LEAD_IDENTITY_INVALID');
 if(!p.profile_url||!/^https:\/\/(?:www|v)\.douyin\.com\/[A-Za-z0-9._/-]+$/.test(p.profile_url))throw Error('BRIDGE_PROFILE_LINK_MISSING');
 evidence.validateEvidence(p.recipient_evidence,{line_key:p.line_key,run:p.comment_run,douyin_id:p.target_douyin_id,nickname:p.nickname,comment_body:p.comment_body,comment_body_sha256:evidence.hash(p.comment_body),video_url:p.source_video_url});
 return p;
}
function fieldsMatch(row,record){
 const expected=row.fields;if(!expected||digest(expected)!==row.fields_sha256||!record?.fields||txt(record.fields['合规核验状态'])!==bridgeMarker(row)||txt(record.fields['抖音号']).toLowerCase()!==String(row.payload.target_douyin_id).toLowerCase())return false;
 return Object.entries(expected).every(([k,v])=>txt(record.fields[k])===String(v));
}
function buildOrderFields(row,route,types){
 const p=nativeIntent(row),created=Date.parse(row.created_at);
 if(!Number.isFinite(created)||!types.some(t=>t.field_name==='采集时间'))throw Error('BRIDGE_FIELD_TYPES_MISSING');
 const time=types.find(t=>t.field_name==='采集时间').type===5?created:new Date(created+8*3600e3).toISOString().replace('T',' ').slice(0,16);
 return {'抖音获客-线索表':p.nickname,...buildLeadCoreFields({nick:p.nickname,dyid:p.target_douyin_id,purl:p.profile_url,comment:p.comment_body,video:p.source_video,vurl:p.source_video_url}),
 'IP属地':p.profile_ip||p.region||'','留言时间':p.comment_time||'','业务线':route.line,'关键词层级':route.tier||'','搜索意图':route.intent||'','目标人群':route.audience||'',
 'AI判断理由':`[${p.intent_grade}级] `+(p.judgment_reason||''),'状态':'待触达','发送状态':'未发送','搜索账号':'池转入(自动判定)','采集时间':time,'合规核验状态':bridgeMarker(row)};
}
async function bridgeOutreach(pool,input,{client,lock,freezeCompanyConfig}={}){
 const deadlineAt=Date.now()+Math.max(1,Math.min(165000,Number(input.remaining_ms)||165000));
 const route=routeOf(input.line),outreach=require('./leadgen-outreach-orders.js');
 return (lock||outreach.withOrderLock)(route.key,async()=>{
  const snapshot=await (freezeCompanyConfig||require('./company-config-lib.js').freezeCompanyConfig)(pool,{lineHint:route.key,runId:input.run,sourceRun:input.source_run,step:'103'});
  const result={published:0,protected:0,excluded:0,unknown:0,ids:[],verified:true};
  const rows=(await pool.query(`SELECT * FROM zenithjoy.leadgen_bridge_outbox WHERE line_key=$1 AND state IN ('pending','attempted','unknown') ORDER BY created_at,id LIMIT $2`,[route.key,Math.max(1,Math.min(50,Number(input.limit)||10))])).rows;
  let api=client;
  for(const row of rows){if(Date.now()>=deadlineAt){result.verified=false;result.unknown++;break;}result.ids.push(row.id);
   if(row.qualification_status!=='passed'){
    const excluded=row.qualification_status==='excluded';await pool.query('UPDATE zenithjoy.leadgen_bridge_outbox SET state=$3,updated_at=now() WHERE line_key=$1 AND id=$2',[route.key,row.id,excluded?'excluded':'unknown']);
    result[excluded?'excluded':'unknown']++;continue;
   }
   try{const p=nativeIntent(row);if(p.qualification.company_id!==snapshot.company_id||String(p.qualification.company_version)!==String(snapshot.version))throw Error('BRIDGE_POLICY_STALE');}catch{result.unknown++;result.verified=false;continue;}
   if(!api)api=await outreach.orderClient(route,{deadlineAt});
   let all;try{all=await api.all({deadlineAt});}catch{result.unknown++;result.verified=false;continue;}
   const found=all.filter(r=>txt(r.fields?.['合规核验状态'])===bridgeMarker(row));
   if(found.length){
    if(found.length===1&&fieldsMatch(row,found[0])){await pool.query("UPDATE zenithjoy.leadgen_bridge_outbox SET state='confirmed',feishu_record_id=$3,updated_at=now() WHERE line_key=$1 AND id=$2",[route.key,row.id,found[0].record_id]);result.published++;}
    else {result.unknown++;result.verified=false;}continue;
   }
   // 已attempted，无论GET未找到或POST返回如何，永不第二次POST。
   if(row.state==='attempted'||row.attempted_at){result.unknown++;result.verified=false;continue;}
   const duplicates=all.filter(r=>txt(r.fields?.['抖音号']).trim().toLowerCase()===String(row.payload.target_douyin_id).toLowerCase()||txt(r.fields?.['抖音昵称'])===row.payload.nickname);
   if(duplicates.length){await pool.query("UPDATE zenithjoy.leadgen_bridge_outbox SET state='protected',feishu_record_id=$3,updated_at=now() WHERE line_key=$1 AND id=$2",[route.key,row.id,duplicates[0].record_id]);result.protected++;continue;}
   let fields;try{fields=buildOrderFields(row,route,await api.fields());}catch{result.unknown++;result.verified=false;continue;}
   if(Date.now()>=deadlineAt){result.unknown++;result.verified=false;break;}
   const stored=await pool.query("UPDATE zenithjoy.leadgen_bridge_outbox SET state='attempted',fields=$3::jsonb,fields_sha256=$4,attempted_at=now(),updated_at=now() WHERE line_key=$1 AND id=$2 AND state IN ('pending','unknown') AND attempted_at IS NULL RETURNING *",[route.key,row.id,JSON.stringify(fields),digest(fields)]);
   if(stored.rowCount!==1)throw Error('BRIDGE_ATTEMPT_NOT_PERSISTED');
   row.fields=fields;row.fields_sha256=digest(fields);row.state='attempted';
   try{await api.post(fields);}catch{await pool.query('UPDATE zenithjoy.leadgen_bridge_outbox SET last_error=$3,updated_at=now() WHERE line_key=$1 AND id=$2',[route.key,row.id,'post_outcome_unknown']);}
   let back;try{back=(await api.all({deadlineAt})).filter(r=>txt(r.fields?.['合规核验状态'])===bridgeMarker(row));}catch{back=[];}
   if(back.length===1&&fieldsMatch(row,back[0])){await pool.query("UPDATE zenithjoy.leadgen_bridge_outbox SET state='confirmed',feishu_record_id=$3,updated_at=now() WHERE line_key=$1 AND id=$2",[route.key,row.id,back[0].record_id]);result.published++;}
   else{result.unknown++;result.verified=false;}
  }
  return result;
 });
}
module.exports={enqueueBridge,bridgeOutreach,bridgeMarker,nativeIntent,fieldsMatch,buildOrderFields};
async function eligibleOrders(route,all,input,{pool,freezeCompanyConfig}={}){
 if(!pool)throw Error('BRIDGE_PG_AUTHORITY_MISSING');
 {
  const snapshot=await (freezeCompanyConfig||require('./company-config-lib.js').freezeCompanyConfig)(pool,{lineHint:route.key,runId:input.run,step:'104'});
  const ids=all.map(r=>r.record_id);if(ids.length>3000)throw Error('BRIDGE_ORDER_SCOPE_EXCEEDED');
  const rows=ids.length?(await pool.query("SELECT * FROM zenithjoy.leadgen_bridge_outbox WHERE line_key=$1 AND state='confirmed' AND qualification_status='passed' AND feishu_record_id=ANY($2::text[])",[route.key,ids])).rows:[];
  const allowed=[];
  for(const row of rows){try{
   const p=nativeIntent(row);if(p.qualification.company_id!==snapshot.company_id||String(p.qualification.company_version)!==String(snapshot.version))continue;
   if(!row.fields||digest(row.fields)!==row.fields_sha256)continue;
   const found=all.filter(r=>r.record_id===row.feishu_record_id);if(found.length===1&&fieldsMatch(row,found[0]))allowed.push(row.feishu_record_id);
  }catch{/* 旧/错scope/缺native证明均不ready，不改原记录。 */}}
  return allowed;
 }
}
module.exports.eligibleOrders=eligibleOrders;

async function readbackBridge(pool,input){
 const route=routeOf(input.line),ids=input.ids;
 if(!Array.isArray(ids)||ids.length>50||new Set(ids).size!==ids.length||ids.some(id=>!/^[-a-zA-Z0-9]{1,80}$/.test(id)))throw Error('BRIDGE_READBACK_IDS_INVALID');
 const rows=ids.length?(await pool.query('SELECT * FROM zenithjoy.leadgen_bridge_outbox WHERE line_key=$1 AND id=ANY($2::uuid[])',[route.key,ids])).rows:[];
 const failures=ids.filter(id=>{const found=rows.filter(r=>r.id===id);if(found.length!==1)return true;const row=found[0],p=row.payload;
  if(!p||row.line_key!==route.key||p.line_key!==route.key||digest(p)!==row.payload_sha256||!['confirmed','protected','excluded','unknown'].includes(row.state)||p.qualification?.status!==row.qualification_status)return true;
  if(row.state==='confirmed'){try{nativeIntent(row);}catch{return true;}if(!/^rec[A-Za-z0-9]{6,40}$/.test(row.feishu_record_id||'')||!row.fields||digest(row.fields)!==row.fields_sha256)return true;}
  if(row.state==='excluded'&&row.qualification_status!=='excluded')return true;
  return false;
 }).length;
 return {verified:failures===0,failures,ids,states:Object.fromEntries(rows.map(r=>[r.id,r.state]))};
}
module.exports.readbackBridge=readbackBridge;
