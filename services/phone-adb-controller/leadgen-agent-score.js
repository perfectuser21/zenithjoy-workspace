'use strict';

const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const partial=require('./leadgen-committed-partial.js');
const {configEvidence}=require('./judge-video.js');
const {readScoreTranscript,isAgentScoreIdentity}=require('./leadgen-score-context.js');
const {configTargetProfile}=require('./company-config-lib.js');
const {frozenPolicyReferences,REFERENCE_MODE,validateFrozenPolicyEvidence}=require('./leadgen-frozen-policy-evidence.js');
const {makeSingleScoreAudit,verifyStoredScore}=require('./leadgen-policy-review.js');

function digest(value){
  const json=JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
    ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b,'en'))):item);
  return createHash('sha256').update(json).digest('hex');
}

function sameRunIdentity(a,b){
  return ['task_id','run_id','activity_key','action_id'].every(key=>a?.[key]===b[key]);
}

function exactScope(input,partialIds,identity,execution){
  if(!isAgentScoreIdentity(identity)||execution?.task_id!==identity.task_id||execution.run_id!==identity.run_id
      ||execution.run!==input.run||identity.run_id!==input.run||execution.line!==input.line)throw Error('AGENT_SCORE_AUTHORITY_REQUIRED');
  const fields=new Set(['op','run','line','ids','sources','committed_partial_ids','limit','budget_max','source_run',
    ...(input.op==='score_submit'?['score','input_sha256']:[])]);
  if(Object.keys(input).some(key=>!fields.has(key))||partialIds?.length!==1||!isDeepStrictEqual(input.ids,partialIds)
      ||!input.sources||typeof input.sources!=='object'||Array.isArray(input.sources)
      ||Object.keys(input.sources).length!==1||!Object.hasOwn(input.sources,partialIds[0])
      ||typeof input.sources[partialIds[0]]!=='string'||!input.sources[partialIds[0]])throw Error('AGENT_SCORE_SCOPE_INVALID');
  return partialIds[0];
}

async function material(client,{input,id,row}){
  const {line:lineKey,run}=input;
  const admitted=await partial.admittedRows(client,{lineKey,run,ids:[id]});
  const comment=row??admitted[0];
  if(!partial.contains(admitted,comment)||comment.harvest_batch!==input.sources[id])throw Error('AGENT_SCORE_SOURCE_CHANGED');
  const snapshot=(await partial.readFrozen(client,lineKey,run)).snapshot;
  const rules=snapshot.runtime_config.comment_scoring;
  const transcript=await readScoreTranscript(client,lineKey,comment,[]);
  if(!transcript?.trim())throw Error('AGENT_SCORE_TRANSCRIPT_REQUIRED');
  if(!comment.comment_body.trim()||Buffer.byteLength(comment.comment_body,'utf8')>4000)
    throw Error('AGENT_SCORE_COMMENT_INVALID');
  const body={
    comment_id:id,source_run:comment.harvest_batch,comment_body:comment.comment_body,
    video_url:comment.source_video_url,video_title:comment.source_video,video_transcript:transcript,
    policy:{company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,
      policy_id:snapshot.policy_id,criteria:rules.criteria,references:frozenPolicyReferences(rules),
      target_profile:configTargetProfile(snapshot,'103')},
  };
  return {comment,snapshot,body,inputDigest:digest({run,body,rules,recipient:comment.recipient_evidence})};
}

function unscored(row){
  return row.process_status==='待分拣'&&['relevance','intent_grade','judgment_reason','judgment_config'].every(key=>row[key]==null);
}

async function scoreInput(pool,input,{partialIds,identity,execution}){
  const id=exactScope(input,partialIds,identity,execution);
  const {comment,body,inputDigest}=await material(pool,{input,id});
  if(!unscored(comment))throw Error('AGENT_SCORE_ALREADY_SCORED');
  if(Buffer.byteLength(JSON.stringify(body),'utf8')>65536)throw Error('AGENT_SCORE_INPUT_TOO_LARGE');
  return {...body,input_sha256:inputDigest};
}

async function scoreSubmit(client,input,{partialIds,identity,execution}){
  const id=exactScope(input,partialIds,identity,execution);
  const {score,input_sha256:inputDigest}=input;
  if(!/^[a-f0-9]{64}$/.test(inputDigest??'')||!score||Array.isArray(score)
      ||Object.keys(score).sort().join(',')!=='grade,policy_evidence'
      ||!score.policy_evidence||Object.keys(score.policy_evidence).sort().join(',')!==
         'audience_id,comment_signal,exclusion_rule,matched_rule,reason,video_signal')throw Error('AGENT_SCORE_RESULT_INVALID');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`leadgen-score:${input.line}:${input.run}:null`]);
  const rows=(await client.query('SELECT * FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND id=$2 FOR UPDATE',
    [input.line,id])).rows;
  if(rows.length!==1)throw Error('AGENT_SCORE_COMMENT_MISSING');
  const {comment,snapshot,body,inputDigest:expected}=await material(client,{input,id,row:rows[0]});
  if(inputDigest!==expected)throw Error('AGENT_SCORE_INPUT_CHANGED');
  const answerDigest=digest(score);
  const verified={ids:[id],grade:score.grade,verified:true,model_call_count:0};
  if(!unscored(comment)){
    const old=comment.judgment_config;
    if(old?.run_id!==input.run||old.model_audit?.provider!=='codex'
        ||old.model_audit.input_sha256!==inputDigest||old.model_audit.answer_sha256!==answerDigest
        ||!sameRunIdentity(old.model_audit.agent_identity,identity)||verifyStoredScore(comment,snapshot).status!=='pass')
      throw Error('AGENT_SCORE_ALREADY_SCORED');
    return {...verified,scored:0,already_committed:true};
  }
  const [used]=(await client.query("SELECT count(*)::int AS used FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND judgment_config->>'run_id'=$2",
    [input.line,input.run])).rows;
  if(used?.used!==0)throw Error('AGENT_SCORE_BUDGET_USED');
  const rules=snapshot.runtime_config.comment_scoring;
  if(validateFrozenPolicyEvidence({grade:score.grade,proof:score.policy_evidence,rules,
    comment:body.comment_body,video:body.video_title,requireQuotes:true}))throw Error('AGENT_SCORE_EVIDENCE_INVALID');
  const relevance=score.grade==='不相关'?'不相关':'相关';
  const reason=score.policy_evidence.reason;
  const audit=makeSingleScoreAudit(comment,snapshot,{grade:score.grade,relevance,reason,audit:{
    provider:'codex',agent_identity:identity,input_sha256:inputDigest,answer_sha256:answerDigest,
    policy_reference_mode:REFERENCE_MODE,policy_evidence:score.policy_evidence,
  }},configEvidence(snapshot,input.run));
  const update=await client.query(`UPDATE zenithjoy.leadgen_comments
    SET relevance=$2,intent_grade=$3,judgment_reason=$4,judgment_config=$5::jsonb,updated_at=now()
    WHERE id=$1 AND process_status='待分拣' AND relevance IS NULL AND intent_grade IS NULL
    AND judgment_reason IS NULL AND judgment_config IS NULL RETURNING id`,
    [id,relevance,relevance==='相关'?score.grade:null,reason,JSON.stringify(audit)]);
  if(update.rowCount!==1||update.rows[0]?.id!==id)throw Error('AGENT_SCORE_NOT_PERSISTED');
  return {...verified,scored:1,already_committed:false};
}

module.exports={scoreInput,scoreSubmit};
