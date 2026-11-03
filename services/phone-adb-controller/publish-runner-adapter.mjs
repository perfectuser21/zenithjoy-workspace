/** 发布只提供固定Activity实现映射；执行循环/判定/Commander/记录由公共Runner持有。 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=reason=>{throw Error(reason);};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const routes={done:'next',retry:'stop',failed:'stop',empty:'stop',partial:'stop',needs_review:'pause'};
export function buildPublishProfile({cwd,contract,definition,activityBindings,implementations={},components=[],commander,files:closure={}}={}){
 const activities=[...(contract?.activities??[])].sort((a,b)=>a.order-b.order);
 if(!activities.length||activities.some(a=>!implementations[a.key]?.executor||!implementations[a.key]?.validator||!implementations[a.key]?.precondition))fail('publish_activity_binding_required');
 if(!path.isAbsolute(cwd??'')||!definition||!activityBindings||new Set(activities.map(a=>a.key)).size!==activities.length)fail('publish_profile_source_required');
 const root=fs.realpathSync(cwd),files={...closure},metadata={},validators={},preconditions={};
 const pinned=(binding)=>{
  if(!binding||typeof binding.entry!=='string'||path.isAbsolute(binding.entry)||binding.entry.split('/').includes('..')||!/^([a-f0-9]{64})$/.test(binding.sha256??''))fail('publish_source_binding_invalid');
  const full=fs.realpathSync(path.join(root,binding.entry));
  if(!full.startsWith(root+path.sep)||hash(fs.readFileSync(full))!==binding.sha256)fail('publish_source_changed');
  if(!components.some(c=>c.path===binding.entry&&c.digest===`sha256:${binding.sha256}`&&/^[a-f0-9]{40}$/.test(c.revision??'')))fail('publish_source_not_frozen');
  files[binding.entry]=binding.sha256;
  return {entry:binding.entry,...(binding.argv?{argv:binding.argv}:{}),...(binding.timeout_s?{timeout_s:binding.timeout_s}:{})};
 };
 const mapped=activities.map((a,index)=>{
  const implementation=implementations[a.key],b=activityBindings.find(b=>b.key===a.key);
  if(!b||![b.reference_id,b.activity_id,b.activity_definition_version_id,definition.workflow_id,definition.workflow_definition_version_id].every(id=>UUID.test(id??'')))fail('publish_formal_identity_required');
  if(!['code','agent'].includes(implementation.executor.kind))fail('publish_executor_kind_required');
  const executor=pinned(implementation.executor),validator=pinned(implementation.validator),precondition=pinned(implementation.precondition);
  if(implementation.validator.entry===implementation.executor.entry)fail('publish_validator_must_be_independent');
  const questions=implementation.questions;
  if(!['A1','A2','A3','A4','A5','A6','B1'].every(key=>questions?.[key]?.ref&&questions[key].version&&questions[key].declared!=null))fail('publish_questions_required');
  let skill;if(implementation.executor.kind==='agent'){const s=implementation.executor.skill;if(!s?.version)fail('publish_skill_version_required');pinned(s);skill={entry:s.entry,version:s.version};}
  metadata[a.key]={activity_id:b.activity_id,executor_kind:implementation.executor.kind,questions,...(skill?{skill}:{}),identity:{identity_protocol:2,workflow_id:definition.workflow_id,workflow_definition_version_id:definition.workflow_definition_version_id,reference_id:b.reference_id,activity_definition_version_id:b.activity_definition_version_id}};
  validators[a.key]={...validator,acceptance:{ref:questions.A4.ref}};preconditions[a.key]={...precondition,acceptance:{ref:questions.A2.ref}};
  return {key:a.key,order:index+1,budget:{max_duration_s:Math.min(a.budget?.max_duration_s??600,3600),heartbeat_s:a.budget?.heartbeat_s??60},failure:{empty_ok:[],retryable:[],fatal:['publish_activity_failed'],needs_human:{cases:['unverified']}},runtime:{...executor,protocol:'json-stdio-v1',phase:a.key==='cleanup'?'finalize':'source',executor_kind:implementation.executor.kind,max_attempts:1,retry_safe:false,recovery_safe:false,on_status:routes}};
 });
 for(const key of ['workflow','cleanup']){if(!implementations[key]?.validator)fail('publish_workflow_validator_required');const v=implementations[key].validator;if(!v.acceptance?.ref)fail('publish_workflow_acceptance_required');validators[key]={...pinned(v),acceptance:v.acceptance};}
 if(commander){pinned(commander.skill);}
 // Verify the complete imported executor/helper closure too, not only top-level entries.
 for(const [entry,digest]of Object.entries(files)){const full=fs.realpathSync(path.join(root,entry));if(path.isAbsolute(entry)||entry.split('/').includes('..')||!full.startsWith(root+path.sep)||hash(fs.readFileSync(full))!==digest)fail('publish_source_changed');}
 return {cwd:root,files,resources:[contract.resources],cleanup_required:true,contract:{workflow:contract.workflow,on_status:routes,activities:mapped},metadata,validators,preconditions,brief:{purpose:contract.name,done_criteria:contract.verification?.criteria,boundaries:{resources:contract.resources,publish_attempts:1,privacy:'private'}},rules:['执行顺序来自冻结Activity文件','未知发布效果只读回，禁止重发','Commander仅观察与指导，独立validator判定','同task/run精确owner锁，停止未知时隔离'],...(commander?{commander:{kind:'openclaw',skill:{entry:commander.skill.entry,version:commander.skill.version},budget:commander.budget??{max_steers:3,max_recovery_turns:0}}}:{})};
}
