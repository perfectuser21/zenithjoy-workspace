'use strict';
const { routeOf } = require('./line-routes.js');
const { isDeepStrictEqual } = require('node:util');

function missing(field) { throw new Error(`COMPANY_CONFIG_MISSING: ${field}`); }
function configTargetProfile(snapshot, step) {
  if (!snapshot?.company_id || !snapshot?.tenant_id || !snapshot?.version) missing('company/tenant/version');
  const wiki = snapshot.wiki || {};
  if (!Array.isArray(wiki.products) || !wiki.products.length) missing('wiki.products');
  if (!Array.isArray(wiki.audiences) || !wiki.audiences.length) missing('wiki.audiences');
  const field = String(step) === '103' ? 'comment_scoring' : 'video_judgment';
  const policy = snapshot.runtime_config?.[field];
  if (!policy || !Object.keys(policy).length) missing(field);
  if (field === 'comment_scoring' && (!policy.criteria || !['A','B','C','不相关'].every(k=>typeof policy.criteria[k]==='string' && policy.criteria[k].trim()) || !Number.isFinite(policy.confidence_threshold) || policy.confidence_threshold<0 || policy.confidence_threshold>1)) missing('comment_scoring.criteria/confidence_threshold');
  return JSON.stringify({company_id:snapshot.company_id,company_key:snapshot.company_key,company_name:snapshot.company_name,version:snapshot.version,wiki,policy,source_evidence:snapshot.source_evidence});
}
function runtimeSnapshot(snapshot, step) {
  const result = structuredClone(snapshot);
  result.product_ids = (result.wiki?.products || []).map(p=>p.id).filter(Boolean);
  result.policy_id = result.runtime_config?.policy_id;
  if (!result.policy_id) missing('policy_id');
  if (['102','103'].includes(String(step))) configTargetProfile(result,step);
  if (String(step)==='101' && !result.runtime_config?.search_strategy) missing('search_strategy');
  if (String(step)==='104') {
    const rules=result.runtime_config?.contact_rules;
    const route=routeOf(result.runtime_config?.routing?.line_key);
    if (rules?.status!=='verified' || rules.ssot!=='feishu' || rules.feishu_base!==route.base || rules.orders_table!==route.lead || rules.approved_scripts_table!==route.script) missing('contact_rules: 原飞书订单/批准话术映射未核验');
    if (!Array.isArray(result.runtime_config.platform_accounts) || !result.runtime_config.platform_accounts.some(account=>account.verification_status==='verified' && account.enabled && account.profile && account.douyin_id && account.device_serial)) missing('platform_accounts: 真实账号/设备未核验');
  }
  return result;
}
async function freezeCompanyConfig(pool, {lineHint,runId,step,sourceRun,taskInputs}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(runId || '')) throw new Error('COMPANY_RUN_ID_MISSING');
  if (sourceRun && (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(sourceRun) || sourceRun===runId)) throw new Error('COMPANY_SOURCE_RUN_INVALID');
  if (taskInputs!==undefined && (!taskInputs || typeof taskInputs!=='object' || Array.isArray(taskInputs) || Buffer.byteLength(JSON.stringify(taskInputs),'utf8')>65536)) throw new Error('COMPANY_TASK_INPUTS_INVALID');
  const lineKey=routeOf(lineHint).key;
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const rows=(await client.query(`SELECT company_id FROM zenithjoy.tenant_company_profiles WHERE runtime_config->'routing'->>'line_key'=$1 FOR SHARE`,[lineKey])).rows;
    if (rows.length!==1) throw new Error('COMPANY_MAPPING_MISSING: '+lineKey);
    const companyId=rows[0].company_id;
    const previous=(await client.query('SELECT snapshot,task_inputs,source_run FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=$2',[companyId,runId])).rows[0];
    const verifyInputs=row=>{
      if (taskInputs!==undefined && !isDeepStrictEqual(row.task_inputs || {},taskInputs)) throw new Error('COMPANY_TASK_INPUTS_CHANGED');
      if (sourceRun!==undefined && (row.source_run || null)!==(sourceRun || null)) throw new Error('COMPANY_SOURCE_RUN_CHANGED');
    };
    if (previous) {verifyInputs(previous);const out=runtimeSnapshot(previous.snapshot,step);await client.query('COMMIT');return out;}
    let version;
    if (sourceRun) {
      version=(await client.query('SELECT snapshot FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=$2',[companyId,sourceRun])).rows[0];
      if (!version) throw new Error('COMPANY_SOURCE_CONFIG_MISSING: '+sourceRun);
    } else {
      const profile=(await client.query('SELECT * FROM zenithjoy.tenant_company_profiles WHERE company_id=$1 FOR SHARE',[companyId])).rows[0];
      if (profile?.config_status!=='enabled') throw new Error('COMPANY_CONFIG_NOT_ENABLED: '+lineKey);
      version=(await client.query('SELECT snapshot FROM zenithjoy.company_config_versions WHERE company_id=$1 AND version=$2 AND tenant_id=$3',[companyId,profile.config_version,profile.tenant_id])).rows[0];
      if (!version) throw new Error('COMPANY_CONFIG_VERSION_MISSING');
    }
    if (version.snapshot.config_status!=='enabled') throw new Error('COMPANY_CONFIG_NOT_ENABLED: snapshot');
    runtimeSnapshot(version.snapshot,step);
    const inserted=(await client.query(`INSERT INTO zenithjoy.company_config_runs(company_id,run_id,version,tenant_id,snapshot,task_inputs,source_run) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) ON CONFLICT(company_id,run_id) DO NOTHING RETURNING snapshot,task_inputs,source_run`,[companyId,runId,version.snapshot.version,version.snapshot.tenant_id,JSON.stringify(version.snapshot),JSON.stringify(taskInputs || {}),sourceRun || null])).rows[0];
    const frozen=inserted || (await client.query('SELECT snapshot,task_inputs,source_run FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=$2',[companyId,runId])).rows[0];
    if (!frozen) throw new Error('COMPANY_FREEZE_FAILED');
    verifyInputs(frozen);
    const out=runtimeSnapshot(frozen.snapshot,step);
    await client.query('COMMIT');return out;
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
}
// 来源授权只能读既有102快照；禁止用freezeCompanyConfig为旧评论补造来源。
async function readCollectionAccountBinding(pool,{lineKey,run,sourceRun}) {
  const fail=()=>{throw Error('COMPANY_COLLECTION_BINDING_INVALID');};
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(run||''))fail();
  const rows=(await pool.query(`SELECT company_id,tenant_id,version,run_id,source_run,snapshot,task_inputs
    FROM zenithjoy.company_config_runs WHERE run_id=$1
    AND snapshot->'runtime_config'->'routing'->>'line_key'=$2`,[run,lineKey])).rows;
  if(rows.length!==1)fail();
  const row=rows[0],s=row.snapshot,pick=row.task_inputs?.device_binding;
  if(!s||row.run_id!==run||(sourceRun!==undefined&&(row.source_run||null)!==(sourceRun||null))
    ||!s.company_id||!s.tenant_id||!Number.isSafeInteger(s.version)||s.version<1
    ||row.company_id!==s.company_id||row.tenant_id!==s.tenant_id||Number(row.version)!==s.version
    ||s.config_status!=='enabled'||s.runtime_config?.routing?.line_key!==lineKey
    ||!pick||Object.keys(pick).sort().join(',')!=='device_serial,profile'
    ||typeof pick.profile!=='string'||!pick.profile||typeof pick.device_serial!=='string'||!pick.device_serial)fail();
  const routing=s.runtime_config.routing.profiles,accounts=s.runtime_config.platform_accounts;
  const matches=Array.isArray(accounts)?accounts.filter(a=>a?.profile===pick.profile):[];
  const a=matches[0];
  if(!Array.isArray(routing)||routing.filter(p=>p===pick.profile).length!==1||matches.length!==1
    ||a.enabled!==true||a.verification_status!=='verified'||a.device_serial!==pick.device_serial
    ||a.company_id!==s.company_id||a.tenant_id!==s.tenant_id||a.platform!=='douyin'
    ||typeof a.douyin_id!=='string'||!a.douyin_id||a.douyin_id.trim()!==a.douyin_id)fail();
  return {company_id:s.company_id,tenant_id:s.tenant_id,version:s.version,run_id:run,line_key:lineKey,
    source_run:row.source_run||null,profile:a.profile,device_serial:a.device_serial,douyin_id:a.douyin_id,verification_status:'verified',enabled:true};
}
module.exports={freezeCompanyConfig,configTargetProfile,runtimeSnapshot,readCollectionAccountBinding};
