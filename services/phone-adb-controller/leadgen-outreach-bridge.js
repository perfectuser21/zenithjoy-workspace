"use strict";
// 标人事务保存桥接意图；没有原生主页证明的旧数据保守unknown，不能以等级冒资格。
const crypto=require('node:crypto');
async function enqueueBridge(client,{lineKey,run,sourceRun,comment,lead,config},deps={}){
 if(!lead?.id||!comment?.id||comment.line_key!==lineKey)throw Error('BRIDGE_IDENTITY_INVALID');
 const qualification=await (deps.qualifyRecipient||require('./judge-recipient.js').qualifyRecipient)(comment,config);
 if(!['passed','excluded','unknown'].includes(qualification?.status))throw Error('BRIDGE_QUALIFICATION_INVALID');
 const intent={version:1,line_key:lineKey,run,source_run:sourceRun,comment_id:comment.id,lead_id:lead.id,
   target_douyin_id:comment.douyin_id,nickname:comment.nickname,comment_body:comment.comment_body,
   profile_url:comment.profile_url,source_video:comment.source_video,source_video_url:comment.source_video_url,
   intent_grade:comment.intent_grade,judgment_reason:comment.judgment_reason,recipient_evidence:comment.recipient_evidence||null,qualification};
 const payload=JSON.stringify(intent),sha=crypto.createHash('sha256').update(payload).digest('hex');
 await client.query(`INSERT INTO zenithjoy.leadgen_bridge_outbox(line_key,comment_id,lead_id,run_tag,source_run,payload,payload_sha256,qualification_status)
  VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT(line_key,comment_id) DO NOTHING`,
 [lineKey,comment.id,lead.id,run,sourceRun,payload,sha,qualification.status]);
 return intent;
}
module.exports={enqueueBridge};
