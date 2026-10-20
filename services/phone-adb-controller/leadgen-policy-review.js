'use strict';
const {configTargetProfile}=require('./company-config-lib.js');
const {judgeCommander}=require('./judge-comment.js');
const crypto=require('node:crypto');
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// 只把冻结公司政策中的明示意向信号当作可核查的个人诉求依据。
// 模型的人群引用、同档位及视频话题不能凭空替评论补出诉求。
function explicitIntent(comment, audiences){
  return audiences.some(a=>String(a.fields?.['意向信号']||'').split(/[\/、，,；;\n]/)
    .map(s=>s.trim()).filter(s=>s.length>=2).some(signal=>comment.includes(signal)));
}

// 同一语义核验供只读原批复核与写入前准入复用；失败时只返回脱敏摘要。
async function evaluatePolicy(row,snapshot,{judgePolicy=async(body,video,profile,reason,opts)=>judgeCommander(body,video,profile,reason,opts)}={}){
  const config=row?.judgment_config;
  const base={id:row?.id,status:'unknown',reason:'binding_unverified'};
  if(!row||!config||config.company_id!==snapshot.company_id||config.tenant_id!==snapshot.tenant_id
    ||Number(config.version)!==Number(snapshot.version)||config.policy_id!==snapshot.policy_id
    ||!row.source_video||!row.source_video_url||!row.comment_body
    ||!['相关','不相关'].includes(row.relevance)
    ||row.relevance==='相关'&&!['A','B','C'].includes(row.intent_grade)
    ||row.relevance==='不相关'&&row.intent_grade!==null)return base;
  try{
    const verdict=await judgePolicy(row.comment_body,row.source_video,configTargetProfile(snapshot,'103'),'policy semantic verification',
      {scoringRules:snapshot.runtime_config.comment_scoring});
    const proof=verdict?.audit?.policy_evidence;
    const audience=snapshot.runtime_config.comment_scoring.audiences?.find(a=>a.id===proof?.audience_id);
    const fields=audience?.fields||{};
    if(!['A','B','C','不相关'].includes(verdict?.grade)||!verdict?.audit?.response_id||!verdict.audit.model||!proof||!audience||!proof.reason||proof.reason.length>500
      ||row.comment_body.length>=8&&proof.reason.includes(row.comment_body)
      ||!proof.matched_rule||proof.matched_rule.length>300
      ||!(String(fields['意向信号']||'').includes(proof.matched_rule)||String(fields['人群描述']||'').includes(proof.matched_rule))
      ||!(proof.exclusion_rule===null||typeof proof.exclusion_rule==='string'&&proof.exclusion_rule.trim()
        &&String(fields['排除信号']||'').includes(proof.exclusion_rule)))return {...base,reason:'policy_evidence_invalid'};
    const expected=row.relevance==='不相关'?'不相关':row.intent_grade;
    const contextualIntent=typeof proof.comment_signal==='string'&&proof.comment_signal.length>=3&&proof.comment_signal.length<=100
      &&row.comment_body.includes(proof.comment_signal)&&/[?？]/.test(proof.comment_signal)
      &&typeof proof.video_signal==='string'&&proof.video_signal.length>=2&&proof.video_signal.length<=100
      &&row.source_video.includes(proof.video_signal)&&proof.video_signal.includes(proof.matched_rule)
      &&String(fields['意向信号']||'').includes(proof.matched_rule);
    const hasIntent=explicitIntent(row.comment_body,snapshot.runtime_config.comment_scoring.audiences||[])||contextualIntent;
    if(verdict.grade!=='不相关'&&!hasIntent)return {...base,reason:'personal_intent_evidence_missing'};
    if(verdict.grade==='不相关'&&hasIntent&&!proof.exclusion_rule)return {...base,reason:'exclusion_evidence_missing'};
    const pass=verdict.grade===expected&&(!proof.exclusion_rule||verdict.grade==='不相关');
    return {id:row.id,status:pass?'pass':'fail',reason:pass?'policy_match':'policy_exclusion_or_grade_mismatch',
      evidence_sha256:sha({model:verdict.audit.model,response_id:verdict.audit.response_id,proof}),
      model:verdict.audit.model,response_id:verdict.audit.response_id,confidence:verdict.audit.confidence??null,
      policy_evidence:{audience_id:proof.audience_id,matched_rule:proof.matched_rule,
        exclusion_rule:proof.exclusion_rule,reason:proof.reason},
      original_sha256:sha({relevance:row.relevance,intent_grade:row.intent_grade,judgment_reason:row.judgment_reason,judgment_config:config}),
      company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,policy_id:snapshot.policy_id,
      video_url_sha256:sha(row.source_video_url),actor:'leadgen-policy-review',reviewed_at:new Date().toISOString()};
  }catch{return {...base,reason:'policy_model_unavailable_or_invalid'};}
}

module.exports={evaluatePolicy};
