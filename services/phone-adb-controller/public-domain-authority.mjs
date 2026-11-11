import {phonePeerPermitRecord} from './official-phone-peer-authority.mjs';
import {realpathSync} from 'node:fs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const authorities=new Map();
const fail=()=>{throw Error('PUBLIC_DOMAIN_AUTHORITY');};
export function validatePublicDomainIdentity(identity){
 const b=identity?.run_binding;
 if(identity?.mode!=='formal'||![identity.run_id,identity.task_id,b?.run_binding_id,b?.workflow_id,b?.workflow_definition_version_id].every(v=>UUID.test(v||''))
  ||b.source_kind!==undefined&&b.source_kind!=='internal'||typeof b.attempt_key!=='string'||!b.attempt_key
  ||!b.activities||!Object.keys(b.activities).length||!identity.machine_id||!/^[a-f0-9]{64}$/.test(identity.profile_sha256||''))fail();
 for(const [key,a] of Object.entries(b.activities))if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||!['reference_id','activity_id','activity_definition_version_id'].every(k=>UUID.test(a?.[k]||'')))fail();
 return structuredClone(identity);
}
export const publicDomainRunId=identity=>validatePublicDomainIdentity(identity).run_id;
export function registerPublicDomainAuthority({runDirectory,identity,business_scope,snapshot_authority,deadline_ms,cleanup_deadline_ms}){
 validatePublicDomainIdentity(identity);
 if(!Number.isSafeInteger(deadline_ms)||deadline_ms<=Date.now()||!Number.isSafeInteger(cleanup_deadline_ms)||cleanup_deadline_ms<=deadline_ms)fail();
 const dir=realpathSync(runDirectory);if(authorities.has(dir))fail();
 if(business_scope&&(business_scope.run_id!==identity.run_id||business_scope.task_id!==identity.task_id||!business_scope.run||!business_scope.profile||!business_scope.serial||!/^[a-f0-9]{40}$/.test(business_scope.source_commit||'')||business_scope.attempt!=='a1'))fail();
 if(snapshot_authority&&!['local_snapshot_sha256','runtime_snapshot_sha256'].every(k=>/^[a-f0-9]{64}$/.test(snapshot_authority[k]||'')))fail();
 const b=identity.run_binding,record={...(snapshot_authority?{snapshot_authority:structuredClone(snapshot_authority)}:{}),identity:structuredClone(identity),...(business_scope?{business_scope:structuredClone(business_scope)}:{}),deadline_ms,cleanup_deadline_ms,binding:{id:b.run_binding_id,run_id:identity.run_id,task_id:identity.task_id,source_kind:'internal',workflow_id:b.workflow_id,workflow_definition_version_id:b.workflow_definition_version_id,attempt_key:b.attempt_key,activities:structuredClone(b.activities)}};
 authorities.set(dir,record);return ()=>{if(authorities.get(dir)===record)authorities.delete(dir);};
}
export function publicDomainAuthority(runDirectory){try{const r=authorities.get(realpathSync(runDirectory));return r?structuredClone(r):null;}catch{return null;}}
export const readPublicDomainBinding=runDirectory=>publicDomainAuthority(runDirectory)?.binding??null;
export function publicDomainScopeMatches(runDirectory,scope){
 const a=publicDomainAuthority(runDirectory),fixed=a?.business_scope;
 return Boolean(fixed&&Date.now()<a.cleanup_deadline_ms&&['run','run_id','task_id','source_commit','profile','serial'].every(k=>scope?.[k]===fixed[k])&&(scope.attempt===undefined||scope.attempt===fixed.attempt));
}
export function canonicalRunId(env){return readPublicDomainBinding(env.WFR_RUN_DIR)?.run_id??`${env.WFR_RUN_ID}__${env.WFR_ATTEMPT}`;}
export function publicDomainTaskProjectionMatches(task,a){
 if(!a)return false;
 const c=task?.result?.common_runner,b=a.binding;
 return task.id===b.task_id&&task.status==='in_progress'&&task.claimed_by==='common-runner'&&c?.run_id===b.run_id&&c.task_id===b.task_id
  &&c.machine_id===a.identity.machine_id&&c.profile_sha256===a.identity.profile_sha256
  &&c.run_binding?.run_binding_id===b.id&&c.run_binding.workflow_id===b.workflow_id&&c.run_binding.workflow_definition_version_id===b.workflow_definition_version_id
  &&c.run_binding.attempt_key===b.attempt_key&&Object.keys(c.run_binding.activities||{}).length===Object.keys(b.activities).length&&Object.entries(b.activities).every(([key,v])=>['reference_id','activity_id','activity_definition_version_id'].every(k=>c.run_binding.activities?.[key]?.[k]===v[k]));
}
export function publicDomainTaskMatches(task,runDirectory){return publicDomainTaskProjectionMatches(task,publicDomainAuthority(runDirectory));}

// Process-owned public Activity admission. A UUID string alone grants nothing.
export function publicDomainActivityScopeMatches(runDirectory,scope,frozen,activity){
 try{
  const a=publicDomainAuthority(runDirectory),b=a?.binding,input=frozen?.agent_input,p=frozen?.public_domain;
  if(!a||!input||!p||frozen.execution_mode!=='agent'||a.snapshot_authority?.local_snapshot_sha256!==frozen.snapshot_sha256)return false;
  if(!['run_id','task_id','machine_id','profile_sha256'].every(k=>p[k]===a.identity[k])||p.run_binding?.run_binding_id!==b.id||frozen.workflow_version?.id!==b.workflow_definition_version_id)return false;
  const fixed={run:input.run_tag,run_id:b.run_id,task_id:b.task_id,binding_id:b.id,snapshot_sha256:frozen.snapshot_sha256,source_commit:frozen.deployment.source_commit,profile:input.profile,serial:input.serial,line:input.line,source_run:input.source_run};
  if(Object.entries(fixed).some(([k,v])=>scope?.[k]!==v)||input.task_id!==b.task_id||input.workflow_key!==frozen.workflow_version.payload.key)return false;
  if(scope.workflow!==undefined&&scope.workflow!==input.workflow_key||scope.activity!==undefined&&scope.activity!==activity)return false;
  for(const k of ['limit','comment_limit'])if(scope[k]!==undefined&&scope[k]!==input[k])return false;
  const ref=b.activities[activity],av=frozen.activities.find(v=>v.reference?.slot_key===activity);
  if(!ref||av?.reference.reference_id!==ref.reference_id||av?.reference.activity_id!==ref.activity_id||av?.version?.id!==ref.activity_definition_version_id)return false;
  const end=av.version.payload?.contract?.runtime?.phase==='finalize'?a.cleanup_deadline_ms:a.deadline_ms;
  return Date.now()<end&&(scope.deadline_ms===undefined||Number.isSafeInteger(scope.deadline_ms)&&scope.deadline_ms<=end);
 }catch{return false;}
}

export function registerDelegatedPhoneAuthority({permit,runDirectory,frozen}){
 const p=phonePeerPermitRecord(permit);
 if(frozen.public_domain?.run_id!==p.identity.run_id||frozen.public_domain?.task_id!==p.identity.task_id||JSON.stringify(frozen.phone_execution)!==JSON.stringify(p.descriptor)||frozen.deployment.target!=='xian-m4')fail();
 const off=registerPublicDomainAuthority({runDirectory,identity:p.identity,deadline_ms:frozen.public_domain.deadline_ms,cleanup_deadline_ms:p.deadline_ms,snapshot_authority:{local_snapshot_sha256:frozen.snapshot_sha256,runtime_snapshot_sha256:frozen.public_domain.runtime_snapshot_sha256},business_scope:{run:frozen.agent_input.run_tag,run_id:p.identity.run_id,task_id:p.identity.task_id,source_commit:p.parent.source_commit,profile:frozen.agent_input.profile,serial:frozen.agent_input.serial,attempt:'a1'}});
 const dir=realpathSync(runDirectory),r=authorities.get(dir);r.role='delegated-phone-peer';r.phone_host='xian-m4';r.parent_snapshot_sha256=p.parent.snapshot_sha256;return off;
}
