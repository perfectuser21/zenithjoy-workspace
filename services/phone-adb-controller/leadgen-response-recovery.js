'use strict';
// Narrow incident recovery: these are retrospective file hashes, not request signatures.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const partial=require('./leadgen-committed-partial.js');
const {REFERENCE_MODE,normalizeFrozenPolicyEvidence,validateFrozenPolicyEvidence}=require('./leadgen-frozen-policy-evidence.js');
const {makeSingleScoreAudit}=require('./leadgen-policy-review.js');
const {configEvidence}=require('./judge-video.js');
const MODEL='google/gemini-2.5-flash';
const fail=code=>{throw Error('RESPONSE_RECOVERY_'+code);};
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function privateFile(file,sha,{privateDirectory=false}={}){
 let fd;
 try{
  if(!path.isAbsolute(file)||fs.realpathSync(file)!==path.resolve(file))fail('FILE_PATH_INVALID');
  if(privateDirectory){const d=fs.lstatSync(path.dirname(file));if(!d.isDirectory()||d.uid!==process.getuid()||(d.mode&0o777)!==0o700)fail('DIRECTORY_INVALID');}
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const st=fs.fstatSync(fd);
  if(!st.isFile()||st.uid!==process.getuid()||(st.mode&0o777)!==0o600||st.size>65536)fail('FILE_MODE_INVALID');
  const raw=fs.readFileSync(fd);if(hash(raw)!==sha)fail('FILE_HASH_INVALID');return JSON.parse(raw.toString('utf8'));
 }catch(error){if(error.message?.startsWith('RESPONSE_RECOVERY_'))throw error;fail('FILE_INVALID');}finally{if(fd!==undefined)fs.closeSync(fd);}
}
function readArchive(grant){
 const audit=privateFile(grant.audit_path,grant.audit_sha256,{privateDirectory:true}),original=privateFile(grant.input_path,grant.input_sha256);
 const expected={op:'score',line:grant.line,run:grant.run,source_run:null,ids:[grant.id],sources:{[grant.id]:grant.source_run},limit:1,budget_max:1,committed_partial_ids:[grant.id]};
 if(!isDeepStrictEqual(original,expected)||audit.response_id!==grant.response_id||audit.model!==MODEL||audit.validation!=='matched_rule_not_frozen'||typeof audit.raw!=='string'||audit.raw.length>4096)fail('ARCHIVE_SCOPE_INVALID');
 let answer;try{answer=JSON.parse(audit.raw);}catch{fail('ANSWER_INVALID');}
 if(!answer||Object.keys(answer).sort().join(',')!=='grade,policy_evidence'||!['A','B','C','不相关'].includes(answer.grade)||!answer.policy_evidence||Object.keys(answer.policy_evidence).sort().join(',')!=='audience_id,comment_signal,exclusion_rule,matched_rule,reason,video_signal')fail('ANSWER_INVALID');
 return {audit,original,answer};
}
function validateGeneration(response,grant){const d=response?.data;if(!d||d.id!==grant.response_id||d.model!==MODEL||d.cancelled===true||d.finish_reason!=='stop')fail('GENERATION_INVALID');return {id:d.id,model:d.model,created_at:d.created_at||null,finish_reason:d.finish_reason};}
async function getGeneration(grant){
 const key=require('./judge-comment.js').resolveOpenRouterKey(process.env);if(!key)fail('CREDENTIAL_MISSING');
 try{const r=await fetch('https://openrouter.ai/api/v1/generation?id='+encodeURIComponent(grant.response_id),{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});if(!r.ok)fail('GENERATION_HTTP');return validateGeneration(await r.json(),grant);}catch(e){if(e.message?.startsWith('RESPONSE_RECOVERY_'))throw e;fail('GENERATION_UNAVAILABLE');}
}
async function applyRecoveredResponse(client,{grant,archive,generation}){
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['leadgen-response:'+grant.response_id]);
 const used=(await client.query("SELECT id FROM zenithjoy.leadgen_comments WHERE judgment_config->'model_audit'->>'response_id'=$1",[grant.response_id])).rows;if(used.length)fail('REPLAY');
 const locked=(await client.query('SELECT * FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND id=$2 FOR UPDATE',[grant.line,grant.id])).rows;
 const row=locked[0];if(locked.length!==1||row.harvest_batch!==grant.source_run||row.process_status!=='待分拣'||[row.relevance,row.intent_grade,row.judgment_reason,row.judgment_config].some(x=>x!==null))fail('ROW_CHANGED');
 const admitted=await partial.admittedRows(client,{lineKey:grant.line,run:grant.run,ids:[grant.id]});if(!partial.contains(admitted,row))fail('ADMISSION_CHANGED');
 const frozen=(await client.query("SELECT company_id,tenant_id,version,run_id,source_run,snapshot FROM zenithjoy.company_config_runs WHERE run_id=$1 AND snapshot->'runtime_config'->'routing'->>'line_key'=$2",[grant.run,grant.line])).rows;
 if(frozen.length!==1||frozen[0].source_run!==null)fail('FROZEN_INVALID');const snapshot=frozen[0].snapshot;
 if(snapshot.company_id!==grant.company_id||snapshot.tenant_id!==grant.tenant_id||snapshot.version!==grant.version_number||snapshot.policy_id!==grant.policy_id)fail('COMPANY_CHANGED');
 const n=normalizeFrozenPolicyEvidence(archive.answer.policy_evidence,snapshot.runtime_config.comment_scoring);
 if(!n.normalization||validateFrozenPolicyEvidence({grade:archive.answer.grade,proof:n.proof,rules:snapshot.runtime_config.comment_scoring,comment:row.comment_body,video:row.source_video,requireQuotes:true}))fail('EVIDENCE_INVALID');
 const verdict={grade:archive.answer.grade,relevance:archive.answer.grade==='不相关'?'不相关':'相关',reason:n.proof.reason,audit:{model:MODEL,response_id:grant.response_id,stage:'single',model_call_count:1,policy_reference_mode:REFERENCE_MODE,policy_evidence:n.proof,evidence_normalization:n.normalization,response_recovery:{mode:'retrospective-private-response-v1',task_id:grant.root_task_id,scoring_task_id:grant.scoring_task_id,producer_source_commit:grant.producer_source_commit,audit_sha256:grant.audit_sha256,original_input_sha256:grant.input_sha256,raw_sha256:hash(archive.audit.raw),generation_metadata:generation,request_signature:false,generation_call_count:0}}};
 const audit=makeSingleScoreAudit(row,snapshot,verdict,configEvidence(snapshot,grant.run));
 const updated=await client.query("UPDATE zenithjoy.leadgen_comments SET relevance=$2,intent_grade=$3,judgment_reason=$4,judgment_config=$5::jsonb,updated_at=now() WHERE id=$1 AND relevance IS NULL AND intent_grade IS NULL AND judgment_reason IS NULL AND judgment_config IS NULL AND process_status='待分拣' RETURNING id",[row.id,verdict.relevance,verdict.relevance==='相关'?verdict.grade:null,verdict.reason,JSON.stringify(audit)]);
 if(updated.rowCount!==1||updated.rows[0]?.id!==row.id)fail('NOT_PERSISTED');
 return {scored:1,ids:[row.id],grade:verdict.grade,response_id:grant.response_id,model_call_count:0,recovered_existing_response:true};
}
function validateAuthorization(root,task,execution){
 const grant=root?.result?.score_recovery_authorization;
 if(!grant||grant.version!==1||root.id!==execution?.root_task_id||task?.id!==execution.task_id||task.parent_task_id!==root.id
   ||root.status!=='in_progress'||task.status!=='in_progress'||!root.project_id||task.project_id!==root.project_id
   ||!grant.root_actor||!grant.scoring_actor||root.claimed_by!==grant.root_actor||task.claimed_by!==grant.scoring_actor||execution.actor!==grant.scoring_actor
   ||grant.root_task_id!==root.id||grant.scoring_task_id!==task.id||!grant.run_id||task.payload?.current_run_id!==grant.run_id||execution.run_id!==grant.run_id||execution.run!==grant.run
   ||grant.allowed_normalization!=='complete-frozen-field-extraction-v1'||grant.model!==MODEL
   ||!grant.company_id||!grant.tenant_id||!Number.isSafeInteger(grant.version_number)||!grant.policy_id
   ||!/^[-a-f0-9]{36}$/i.test(grant.id||'')||!grant.line||!grant.run||!grant.source_run||!grant.response_id
   ||!/^gen-[A-Za-z0-9-]+$/.test(grant.response_id)||!/^[-a-f0-9]{40}$/.test(grant.producer_source_commit||'')
   ||!['audit_sha256','input_sha256'].every(k=>/^[a-f0-9]{64}$/.test(grant[k]||'')))fail('AUTHORIZATION_INVALID');
 return grant;
}
async function readAuthorization(execution){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!uuid.test(execution?.task_id||'')||!uuid.test(execution?.root_task_id||'')||!process.env.BRAIN_INTERNAL_TOKEN)fail('TASK_CONTEXT_INVALID');
 try{const tasks=await Promise.all([execution.root_task_id,execution.task_id].map(async id=>{const r=await fetch('http://127.0.0.1:5221/api/brain/tasks/'+id,{headers:{'X-Internal-Token':process.env.BRAIN_INTERNAL_TOKEN},signal:AbortSignal.timeout(10000),redirect:'error'});if(!r.ok)fail('BRAIN_HTTP');return r.json();}));return validateAuthorization(tasks[0],tasks[1],execution);}catch(e){if(e.message?.startsWith('RESPONSE_RECOVERY_'))throw e;fail('BRAIN_UNAVAILABLE');}
}
async function recover(pool,input,{sourceCommit,execution}={}){
 const grant=await readAuthorization(execution);
 if(!/^[0-9a-f]{40}$/.test(sourceCommit||'')||input.candidate_source_commit!==sourceCommit||input.task_id!==grant.scoring_task_id||input.root_task_id!==grant.root_task_id||input.line!==grant.line||input.run!==grant.run||input.source_run!==null||!isDeepStrictEqual(input.ids,[grant.id])||!isDeepStrictEqual(input.committed_partial_ids,[grant.id])||!isDeepStrictEqual(input.sources,{[grant.id]:grant.source_run})||input.producer_source_commit!==grant.producer_source_commit||input.response_id!==grant.response_id)fail('REQUEST_SCOPE_INVALID');
 const archive=readArchive(grant),generation=await getGeneration(grant);
 if(!isDeepStrictEqual(grant,await readAuthorization(execution)))fail('AUTHORIZATION_CHANGED');
 const client=await pool.connect();try{await client.query('BEGIN');const r=await applyRecoveredResponse(client,{grant,archive,generation});await client.query('COMMIT');return r;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
module.exports={recover,readArchive,validateGeneration,applyRecoveredResponse,validateAuthorization};
