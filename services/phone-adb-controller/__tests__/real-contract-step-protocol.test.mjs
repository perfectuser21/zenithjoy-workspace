// GP line02/customer_smart_acquisition：真实契约全Step身份/冻结协议，非84步业务效果。
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {realContractFixture,sourceSteps,sha} from './fixtures/real-contract-versions.mjs';
import {freezeDefinition,readFrozen,digest} from '../runtime-definition.mjs';
import {expectedPath} from '../runtime-binding.mjs';
const fixtures=new Map();
const workflows=[['keyword_acquisition',44],['benchmark_link_acquisition',40]];
before(async()=>{for(const [cap] of workflows)fixtures.set(cap,await realContractFixture(cap));});
after(()=>{for(const f of fixtures.values())f.close();});
for(const [cap,count] of workflows){
 test(`reference_only ${cap}: 8 Activity/${count} Step完整冻结，无latest或业务调用`,()=>{
  const f=fixtures.get(cap),path=expectedPath(f.frozen,f.spec);
  assert.equal(f.expected.length,count);assert.equal(f.frozen.activities.length,8);
  assert.equal(path.filter(p=>p.step_id).length,count);assert.equal(path.length,count+8);
  assert.equal(new Set(path.map(p=>`${p.reference_id}:${p.step_id||''}`)).size,path.length);
  assert.deepEqual(f.requests,[`/api/brain/releases/${f.release.id}`]);
  assert.equal(f.frozen.workflow_version.source_commit,sha);
  assert.equal(f.frozen.workflow_version.id,f.workflow.id);
  assert.deepEqual(JSON.parse(readFileSync(join(f.options.runDir,'step-dod.json'),'utf8')),f.spec);
 });
 for(const row of sourceSteps(cap))test(`reference_only ${cap}/${row.key}: 固定Step父身份、使用位置和源内容；漏项/错父/源漂移拒绝`,async()=>{
  const f=fixtures.get(cap),a=f.frozen.activities.find(a=>a.reference.slot_key===row.slot);
  const step=a.version.payload.steps.find(s=>s.locator.step_key===row.step.key);
  assert.equal(a.reference.sequence_no,row.sequence);
  assert.equal(a.version.payload.definition_key,`${row.owner}.${row.slot}`);
  assert.equal(a.version.source_path,`product-map/contracts/${row.owner}.yaml`);
  assert.equal(a.version.source_commit,sha);assert.deepEqual(step.contract,row.step);
  assert.equal(step.locator.activity_id,a.reference.activity_id);
  const path=expectedPath(f.frozen,f.spec),entry=path.find(p=>p.reference_id===a.reference.reference_id&&p.step_id===step.step_id);
  assert.deepEqual(entry,{reference_id:a.reference.reference_id,activity_id:a.reference.activity_id,activity_definition_version_id:a.version.id,step_id:step.step_id,required:row.step.optional!==true});
  const missing=structuredClone(f.spec);missing.steps=missing.steps.filter(p=>p.key!==row.key);
  assert.throws(()=>expectedPath(f.frozen,missing),/Step.*冻结计划/);
  const wrong=structuredClone(f.frozen),activity=wrong.activities.find(x=>x.reference.slot_key===row.slot);
  activity.version.payload.steps.find(s=>s.step_id===step.step_id).locator.activity_id=wrong.activities.find(x=>x.reference.slot_key!==row.slot).reference.activity_id;
  assert.throws(()=>expectedPath(wrong,f.spec),/Step.*父|Step.*归属/);
  const drift=structuredClone(f.release);
  drift.payload.activities.find(v=>v.id===a.version.id).payload.steps.find(s=>s.step_id===step.step_id).contract.name+=' changed';
  drift.manifest_sha256=digest({environment:drift.environment,target:drift.target,payload:drift.payload});
  await assert.rejects(freezeDefinition({...f.options,runDir:join(f.directory,`drift-${step.step_id}`),get:async()=>({release:drift})}),/版本digest摘要/);
 });
 test(`reference_only ${cap}: 真实Step源内容漂移拒绝，不生成新运行冻结件`,async()=>{
  const f=fixtures.get(cap),release=structuredClone(f.release);
  release.payload.activities[0].payload.steps[0].contract.name+=' changed';
  await assert.rejects(freezeDefinition({...f.options,runDir:join(f.directory,'bad-source'),get:async()=>({release})}),/摘要|digest/);
  const frozen=readFrozen(f.options.runDir);
  writeFileSync(join(f.options.runDir,'step-dod.json'),'{"steps":[]}');
  assert.throws(()=>readFrozen(f.options.runDir),/digest/);
  writeFileSync(join(f.options.runDir,'step-dod.json'),JSON.stringify(f.spec,null,2)+'\n');
  assert.deepEqual(readFrozen(f.options.runDir),frozen);
 });
}
test('共享7 Activity身份与Step UUID保持，两Workflow使用位置各自独立',()=>{
 const [keyword,benchmark]=workflows.map(([cap])=>fixtures.get(cap));
 const shared=keyword.frozen.activities.filter(a=>benchmark.frozen.activities.some(b=>b.reference.activity_id===a.reference.activity_id));
 assert.equal(shared.length,7);
 for(const a of shared){const b=benchmark.frozen.activities.find(b=>b.reference.activity_id===a.reference.activity_id);assert.notEqual(a.reference.reference_id,b.reference.reference_id);assert.deepEqual(a.version,b.version);}
});
