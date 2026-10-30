'use strict';

// 唯一旧半提交评论的受控重评：新双审失败时原行完整回滚，不清空历史评分。
const scope=Object.freeze({
  line:'jinuo',
  comment_id:'1f3b113f-442f-425b-83b4-6c737c30a68c',
  source_run:'accept3a903_jinuo102d_20261030t0245',
  old_run:'accept4da3_jinuo103h_20261030t1525',
  maintenance_task_id:'ef3927ba-1f9c-40ec-b1fa-53a8f7106ee6',
  project_id:'68ca6b4f-5e53-4ccf-a2aa-874e5c32bbe6',
  actor:'interactive-leadgen-103-double-policy',
});
const fail=()=>{throw Error('POLICY_SCORE_LEGACY_RECOVERY_SCOPE_INVALID');};
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;

function validate(input,lineKey,sourceRun){
  const request=input.legacy_recovery;
  if(!request)return false;
  if(Object.keys(request).sort().join(',')!=='comment_id,maintenance_task_id,old_run'
    ||lineKey!==scope.line||sourceRun!==scope.source_run
    ||request.comment_id!==scope.comment_id||request.old_run!==scope.old_run
    ||request.maintenance_task_id!==scope.maintenance_task_id
    ||input.limit!==1||input.budget_max!==1||input.ids?.length!==1||input.ids[0]!==scope.comment_id)
    fail();
  return true;
}

async function readTask(){
  const response=await fetch(`http://localhost:5221/api/brain/tasks/${scope.maintenance_task_id}`,
    {signal:AbortSignal.timeout(5000)});
  if(!response.ok)fail();
  const body=await response.json();return body.task||body;
}

async function verify(client,row,snapshot,deps={}){
  const task=await (deps.readRecoveryTask||readTask)();
  if(task?.id!==scope.maintenance_task_id||task.status!=='in_progress'
    ||task.claimed_by!==scope.actor||task.project_id!==scope.project_id)fail();
  const config=row?.judgment_config;
  if(row?.id!==scope.comment_id||row.line_key!==scope.line||row.harvest_batch!==scope.source_run
    ||row.process_status!=='待分拣'||row.relevance!=='相关'||row.intent_grade!=='A'
    ||config?.run_id!==scope.old_run||config.company_id!==snapshot.company_id
    ||config.tenant_id!==snapshot.tenant_id||Number(config.version)!==14
    ||Number(config.version)!==Number(snapshot.version)||config.policy_id!==snapshot.policy_id
    ||config.policy_audit?.status!=='pass'||!config.policy_audit?.response_id
    ||!config.model_audit?.model||!config.model_audit?.response_id
    ||config.policy_reviews!==undefined)fail();
  const frozen=(await client.query(`SELECT company_id,tenant_id,version,run_id,snapshot
    FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=$2`,
  [snapshot.company_id,scope.old_run])).rows;
  const old=frozen[0];
  if(frozen.length!==1||old.run_id!==scope.old_run||old.company_id!==snapshot.company_id
    ||old.tenant_id!==snapshot.tenant_id||Number(old.version)!==14
    ||old.snapshot?.policy_id!==snapshot.policy_id
    ||JSON.stringify(stable(old.snapshot.runtime_config?.comment_scoring))!==JSON.stringify(stable(snapshot.runtime_config?.comment_scoring)))fail();
  const outbox=(await client.query(`SELECT id FROM zenithjoy.leadgen_bridge_outbox
    WHERE line_key=$1 AND comment_id=$2 LIMIT 1`,[scope.line,scope.comment_id])).rows;
  if(outbox.length)fail();
}

module.exports={scope,validate,verify};
