import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCompanyReadiness,inspectCompanyReadiness,remoteCompanyInventory} from '../company-config-readiness.mjs';
const columns={tenant_company_profiles:{company_id:'uuid',tenant_id:'uuid',company_key:'text',wiki:'jsonb',runtime_config:'jsonb',config_status:'text',config_version:'integer',source_evidence:'jsonb'},company_config_versions:{company_id:'uuid',tenant_id:'uuid',version:'integer',snapshot:'jsonb'},company_config_runs:{company_id:'uuid',tenant_id:'uuid',run_id:'text',version:'integer',snapshot:'jsonb',task_inputs:'jsonb',source_run:'text'},leadgen_videos:{judgment_config:'jsonb'},leadgen_comments:{judgment_config:'jsonb'}};
const fixture=()=>({columns:Object.entries(columns).flatMap(([table_name,fields])=>Object.entries(fields).map(([column_name,data_type])=>({table_name,column_name,data_type}))),indexes:[{tablename:'company_config_runs',indexdef:'CREATE UNIQUE INDEX run_key ON zenithjoy.company_config_runs (company_id, run_id)'}],triggers:['immutable_company_run','immutable_company_version'].map(tgname=>({tgname,tgenabled:'O'})),profiles:[]});
test('缺迁移在任何profile读取前拒绝，不产生数据库写入',async()=>{
 const sql=[];await assert.rejects(()=>inspectCompanyReadiness({query:async q=>{sql.push(q);return{rows:[]}}}),/COMPANY_SCHEMA_NOT_READY.*company_config_runs/);
 assert.ok(sql.every(q=>q.startsWith('SELECT')));assert.ok(!sql.some(q=>q.includes('SELECT p.company_id')));
});
test('草稿允许schema通过但显式报告八个禁用业务缺口，不能算公司业务绿',()=>{
 const result=evaluateCompanyReadiness(fixture());assert.equal(result.schema_verified,true);assert.equal(result.business_runtime_status,'disabled');assert.equal(result.gaps.length,8);assert.ok(result.workflows.every(w=>!w.enabled));
 assert.throws(()=>evaluateCompanyReadiness(fixture(),{requireEnabled:['jinuo']}),/COMPANY_BUSINESS_NOT_READY/);
});
test('缺task_inputs、错误jsonb类型、无唯一运行键、无不可变守卫分别硬拒',()=>{
 for(const mutate of [x=>x.columns=x.columns.filter(c=>c.column_name!=='task_inputs'),x=>x.columns.find(c=>c.column_name==='wiki').data_type='text',x=>x.indexes=[],x=>x.triggers[0].tgenabled='D']) {
  const f=fixture();mutate(f);assert.throws(()=>evaluateCompanyReadiness(f),/COMPANY_SCHEMA_NOT_READY/);
 }
});
test('只读MMV探针不使用新模块或执行迁移，不依赖尚未安装的配置代码',async()=>{
 let script;const result=await remoteCompanyInventory({execute:async input=>{script=input;return fixture()}});
 assert.ok(result.columns.length);assert.match(script,/leadgen-db-connect.js/);assert.doesNotMatch(script,/CREATE TABLE|ALTER TABLE|UPDATE |INSERT |DELETE |require\('.\/company-config-lib/);
});
test('正式deploy入口在任何admission写或控制器安装前执行数据库就绪守卫',async()=>{
 const {readFileSync}=await import('node:fs');
 const shell=readFileSync(new URL('../deploy.sh',import.meta.url),'utf8');
 const gate=shell.indexOf('node "$D/company-config-readiness.mjs"');
 assert.ok(gate>0);assert.ok(gate<shell.indexOf('\ncommander_admission\n'));
 assert.ok(gate<shell.indexOf('for f in "${MMV_JS_FILES[@]}"; do'));
 const code=readFileSync(new URL('../company-config-readiness.mjs',import.meta.url),'utf8');assert.match(code,/process.exitCode=1/);assert.match(code,/business_runtime_status/);
});
