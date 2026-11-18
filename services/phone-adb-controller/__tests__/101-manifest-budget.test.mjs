import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {create101BudgetCandidate} from '../workflow-101-manifest-budget.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const old={task_id:id(1),run_id:id(2),run_tag:'old101'},identity={task_id:id(3),run_id:id(4),run_tag:'new101'};
const template=()=>({run:{...old,deadline_ms:4600000,cleanup_deadline_ms:5200000,input:{tasks:{101:old},run_tag:old.run_tag,business_deadline_ms:4600000,cleanup_deadline_ms:5200000},contract:{workflow:'douyin-leadgen-101',activities:[{key:'preflight',budget:{max_duration_s:900}},{key:'collect_videos',budget:{max_duration_s:1800}},{key:'cleanup',budget:{max_duration_s:600}}]}},profile:{cwd:'/candidate',files:{'context.json':'a'.repeat(64)}}});
const options=()=>({identity,startedAtMs:1000000,task:{id:identity.task_id,payload:{scope:{}}}});
test('101新候选总40分钟含原cleanup；run/input/context一致且旧模板和activity契约不变',()=>{
 const source=template(),before=structuredClone(source),candidate=create101BudgetCandidate(source,options());
 assert.equal(candidate.status,'not_started');assert.equal(candidate.registered,false);
 assert.equal(candidate.manifest.run.deadline_ms,2800000);assert.equal(candidate.manifest.run.cleanup_deadline_ms,3400000);
 assert.equal(candidate.context.business_deadline_ms,2800000);assert.equal(candidate.context.cleanup_deadline_ms,3400000);
 assert.equal(candidate.context.run_max_seconds,2400);assert.equal(candidate.context.run_start_ts,1000);
 assert.deepEqual(candidate.context.tasks['101'],identity);assert.equal(candidate.manifest.run.task_id,identity.task_id);assert.equal(candidate.manifest.run.run_id,identity.run_id);
 assert.equal(candidate.manifest.profile.files['context.json'],createHash('sha256').update(candidate.contextBytes).digest('hex'));
 assert.deepEqual(candidate.manifest.run.input,candidate.context);assert.deepEqual(candidate.manifest.run.contract,before.run.contract);assert.deepEqual(source,before);
 assert.equal(candidate.task_scope.run_max_seconds,2400);assert.equal(candidate.context.local_owner,'wf101'+identity.run_id.replaceAll('-',''));assert.equal(candidate.context.central_owner,identity.task_id);
});
test('显式Task总预算优先且包含收尾；非法/旧身份/其它流程不能生成新候选',()=>{
 const explicit=options();explicit.task.payload.scope.run_max_seconds=1800;
 const candidate=create101BudgetCandidate(template(),explicit);assert.equal(candidate.manifest.run.deadline_ms,2200000);assert.equal(candidate.manifest.run.cleanup_deadline_ms,2800000);
 for(const value of [0,600,-1,1.5,'2400',null]){const o=options();o.task.payload.scope.run_max_seconds=value;assert.throws(()=>create101BudgetCandidate(template(),o),/101_BUDGET/);}
 for(const change of [{identity:{...identity,task_id:old.task_id}},{identity:{...identity,run_id:old.run_id}},{identity:{...identity,run_tag:old.run_tag}},{startedAtMs:Infinity},{startedAtMs:1000000.5},{task:{id:id(9),payload:{scope:{}}}}])assert.throws(()=>create101BudgetCandidate(template(),{...options(),...change}),/101_BUDGET/);
 const other=template();other.run.contract.workflow='douyin-leadgen-102';assert.throws(()=>create101BudgetCandidate(other,options()),/101_BUDGET/);
});
