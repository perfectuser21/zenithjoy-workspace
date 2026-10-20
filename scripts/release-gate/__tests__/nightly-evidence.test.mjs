import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyNightly} from '../nightly-evidence.mjs';
const now=Date.parse('2026-10-21T00:00:00Z');
function fixture({runs=2,age=12,change=()=>{}}={}){
 const records=Array.from({length:runs},(_,i)=>({id:20-i,head_branch:'main',
  created_at:new Date(now-(age+i*24)*3600000).toISOString(),event:'schedule',status:'completed',
  path:'.github/workflows/nightly-real-machine-staging.yml',repository:{full_name:'perfectuser21/zenithjoy-workspace'}}));
 const jobs=Object.fromEntries(records.map(r=>[r.id,['真微信','真抖音','真安卓'].map(name=>({name:name+' — 实跑',status:'completed',conclusion:'success'}))]));
 change(records,jobs);
 const calls=[],api=path=>{calls.push(path);const match=path.match(/\/runs\/(\d+)\/jobs/);return match?{jobs:jobs[match[1]],total_count:jobs[match[1]].length}:{workflow_runs:records};};
 return {api,calls};
}
test('两次真实job都绿放行且实际查询jobs接口',()=>{
 const f=fixture();assert.equal(verifyNightly({api:f.api,now}).run_ids.length,2);assert.equal(f.calls.filter(p=>p.includes('/jobs')).length,2);
});
for(const prefix of ['真微信','真抖音'])for(const conclusion of ['failure','cancelled','skipped'])test(prefix+conclusion+'阻止发布',()=>{
 const f=fixture({change:(_,j)=>j[19].find(x=>x.name.startsWith(prefix)).conclusion=conclusion});
 assert.throws(()=>verifyNightly({api:f.api,now}));
});
test('真安卓红只产生明确警告，不连坐微信抖音',()=>{
 const f=fixture({change:(_,j)=>j[20][2].conclusion='failure'});
 assert.deepEqual(verifyNightly({api:f.api,now}).android_warning_runs,[20]);
});
test('缺夜间证据或最新超过36小时不能发布',()=>{
 for(const options of [{runs:0},{runs:1},{age:37},{age:-1}])assert.throws(()=>verifyNightly({api:fixture(options).api,now}));
});
test('缺job、错误来源或不完整jobs返回不能发布',()=>{
 for(const change of [(_,j)=>j[20].splice(0,1),r=>r[0].head_branch='feature/x',r=>r[0].created_at='bad',r=>r[0].path='fake.yml']){
  assert.throws(()=>verifyNightly({api:fixture({change}).api,now}));
 }
 const f=fixture();assert.throws(()=>verifyNightly({now,api:path=>{const r=f.api(path);return r.jobs?{...r,total_count:1000}:r;}}));
});
test('公共发布准入保留同版本证据和夜间job检查',()=>{
 const workflow=readFileSync(new URL('../../../.github/workflows/release-admission.yml',import.meta.url),'utf8');
 assert.match(workflow,/nightly-evidence\.mjs/);assert.match(workflow,/staging-evidence\.mjs/);
 const all=readFileSync(new URL('../../../.github/workflows/promote-all-prod.yml',import.meta.url),'utf8');
 assert.match(all,/uses: \.\/\.github\/workflows\/release-admission\.yml/);
});
