import {digest} from './runtime-definition.mjs';
import {SUPPORTED_QUALIFICATION_SOURCE} from './qualification-maintenance-evidence.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha=/^[a-f0-9]{64}$/,commit=/^[a-f0-9]{40}$/,tag=/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const actions=['preflight','return_pending_claim','release_resources','readback','renew-original-lease'];
const scopeKeys=new Set(['schema_version','program','intent_id','original_task_id','original_actor','run_tag','attempt','binding_id','consumer_source',
  'host','profile','serial','line_key','company_id','tenant_id','config_version','policy_id','video_ids','producer_run','snapshot_sha256',
  'central_owner','local_owner','maintenance_source','actions','original_evidence','maintenance_deadline_ms']);
const need=(value,code='AUTHORITY')=>{if(!value)throw Error('MAINTENANCE_'+code);};
const same=(left,right)=>digest(left)===digest(right);
function operationalTask(task) {
  return task?.task_type==='data'&&task.domain==='operations'&&task.status==='in_progress'
    &&typeof task.claimed_by==='string'&&task.claimed_by.length>0&&uuid.test(task.id||'')
    &&task.payload?.work_kind==='operations'&&task.payload.operational_mutation===true&&task.payload.read_only===false;
}
function candidate(value) {
  need(value&&Object.keys(value).sort().join(',')==='commit,environment,releases'
    &&commit.test(value.commit||'')&&value.commit!==SUPPORTED_QUALIFICATION_SOURCE
    &&value.environment==='staging:'+value.commit,'SOURCE');
  need(value.releases&&Object.keys(value.releases).sort().join(',')==='mmv,xian-m4','SOURCE');
  for(const target of ['mmv','xian-m4']) {
    const r=value.releases[target];
    need(r&&Object.keys(r).sort().join(',')==='id,manifest_raw_sha256,observation_id'
      &&uuid.test(r.id||'')&&uuid.test(r.observation_id||'')&&sha.test(r.manifest_raw_sha256||''),'SOURCE');
  }
}
function validateScope(scope) {
  need(scope&&typeof scope==='object'&&!Array.isArray(scope)&&Object.keys(scope).every(key=>scopeKeys.has(key)),'SCOPE');
  need(scope.schema_version===1&&scope.program==='353-qualification-upload-failure-v1'
    &&uuid.test(scope.intent_id||'')&&uuid.test(scope.original_task_id||'')
    &&scope.consumer_source===SUPPORTED_QUALIFICATION_SOURCE,'SOURCE');
  need(tag.test(scope.run_tag||'')&&scope.attempt==='a1'&&uuid.test(scope.binding_id||'')
    &&scope.host==='xian-m4'&&tag.test(scope.profile||'')&&/^[A-Za-z0-9_.:-]{1,200}$/.test(scope.serial||'')
    &&tag.test(scope.line_key||'')&&uuid.test(scope.company_id||'')&&uuid.test(scope.tenant_id||'')
    &&Number.isSafeInteger(scope.config_version)&&scope.config_version>0
    &&typeof scope.policy_id==='string'&&scope.policy_id.length>0&&tag.test(scope.producer_run||'')
    &&sha.test(scope.snapshot_sha256||'')&&scope.central_owner===scope.original_task_id
    &&scope.local_owner===scope.run_tag&&typeof scope.original_actor==='string'&&scope.original_actor.length>0,'SCOPE');
  need(Array.isArray(scope.video_ids)&&scope.video_ids.length===1&&/^\d{16,24}$/.test(scope.video_ids[0])
    &&same(scope.actions,actions),'SCOPE');
  candidate(scope.maintenance_source);
}
function resourceScope(task,scope,source) {
  need(same(task.payload.resources?.devices,[scope.serial])&&same(task.payload.allowed_video_ids,scope.video_ids),'SCOPE');
  for(const [key,expected]of [['source_run',scope.producer_run],['device_serial',scope.serial],['expected_candidate_sha',source]]) {
    if(Object.hasOwn(task.payload,key))need(task.payload[key]===expected,'SCOPE');
  }
  // payload.tenant_id是Brain路由默认，不是业务公司的tenant真身。
}

// 这里只验证正规Task/委托的绑定；不把授权等同于effects已闭合或允许写PG。
export function authorizeMaintenance({maintenanceTask,originalTask}) {
  need(operationalTask(maintenanceTask)&&operationalTask(originalTask)&&maintenanceTask.id!==originalTask.id);
  const scope=maintenanceTask.result?.qualification_maintenance;
  validateScope(scope);
  need(scope.original_task_id===originalTask.id&&scope.original_actor===originalTask.claimed_by
    &&uuid.test(maintenanceTask.project_id||'')&&maintenanceTask.project_id===originalTask.project_id
    &&[originalTask.id,originalTask.parent_task_id].includes(maintenanceTask.parent_task_id));
  resourceScope(maintenanceTask,scope,scope.maintenance_source.commit);resourceScope(originalTask,scope,scope.consumer_source);
  const delegation=originalTask.result?.qualification_maintenance_delegation;
  need(delegation&&Object.keys(delegation).sort().join(',')==='actions,actor,central_owner,contract_sha256,delegator_actor,local_owner,maintenance_task_id,schema_version'
    &&delegation.schema_version===1&&delegation.maintenance_task_id===maintenanceTask.id
    &&delegation.actor===maintenanceTask.claimed_by&&delegation.delegator_actor===originalTask.claimed_by
    &&delegation.contract_sha256===digest(scope)&&delegation.central_owner===scope.central_owner
    &&delegation.local_owner===scope.local_owner&&same(delegation.actions,scope.actions));
  return {scope:structuredClone(scope),contract_sha256:digest(scope),maintenance_task_id:maintenanceTask.id,
    actor:maintenanceTask.claimed_by,original_actor:originalTask.claimed_by,original_task_id:originalTask.id};
}
