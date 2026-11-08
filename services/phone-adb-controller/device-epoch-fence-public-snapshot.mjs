// 复核preparePublicDomainSnapshot的允许投影；不调用会创建文件的prepare函数。
import {readFrozen,digest,discoveryInput,commentSamplingInput} from './runtime-definition.mjs';
import {validatePublicDomainIdentity} from './public-domain-authority.mjs';
const need=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const same=(a,b)=>digest(a)===digest(b);
export {readFrozen};
export function recoverOriginalPublicProfile(state){
 const profile=structuredClone(state.profile),identity=state.identity;
 if(digest(profile)===identity.profile_sha256)return profile;
 // workflow-runner.start只添加这三组绑定/实现投影；逆投影后仍须命中原profile SHA。
 for(const activity of profile.contract.activities){
  const key=activity.key,m=profile.metadata[key],b=identity.run_binding.activities[key],runtime=activity.runtime;
  need(m&&b&&m.identity.run_binding_id===identity.run_binding.run_binding_id&&m.identity.attempt_key===identity.run_binding.attempt_key&&m.identity.enabler_call_id===null,'FROZEN_WORKER_BINDING');
  need(runtime.executor_kind===m.executor_kind,'FROZEN_WORKER_EXECUTOR');delete runtime.executor_kind;
  const implementation={kind:m.executor_kind,entry:runtime.entry,sha256:profile.files[runtime.entry],...(m.skill?{skill:{...m.skill,sha256:profile.files[m.skill.entry]}}:{})};need(same(m.implementation,implementation),'FROZEN_WORKER_IMPLEMENTATION');m.implementation={...implementation,source_activity_definition_version_id:b.activity_definition_version_id};
  for(const k of ['run_binding_id','attempt_key','enabler_call_id'])delete m.identity[k];
  const recovery=profile.recoveries?.[key];if(recovery||m.executor_kind==='agent'){const skill=recovery?.skill??m.skill,expected={kind:'agent',entry:recovery?.entry??runtime.entry,sha256:profile.files[recovery?.entry??runtime.entry],skill:{...skill,sha256:profile.files[skill.entry]}};need(same(m.recovery_implementation,expected),'FROZEN_WORKER_RECOVERY');delete m.recovery_implementation;}
 }
 need(digest(profile)===identity.profile_sha256,'FROZEN_PROFILE_DIGEST');return profile;
}
export function validateFrozenProjection({state,frozen}){
 const profile=recoverOriginalPublicProfile(state),cfg=profile.domain_adapter.config,identity={...state.identity,machine_id:state.machine_id??state.identity.machine_id};validatePublicDomainIdentity(identity);
 need(digest(profile)===identity.profile_sha256,'FROZEN_PROFILE_DIGEST');
 const expected=structuredClone(cfg.snapshot),env={...cfg.env},mapping={profile:'P',serial:'SERIAL',line:'LEADGEN_LINE',run_tag:'WFR_TAG',limit:'LEADGEN_LIMIT',source_run:'LEADGEN_SOURCE_RUN',comment_limit:'LEADGEN_COMMENT_LIMIT',sort:'LEADGEN_SORT',time_layer:'LEADGEN_TIME_LAYER',location:'LEADGEN_LOCATION',max_screens:'LEADGEN_MAX_SCREENS',max_attempts:'LEADGEN_DISCOVERY_MAX_ATTEMPTS',collection_budget_s:'QUEUED_VIDEO_COLLECTION_SECONDS'},input=identity.input||{};
 for(const [k,v]of Object.entries(mapping))if(input[k]!==undefined&&input[k]!==null)env[v]=String(input[k]);
 const files={};for(const [name,hash]of Object.entries(profile.files)){need(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(name)&&!name.split('/').some(x=>x==='.'||x==='..')&&/^[a-f0-9]{64}$/.test(hash),'FROZEN_SOURCE_PATH');files['runtime/'+name]=hash;}
 need(Object.hasOwn(profile.files,cfg.step_spec),'FROZEN_STEP_SPEC');files['step-dod.json']=profile.files[cfg.step_spec];
 if(Array.isArray(input.sources)){need(input.sources.length&&input.sources.every(s=>typeof s==='string'&&s.trim()&&!/[\r\n\0]/.test(s)),'FROZEN_SOURCES');files['sources.txt']=digest(input.sources.join('\n')+'\n');}
 for(const key of ['snapshot_sha256','agent_input','execution_transport','native_task_lease'])delete expected[key];
 const start=state.domain_started_at_ms,budget=profile.domain_adapter.budget;need(Number.isSafeInteger(start)&&start>0&&Number.isSafeInteger(budget.max_duration_s)&&Number.isSafeInteger(budget.cleanup_grace_s),'FROZEN_DEADLINES');
 expected.execution_mode='code';expected.files=files;expected.public_domain={protocol:'workflow-domain/v1',run_id:identity.run_id,task_id:identity.task_id,machine_id:identity.machine_id,profile_sha256:identity.profile_sha256,run_binding:identity.run_binding,deadline_ms:start+budget.max_duration_s*1000,cleanup_deadline_ms:start+(budget.max_duration_s+budget.cleanup_grace_s)*1000,company:structuredClone(cfg.company),...(input.upstream?{upstream:structuredClone(input.upstream)}:{})};
 expected.run_identity={capability:cfg.workflow_key,tag:env.WFR_TAG,profile:env.P,serial:env.SERIAL,run_id:identity.run_id};
 for(const key of ['discovery_phone_scope','collection_phone_scope'])if(expected[key])Object.assign(expected[key],{task_id:identity.task_id,run_id:identity.run_id,attempt:'a1',source_commit:expected.deployment.source_commit});
 expected.discovery_input=discoveryInput(env)||undefined;expected.sampling_input=commentSamplingInput(env)||undefined;
 // JSON持久化会移除undefined；使用与正式冻结相同digest和readFrozen。
 const body=JSON.parse(JSON.stringify(expected));need(digest(body)===frozen.snapshot_sha256,'FROZEN_PROJECTION_DIGEST');const {snapshot_sha256,...actual}=frozen;need(same(body,actual),'FROZEN_PROJECTION');return frozen;
}
