import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {freezeCompanyConfig}=require('../company-config-lib.js');
// 独立scratch事务，真实迁移/外键/不可变约束；不写生产，也不遗留测试记录。
test('Postgres公司隔离、幂等快照、跨版本恢复、不可变约束',{skip:!process.env.COMPANY_CONFIG_SCRATCH_URL},async()=>{
 const {Pool}=require('pg');const p=new Pool({connectionString:process.env.COMPANY_CONFIG_SCRATCH_URL});
 const c=await p.connect();
 const nested={connect:async()=>({query:(sql,args)=>c.query(sql==='BEGIN'?'SAVEPOINT company_freeze':sql==='COMMIT'?'RELEASE SAVEPOINT company_freeze':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT company_freeze':sql,args),release(){}})};
 try {
  assert.equal((await c.query('SELECT current_database() AS db')).rows[0].db,'cecelia_scratch','只能迁移本地scratch');
  await c.query('BEGIN');
  await c.query('CREATE SCHEMA IF NOT EXISTS zenithjoy');
  await c.query('CREATE TABLE IF NOT EXISTS zenithjoy.tenants(id uuid PRIMARY KEY,name text NOT NULL)');
  await c.query('CREATE TABLE IF NOT EXISTS zenithjoy.leadgen_videos(video_id text PRIMARY KEY)');
  await c.query('CREATE TABLE IF NOT EXISTS zenithjoy.leadgen_comments(id uuid PRIMARY KEY)');
  await c.query(await readFile(new URL('../../../apps/api/db/migrations/20260628_line02_tenant_company_profiles.sql',import.meta.url),'utf8'));
  await c.query(await readFile(new URL('../../../apps/api/db/migrations/20261013_170000_company_wiki_config.sql',import.meta.url),'utf8'));
  const {inspectCompanyReadiness}=await import('../company-config-readiness.mjs');
  const readiness=await inspectCompanyReadiness(c);
  assert.equal(readiness.schema_verified,true);assert.equal(readiness.business_runtime_status,'disabled');
  assert.equal(readiness.gaps.length,8,'空公司配置不能让业务报绿');
  for(const [line,key,tenant,company] of [['jinuo','test-a','aaaaaaaa-1111-2222-3333-444444444444','11111111-1111-4111-8111-111111111111'],['yuesheng','test-b','bbbbbbbb-1111-2222-3333-444444444444','22222222-2222-4222-8222-222222222222']]){
   await c.query('INSERT INTO zenithjoy.tenants(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[tenant,key]);
   const snapshot={company_id:company,tenant_id:tenant,company_key:key,version:1,config_status:'enabled',wiki:{products:[{id:key,name:key+'产品'}],audiences:[key+'客群']},runtime_config:{routing:{line_key:line},policy_id:key,video_judgment:{instructions:key+'规则'}},source_evidence:[{source:'integration'}]};
   await c.query("INSERT INTO zenithjoy.tenant_company_profiles(tenant_id,company_id,company_key,company_name,config_status,runtime_config) VALUES($1,$2,$3,$3,'enabled',$4)",[tenant,company,key,JSON.stringify(snapshot.runtime_config)]);
   await c.query('INSERT INTO zenithjoy.company_config_versions(company_id,version,tenant_id,snapshot,actor) VALUES($1,1,$2,$3,$4)',[company,tenant,JSON.stringify(snapshot),'integration']);
  }
  const first=await freezeCompanyConfig(nested,{lineHint:'jinuo',runId:'restore',step:'102'});
  const other=await freezeCompanyConfig(nested,{lineHint:'yuesheng',runId:'restore',step:'102'});
  assert.notEqual(first.company_id,other.company_id);assert.notEqual(first.tenant_id,other.tenant_id);
  const v2={...first,version:2,runtime_config:{...first.runtime_config,video_judgment:{instructions:'新版规则'}}};
  await c.query('INSERT INTO zenithjoy.company_config_versions(company_id,version,tenant_id,snapshot,actor) VALUES($1,2,$2,$3,$4)',[first.company_id,first.tenant_id,JSON.stringify(v2),'integration']);
  await c.query('UPDATE zenithjoy.tenant_company_profiles SET config_version=2 WHERE company_id=$1',[first.company_id]);
  assert.equal((await freezeCompanyConfig(nested,{lineHint:'jinuo',runId:'restore',step:'102'})).version,1);
  assert.equal((await freezeCompanyConfig(nested,{lineHint:'jinuo',runId:'new-run',step:'102'})).version,2);
  assert.equal(Number((await c.query('SELECT count(*) FROM zenithjoy.company_config_runs WHERE company_id=$1',[first.company_id])).rows[0].count),2);
  assert.equal((await freezeCompanyConfig(nested,{lineHint:'jinuo',runId:'next-step',sourceRun:'restore',step:'102'})).version,1,'101到102继承上游版本');
  await assert.rejects(freezeCompanyConfig(nested,{lineHint:'jinuo',runId:'bad-upstream',sourceRun:'does-not-exist',step:'102'}),/COMPANY_SOURCE_CONFIG_MISSING/);
  await freezeCompanyConfig(nested,{lineHint:'jinuo',runId:'task-input',step:'102',taskInputs:{keywords:['考证']}});
  await assert.rejects(freezeCompanyConfig(nested,{lineHint:'jinuo',runId:'task-input',step:'102',taskInputs:{keywords:['企业AI']}}),/COMPANY_TASK_INPUTS_CHANGED/);
  await assert.rejects(freezeCompanyConfig(nested,{lineHint:'jinuo',runId:'--help',step:'102'}),/COMPANY_RUN_ID_MISSING/);
  await c.query('SAVEPOINT immutable_check');
  await assert.rejects(c.query('INSERT INTO zenithjoy.company_config_versions(company_id,version,tenant_id,snapshot,actor) VALUES($1,99,$2,$3,$4)',[first.company_id,first.tenant_id,JSON.stringify({company_id:first.company_id,tenant_id:first.tenant_id}),'integration']),/company_version_snapshot_shape/);
  await c.query('ROLLBACK TO SAVEPOINT immutable_check');
  await assert.rejects(c.query('UPDATE zenithjoy.company_config_runs SET version=2 WHERE company_id=$1',[first.company_id]),/immutable/);
  await c.query('ROLLBACK TO SAVEPOINT immutable_check');
 } finally {await c.query('ROLLBACK');c.release();await p.end();}
});
