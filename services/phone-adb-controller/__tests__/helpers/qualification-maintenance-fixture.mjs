import {createHash} from 'node:crypto';
export function digest(value) {
  const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}
export function authorityFixture() {
  const originalId='e62fd171-1379-4acd-a4a7-ee75c36620cb';
  const maintenanceId='11111111-1111-4111-8111-111111111111';
  const project='67bd1fc3-3027-4f13-83c8-c656e3408bfc';
  const scope={schema_version:1,program:'353-qualification-upload-failure-v1',
    intent_id:'22222222-2222-4222-8222-222222222222',original_task_id:originalId,
    original_actor:'codex:business-acceptance-executor',
    run_tag:'cicd353b_102_pending_20261028_e62fd171',attempt:'a1',
    binding_id:'2ecee337-bb8e-4930-a704-03aeddb38b68',
    consumer_source:'353b910f11ce3852b2ef69c8ead5c37e97850b4a',
    host:'xian-m4',profile:'legacy',serial:'ANGYVB4402004137',line_key:'jinuo',
    company_id:'ef8e14b0-4018-4e54-bc7a-866e51a0ce0b',
    tenant_id:'a4ca8914-f5a7-4928-b1e3-6b69f9c0ab61',config_version:14,
    policy_id:'jinoshengyuan-existing-acquisition-rules-v1',
    video_ids:['7689863996204591985'],
    producer_run:'cicdbeb_101_attempt2_20261027_a2dcb023',
    snapshot_sha256:'92f5d6647838acf8a2edb322cd74dea7a7fe71ae1dd34903b739112d654a7afc',
    central_owner:originalId,local_owner:'cicd353b_102_pending_20261028_e62fd171',
    maintenance_source:{commit:'c'.repeat(40),environment:'staging:'+ 'c'.repeat(40),
      releases:{mmv:{id:'33333333-3333-4333-8333-333333333333',observation_id:'55555555-5555-4555-8555-555555555555',manifest_raw_sha256:'a'.repeat(64)},
        'xian-m4':{id:'44444444-4444-4444-8444-444444444444',observation_id:'66666666-6666-4666-8666-666666666666',manifest_raw_sha256:'b'.repeat(64)}}},
    actions:['preflight','return_pending_claim','release_resources','readback','renew-original-lease']};
  const payload={work_kind:'operations',operational_mutation:true,read_only:false,
    tenant_id:'default',resources:{devices:[scope.serial]},allowed_video_ids:[...scope.video_ids]};
  const originalTask={id:originalId,status:'in_progress',claimed_by:scope.original_actor,
    task_type:'data',domain:'operations',project_id:project,parent_task_id:'8eab51cd-edef-47ea-a75d-6151858f1aec',
    payload:structuredClone(payload),result:{}};
  const maintenanceTask={id:maintenanceId,status:'in_progress',claimed_by:'codex:qualification-maintenance-executor',
    task_type:'data',domain:'operations',project_id:project,parent_task_id:originalId,
    payload:structuredClone(payload),result:{qualification_maintenance:scope}};
  originalTask.result.qualification_maintenance_delegation={schema_version:1,
    maintenance_task_id:maintenanceId,actor:maintenanceTask.claimed_by,
    delegator_actor:originalTask.claimed_by,contract_sha256:digest(scope),
    central_owner:scope.central_owner,local_owner:scope.local_owner,
    actions:[...scope.actions]};
  return {originalTask,maintenanceTask,scope};
}
