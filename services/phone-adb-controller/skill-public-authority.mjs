// Public primary execution uses a live parent-owned capability, never a request flag.
import {publicDomainAuthority,publicDomainTaskProjectionMatches} from './public-domain-authority.mjs';
import {readFrozen,validateAgentInput,frozenExecutionMode,canonical} from './runtime-definition.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash=/^[a-f0-9]{64}$/;
const fail=()=>{throw Error('RPC_SKILL_PUBLIC_AUTHORITY_INVALID');};
const same=(a,b)=>canonical(a)===canonical(b);
export function publicSkillAuthority(q,dir,binding){
 const a=publicDomainAuthority(dir),p=q.public_domain,v=k=>binding?.[k]??binding?.payload?.[k];
 if(q.mode!=='execute'||!a||!p||!same(p.identity,a.identity)||!same(p.run_binding,a.identity.run_binding))fail();
 const f=readFrozen(dir),pd=f.public_domain,b=a.binding,input=validateAgentInput(f.agent_input),s=a.snapshot_authority;
 const activity=f.activities?.find(v=>v.reference?.slot_key===q.activity_key&&v.reference.reference_id===q.method.reference_id&&v.version?.id===q.method.activity_version_id);
 const cleanup=q.activity_key==='cleanup'&&activity?.version?.payload?.contract?.runtime?.phase==='finalize';
 const deadline=cleanup?a.cleanup_deadline_ms:a.deadline_ms;
 if(Date.now()>=deadline||!Number.isSafeInteger(q.deadline_ms)||Date.now()>=q.deadline_ms||q.deadline_ms>deadline)fail();
 if(frozenExecutionMode(f)!=='agent'||!pd||!s||!hash.test(s.local_snapshot_sha256)||!hash.test(s.runtime_snapshot_sha256)
  ||s.local_snapshot_sha256!==f.snapshot_sha256||s.runtime_snapshot_sha256!==pd.runtime_snapshot_sha256
  ||p.local_snapshot_sha256!==f.snapshot_sha256||q.runtime_snapshot_sha256!==f.snapshot_sha256||p.runtime_snapshot_sha256!==s.runtime_snapshot_sha256)fail();
 if(!['run_id','task_id','machine_id','profile_sha256'].every(k=>pd[k]===a.identity[k])||!same(pd.run_binding,a.identity.run_binding)
  ||q.run_id!==b.run_id||q.task_id!==b.task_id||q.binding_id!==b.id||q.workflow_definition_version_id!==b.workflow_definition_version_id
  ||q.release_id!==f.release?.id||q.observation_id!==f.deployment.observation_id||q.source_commit!==f.deployment.source_commit||q.broker_host!==f.deployment.target||!same(input.workflow_key,f.workflow_version.payload.key))fail();
 for(const k of ['workflow_key','task_id','run_tag','profile','serial','line','source_run','limit','comment_limit','run_max_seconds','discovery_filters','execution_transport','max_turns'])if(!same(q[k],input[k]))fail();
 if(!same(q.discovery_input,f.discovery_input||null)||!a.business_scope||!['run_id','task_id','profile','serial'].every(k=>a.business_scope[k]===q[k])
  ||a.business_scope.run!==q.run_tag||a.business_scope.source_commit!==q.source_commit)fail();
 const ref=b.activities[q.activity_key];
 if(!ref||ref.reference_id!==q.method.reference_id||ref.activity_definition_version_id!==q.method.activity_version_id
  ||binding?.id!==b.id||binding.run_id!==b.run_id||v('source_kind')!=='internal'||v('actor')!=='common-runner'||v('external_origin')!=null
  ||!uuid.test(v('task_run_id')||'')||v('workflow_id')!==b.workflow_id||v('workflow_definition_version_id')!==b.workflow_definition_version_id
  ||v('attempt_key')!==b.attempt_key||v('runtime_snapshot_sha256')!==s.runtime_snapshot_sha256)fail();
 return {authority:a,snapshot:f,taskRunId:v('task_run_id')};
}
export async function verifyPublicSkillCurrent(q,dir,binding,get){
 const original=publicSkillAuthority(q,dir,binding);
 const links=await get('/api/brain/runs/'+encodeURIComponent(q.run_id)+'/reconciliation');
 if(links?.run_id!==q.run_id||links.run_binding_id!==q.binding_id||links.links?.task_run_id!==original.taskRunId||links.links?.task_id!==q.task_id
  ||links.task_run?.id!==original.taskRunId||links.task_run?.run_id!==q.run_id||links.task_run?.task_id!==q.task_id||links.task_run?.status!=='running'||links.task_run.ended_at!==null)fail();
 const response=await get('/api/brain/tasks/'+q.task_id),task=response.task??response;
 const current=publicSkillAuthority(q,dir,binding);
 if(!same(current.authority,original.authority)||!publicDomainTaskProjectionMatches(task,current.authority))fail();
 return true;
}
