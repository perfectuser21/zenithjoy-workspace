// 独立 Codex 任务身份；不会注册旧 Runner 身份或授予手机资源。
import {digest,canonical,validateAgentInput} from './runtime-definition.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/,commit=/^[a-f0-9]{40}$/;
const fields=['protocol','task_id','run_id','claimer','claimed_at','machine_id','profile_sha256','skill','scope_sha256','run_binding','task_run_id','company','approved_keywords'];
const fail=()=>{throw Object.assign(Error('EPOCH_STANDALONE_IDENTITY'),{code:'EPOCH_STANDALONE_IDENTITY'});};
export function standaloneIdentityProjection(identity){
 return identity&&Object.fromEntries(fields.map(key=>[key,identity[key]]));
}
export function validateStandaloneIdentity(identity){
 const b=identity?.run_binding,s=identity?.skill,c=identity?.company;
 if(identity?.protocol!=='codex-exec-v1'||![identity.task_id,identity.run_id,identity.task_run_id,b?.run_binding_id,b?.workflow_id,b?.workflow_definition_version_id].every(v=>uuid.test(v||''))
  ||![c?.company_id,c?.tenant_id].every(v=>uuid.test(v||''))||!Number.isSafeInteger(c?.version)||c.version<1||typeof c.policy_id!=='string'||!c.policy_id.trim()
  ||!Array.isArray(identity.approved_keywords)||identity.approved_keywords.some(v=>typeof v!=='string'||!v.length||v.length>80||v.trim()!==v||/[\r\n\0]/.test(v))||new Set(identity.approved_keywords).size!==identity.approved_keywords.length
  ||!hash.test(identity.profile_sha256||'')||!hash.test(identity.scope_sha256||'')||typeof identity.machine_id!=='string'||!identity.machine_id
  ||typeof identity.claimer!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(identity.claimer)||identity.claimer==='common-runner'
  ||typeof identity.claimed_at!=='string'||!Number.isFinite(Date.parse(identity.claimed_at))
  ||b.source_kind!==undefined&&b.source_kind!=='internal'||typeof b.attempt_key!=='string'||!b.attempt_key
  ||!b.activities||!Object.keys(b.activities).length
  ||typeof s?.name!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.name)||typeof s.version!=='string'||!s.version
  ||!commit.test(s.source_commit||'')||!hash.test(s.sha256||'')||typeof s.path!=='string'||!s.path.split('/').every(v=>/^[A-Za-z0-9_.-]+$/.test(v)&&v!=='.'&&v!=='..'))fail();
 for(const [key,a]of Object.entries(b.activities))if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||!['reference_id','activity_id','activity_definition_version_id'].every(k=>uuid.test(a?.[k]||'')))fail();
 return structuredClone(standaloneIdentityProjection(identity));
}
export function standaloneScope(frozen){
 const p=validateStandaloneIdentity(frozen.standalone_skill),input=validateAgentInput(frozen.agent_input),spec=frozen.discovery_phone_scope??frozen.collection_phone_scope,scoring=input.workflow_key==='douyin_comment_scoring';
 if(frozen.public_domain!==undefined||frozen.execution_mode!=='agent'||frozen.primary_host!=='codex-exec-v1'||frozen.execution_transport!==undefined||frozen.max_turns!==undefined
  ||input.workflow_key==='douyin_video_discovery'&&!p.approved_keywords.length
  ||input.execution_transport!==undefined||input.task_id!==p.task_id||input.workflow_key!==frozen.workflow_version?.payload?.key
  ||input.run_tag!==frozen.run_identity?.tag
  ||(scoring?(input.profile!=='mmv-scoring'||input.serial!=='none'||frozen.discovery_phone_scope!==undefined||frozen.collection_phone_scope!==undefined):(!spec||input.profile!==spec.profile||input.serial!==spec.serial))
  ||!commit.test(frozen.deployment?.source_commit||'')||frozen.files?.[p.skill.path]!==p.skill.sha256
  ||Date.now()>=(input.run_start_ts+input.run_max_seconds)*1000)fail();
 return {...input,approved_keywords:p.approved_keywords,source_commit:frozen.deployment.source_commit,expected_account:scoring?'none':spec.expected_account,company:p.company,machine_id:p.machine_id};
}
function scopeWithTaskId(requested,taskId){
 return requested&&typeof requested==='object'&&!Array.isArray(requested)?{...requested,...(!Object.hasOwn(requested,'task_id')?{task_id:taskId}:{})}:null;
}
export function standaloneExecutionContextProjection(context){
 return context&&Object.fromEntries(['source','executor_kind','executor','claimed_at','skill','scope'].map(key=>[key,context[key]]));
}
export function standaloneExecutionContextMatches(context,identity,scope){
 try{
  const p=validateStandaloneIdentity(identity);
  return context?.source==='standalone-skill'&&context.executor_kind==='codex-exec-v1'&&context.executor===p.claimer&&context.claimed_at===p.claimed_at
   &&canonical(context.skill)===canonical(p.skill)&&canonical(scopeWithTaskId(context.scope,p.task_id))===canonical(scope)&&digest(scope)===p.scope_sha256;
 }catch{return false;}
}
export function standaloneTaskProjectionMatches(task,identity,scope){
 try{
  const p=validateStandaloneIdentity(identity),c=validateStandaloneIdentity(task?.result?.codex_skill_direct),requested=task?.payload?.scope;
  // 建单时Task ID由Brain生成；仅这个字段可从实际Task派生。
  const taskScope=scopeWithTaskId(requested,task.id);
  return task.id===p.task_id&&task.status==='in_progress'&&task.claimed_by===p.claimer&&task.claimed_at===p.claimed_at
   &&task.payload?.execution_mode==='standalone-skill'&&canonical(taskScope)===canonical(scope)
   &&canonical(task.payload.skill)===canonical(p.skill)&&digest(scope)===p.scope_sha256&&canonical(c)===canonical(p);
 }catch{return false;}
}
