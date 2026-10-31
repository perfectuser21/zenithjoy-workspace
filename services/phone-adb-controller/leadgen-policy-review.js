'use strict';
const {configTargetProfile}=require('./company-config-lib.js');
const {judgeCommander,scoreFailureReceipt}=require('./judge-comment.js');
const crypto=require('node:crypto');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const safeReasons=new Set(['binding_unverified','policy_evidence_invalid','personal_intent_evidence_missing',
  'audience_or_topic_evidence_missing','exclusion_evidence_missing','policy_exclusion_or_grade_mismatch',
  'policy_model_unavailable_or_invalid','policy_model_http','policy_model_transport',
  'policy_model_credential_missing','policy_model_evidence_invalid','policy_review_config_invalid',
  'policy_review_internal_error','policy_review_budget_exhausted','policy_review_identity_reused','policy_review_disagreement']);
const safePolicyReviewReason=reason=>safeReasons.has(reason)?reason:null;
const terminalEvidenceReasons=new Set(['personal_intent_evidence_missing','audience_or_topic_evidence_missing']);
function policyModelFailure(error){
  const failure=scoreFailureReceipt(error);
  if(failure.code==='POLICY_SCORE_MODEL_HTTP')return {reason:'policy_model_http',
    model_stage:failure.stage,http_status:failure.http_status};
  if(failure.code==='POLICY_SCORE_MODEL_TRANSPORT')return {reason:'policy_model_transport',model_stage:failure.stage};
  if(failure.code==='POLICY_SCORE_MODEL_CREDENTIAL_MISSING')return {reason:'policy_model_credential_missing',model_stage:failure.stage};
  if(failure.code==='POLICY_SCORE_COMMANDER_EVIDENCE_INVALID')return {reason:'policy_model_evidence_invalid',
    model_stage:'commander',...(failure.evidence_check?{evidence_check:failure.evidence_check}:{})};
  if(failure.code==='POLICY_SCORE_CONFIG_INVALID')return {reason:'policy_review_config_invalid'};
  return {reason:'policy_review_internal_error'};
}
// 只把冻结公司政策中的明示意向信号当作可核查的个人诉求依据。
// 模型的人群引用、同档位及视频话题不能凭空替评论补出诉求。
function explicitIntent(comment, audiences){
  return audiences.some(a=>String(a.fields?.['意向信号']||'').split(/[\/、，,；;\n]/)
    .map(s=>s.trim()).filter(s=>s.length>=2).some(signal=>comment.includes(signal)));
}
function sharedTopicEvidence(commentSignal,videoSignal){
  const video=videoSignal.toLowerCase();
  return (commentSignal.match(/[A-Za-z]{3,}|[\p{Script=Han}]{2,}/gu)||[]).some(token=>{
    if(/^[A-Za-z]+$/.test(token))return video.includes(token.toLowerCase());
    return Array.from({length:token.length-1},(_,i)=>token.slice(i,i+2))
      .some(pair=>!['这个','那个','视频','什么','多少','哪张','就是','真的'].includes(pair)&&video.includes(pair));
  });
}
// 冻结 A 规则明确接受求资料/求助时，原文索取报考流程属于个人行动诉求。
// 只认评论中的请求动作和同一视频标题的流程原文，不把泛问句或标题话题单独当意向。
function processRequestEvidence(comment,video,rules){
  if(!/(?:求资料|明确求助)/u.test(String(rules?.criteria?.A||'')))return false;
  if(!video.includes('流程'))return false;
  if(/(?:不要|不需要|不用|不求|别发|别给).{0,8}流程/u.test(comment))return false;
  return /(?:可以|可否|能否|能不能|能|麻烦|请)?\s*(?:发|给)(?:我)?(?:一下|一份|个)?(?:报考|报名)?流程(?:吗|[?？])?/u.test(comment)
    ||/(?:求|要)(?:一份|一下)?(?:报考|报名)?流程/u.test(comment);
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
    let verdict=await judgePolicy(row.comment_body,row.source_video,configTargetProfile(snapshot,'103'),'policy semantic verification',
      {scoringRules:snapshot.runtime_config.comment_scoring});
    let proof=verdict?.audit?.policy_evidence;
    const directQuestion=typeof proof?.comment_signal==='string'&&row.comment_body.includes(proof.comment_signal)
      &&/(?:到底.{0,15}(?:几|哪)|几[张个种本]|哪[张个种款]|多少钱|怎么|如何|能否|是否|能不能|可不可以)/u.test(proof.comment_signal);
    if(verdict?.grade==='A'&&directQuestion
      &&!(typeof proof.video_signal==='string'&&proof.video_signal.length>=2&&proof.video_signal.length<=100
        &&row.source_video.includes(proof.video_signal))){
      verdict=await judgePolicy(row.comment_body,row.source_video,configTargetProfile(snapshot,'103'),'policy semantic verification',
        {scoringRules:snapshot.runtime_config.comment_scoring,retryVideoQuote:true});
      proof=verdict?.audit?.policy_evidence;
    }
    const audience=snapshot.runtime_config.comment_scoring.audiences?.find(a=>a.id===proof?.audience_id);
    const fields=audience?.fields||{};
    if(!['A','B','C','不相关'].includes(verdict?.grade)||!verdict?.audit?.response_id||!verdict.audit.model||!proof||!audience||!proof.reason||proof.reason.length>500
      ||row.comment_body.length>=8&&proof.reason.includes(row.comment_body)
      ||!proof.matched_rule||proof.matched_rule.length>300
      ||!(String(fields['意向信号']||'').includes(proof.matched_rule)||String(fields['人群描述']||'').includes(proof.matched_rule))
      ||!(proof.exclusion_rule===null||typeof proof.exclusion_rule==='string'&&proof.exclusion_rule.trim()
        &&String(fields['排除信号']||'').includes(proof.exclusion_rule)))return {...base,reason:'policy_evidence_invalid'};
    const expected=row.relevance==='不相关'?'不相关':row.intent_grade;
    const quotedComment=typeof proof.comment_signal==='string'&&proof.comment_signal.length>=3&&proof.comment_signal.length<=100
      &&row.comment_body.includes(proof.comment_signal);
    const quotedVideo=typeof proof.video_signal==='string'&&proof.video_signal.length>=2&&proof.video_signal.length<=100
      &&row.source_video.includes(proof.video_signal);
    const verifiedQuestion=quotedComment&&/(?:到底.{0,15}(?:几|哪)|几[张个种本]|哪[张个种款]|多少钱|怎么|如何|能否|是否|能不能|可不可以)/u.test(proof.comment_signal);
    const contextualIntent=quotedComment&&quotedVideo
      &&((/[?？]/.test(proof.comment_signal)&&proof.video_signal.includes(proof.matched_rule)
        &&String(fields['意向信号']||'').includes(proof.matched_rule))
        ||(verifiedQuestion&&sharedTopicEvidence(proof.comment_signal,proof.video_signal))
        ||processRequestEvidence(row.comment_body,row.source_video,snapshot.runtime_config.comment_scoring));
    const hasIntent=explicitIntent(row.comment_body,snapshot.runtime_config.comment_scoring.audiences||[])||contextualIntent;
    const missingEvidence=reason=>({...base,reason,candidate_grade:verdict.grade,
      model:verdict.audit.model,response_id:verdict.audit.response_id,
      evidence_sha256:sha({model:verdict.audit.model,response_id:verdict.audit.response_id,proof}),
      original_sha256:sha({relevance:row.relevance,intent_grade:row.intent_grade,
        judgment_reason:row.judgment_reason,judgment_config:config})});
    if(verdict.grade==='A'&&!hasIntent)return missingEvidence('personal_intent_evidence_missing');
    if(['B','C'].includes(verdict.grade)
      &&!(typeof proof.comment_signal==='string'&&proof.comment_signal.length>=3&&proof.comment_signal.length<=100
        &&row.comment_body.includes(proof.comment_signal)&&proof.comment_signal.includes(proof.matched_rule)))
      return missingEvidence('audience_or_topic_evidence_missing');
    if(verdict.grade==='不相关'&&hasIntent&&!proof.exclusion_rule)return {...base,reason:'exclusion_evidence_missing'};
    const pass=verdict.grade===expected&&(!proof.exclusion_rule||verdict.grade==='不相关');
    const policyEvidence={audience_id:proof.audience_id,matched_rule:proof.matched_rule,
      comment_signal:proof.comment_signal,video_signal:proof.video_signal,
      exclusion_rule:proof.exclusion_rule,reason:proof.reason};
    return {id:row.id,status:pass?'pass':'fail',reason:pass?'policy_match':'policy_exclusion_or_grade_mismatch',grade:verdict.grade,
      evidence_sha256:sha({model:verdict.audit.model,response_id:verdict.audit.response_id,proof:policyEvidence}),
      model:verdict.audit.model,response_id:verdict.audit.response_id,confidence:verdict.audit.confidence??null,
      policy_evidence:policyEvidence,
      original_sha256:sha({relevance:row.relevance,intent_grade:row.intent_grade,judgment_reason:row.judgment_reason,judgment_config:config}),
      company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,policy_id:snapshot.policy_id,
      video_url_sha256:sha(row.source_video_url),actor:'leadgen-policy-review',reviewed_at:new Date().toISOString()};
  }catch(error){return {...base,...policyModelFailure(error)};}
}

async function dualPolicyReview(row,snapshot,deps={}){
  let calls=0;
  const judgePolicy=async(...args)=>{
    if(calls>=2)throw Error('POLICY_REVIEW_BUDGET_EXHAUSTED');
    calls++;
    return (deps.judgePolicy||judgeCommander)(...args);
  };
  const first=await evaluatePolicy(row,snapshot,{judgePolicy});
  if(terminalEvidenceReasons.has(first.reason)&&first.status==='unknown'){
    if(calls>=2)return {id:row.id,status:'unknown',reason:'policy_review_budget_exhausted',model_call_count:calls};
    const second=await evaluatePolicy(row,snapshot,{judgePolicy});
    if(second.status==='unknown'&&!terminalEvidenceReasons.has(second.reason))
      return {...second,model_call_count:calls};
    if(second.status!=='unknown'||second.reason!==first.reason||second.candidate_grade!==first.candidate_grade)
      return {id:row.id,status:'unknown',reason:'policy_review_disagreement',model_call_count:calls};
    if(!first.response_id||!second.response_id||first.response_id===second.response_id
      ||!first.evidence_sha256||!second.evidence_sha256||first.evidence_sha256===second.evidence_sha256
      ||first.original_sha256!==second.original_sha256)
      return {id:row.id,status:'unknown',reason:'policy_review_identity_reused',model_call_count:calls};
    return {id:row.id,status:'exclude',reason:first.reason,reviews:[first,second],model_call_count:calls};
  }
  if(first.status!=='pass')return {...first,model_call_count:calls};
  if(calls>=2)return {id:row.id,status:'unknown',reason:'policy_review_budget_exhausted',model_call_count:calls};
  const second=await evaluatePolicy(row,snapshot,{judgePolicy});
  if(second.status!=='pass')return {...second,model_call_count:calls};
  if(first.response_id===second.response_id||first.evidence_sha256===second.evidence_sha256)
    return {id:row.id,status:'unknown',reason:'policy_review_identity_reused',model_call_count:calls};
  return {id:row.id,status:'pass',reason:'policy_match',reviews:[first,second],model_call_count:calls};
}

async function verifyStoredPolicy(row,snapshot){
  const base={id:row?.id,status:'unknown',reason:'policy_evidence_invalid'};
  const config=row?.judgment_config,reviews=config?.policy_reviews;
  if(!Array.isArray(reviews)||reviews.length!==2||reviews.some(v=>v?.status!=='pass'||!v.grade
    ||!v.model||!v.response_id||!v.policy_evidence||!v.evidence_sha256||!v.original_sha256)
    ||reviews[0].response_id===reviews[1].response_id||sha(config.policy_audit)!==sha(reviews[0]))return base;
  const sourceConfig={...config};delete sourceConfig.model_audit;delete sourceConfig.policy_audit;delete sourceConfig.policy_reviews;
  for(const review of reviews){
    const evidence=review.policy_evidence;
    const verdict={grade:review.grade,audit:{model:review.model,response_id:review.response_id,
      confidence:review.confidence,policy_evidence:evidence}};
    const checked=await evaluatePolicy({...row,judgment_config:sourceConfig},snapshot,{judgePolicy:async()=>verdict});
    if(checked.status!=='pass'||checked.evidence_sha256!==review.evidence_sha256
      ||checked.original_sha256!==review.original_sha256)return {...base,reason:checked.status==='pass'?'policy_evidence_invalid':safePolicyReviewReason(checked.reason)||base.reason};
  }
  return {id:row.id,status:'pass',reason:'policy_match',model_call_count:0,
    evidence_sha256:sha(reviews.map(v=>v.evidence_sha256)),review_count:2};
}

async function reviewBoundComment(pool,lineKey,id,binding,deps,queueRequest){
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const unknown={id,status:'unknown',reason:'comment_outbox_binding_invalid'};
  if(!uuid.test(id||'')||!binding?.run||!binding.source_run||!binding.source_video||!binding.source_video_url)return unknown;
  const scoringRun=binding.scoring_run||binding.run;
  const rows=(await pool.query('SELECT * FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND id=$2',[lineKey,id])).rows;
  if(rows.length!==1||rows[0].id!==id||rows[0].line_key!==lineKey
    ||rows[0].harvest_batch!==(binding.source_batch||binding.source_run)||rows[0].source_video!==binding.source_video
    ||rows[0].source_video_url!==binding.source_video_url||rows[0].judgment_config?.run_id!==scoringRun)return unknown;
  try{
    if(scoringRun!==binding.run){
      const frozen=(await pool.query(`SELECT company_id,tenant_id,version,run_id,snapshot FROM zenithjoy.company_config_runs
        WHERE run_id=$1 AND snapshot->'runtime_config'->'routing'->>'line_key'=$2`,[binding.run,lineKey])).rows;
      const mark=frozen[0]?.snapshot,original=rows[0].judgment_config;
      if(frozen.length!==1||frozen[0].run_id!==binding.run||!mark||mark.company_id!==original.company_id
        ||mark.tenant_id!==original.tenant_id||Number(mark.version)!==Number(original.version)||mark.policy_id!==original.policy_id)return unknown;
    }
    const review=await queueRequest(pool,{op:'policy_review',line:lineKey,run:scoringRun,claim:scoringRun,source_run:binding.source_run,ids:[id],require_dual_review:true},deps);
    return review.rows[0]||unknown;
  }catch{return unknown;}
}

module.exports={evaluatePolicy,dualPolicyReview,verifyStoredPolicy,safePolicyReviewReason,reviewBoundComment};
