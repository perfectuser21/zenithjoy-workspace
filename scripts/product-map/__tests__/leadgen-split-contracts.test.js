import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {historicalContract} from '../../../services/phone-adb-controller/__tests__/fixtures/historical-leadgen-contract.mjs';
import {createRequire} from 'node:module';
import {loadContractsFromDisk,validateContracts,assemble} from '../contracts-lib.mjs';
import {planFor} from '../wf-plan.mjs';
const require=createRequire(import.meta.url);
const {loadChecks}=require('../../../services/phone-adb-controller/checks/probes-lib.js');
const keys=['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'];
const historical=key=>parse(historicalContract(key));
test('四独立契约保留全部旧步骤语义，断言只可迁移不得删掉',()=>{
 const ctx=loadContractsFromDisk();assert.deepEqual(validateContracts(ctx),[]);
 const expected=new Set(ctx.contracts.keyword_acquisition.activities.flatMap(a=>a.steps.map(s=>s.key)));
 const actual=new Set(keys.flatMap(k=>assemble(ctx,k).activities.flatMap(a=>a.steps.map(s=>s.key))));
 for(const key of expected)assert.ok(actual.has(key),`旧步骤消失：${key}`);
 for(const key of keys){const doc=ctx.contracts[key],plan=planFor(ctx,key);
  assert.equal(doc.capability,'keyword_acquisition');assert.equal(plan.ok,false);
  assert.match(plan.errors.join('\n'),/FOUNDATION_API_ONLY/);
  for(const a of assemble(ctx,key).activities){
   assert.equal(a.execution.primary_kind,'agent');
   assert.equal(a.runtime.entry,'services/phone-adb-controller/leadgen-foundation/worker.mjs');
   assert.ok(a.postconditions.length>0);
   for(const step of a.steps.filter(step=>step.dod.readback.reason?.includes('旧脚本指标'))) {
    const pointer=step.dod.readback.reason.match(/\/postconditions\/(\d+)/);
    assert.ok(pointer && a.postconditions[Number(pointer[1])],step.key);
   }
  }
 }
});
test('新检查文件由正式零依赖探针加载器接受，每阶段实际有error门禁',()=>{
 const ctx=loadContractsFromDisk();
 for(const key of keys){const doc=ctx.contracts[key];
  const loaded=loadChecks(doc.checks,'services/phone-adb-controller/checks/schema.json');assert.deepEqual(loaded.errors,[],key);
  for(const a of assemble(ctx,key).activities)assert.ok(loaded.doc.probes.some(p=>p.stage===a.key&&p.severity==='error'),`${key}.${a.key}没有门禁`);
 }
});
test('评分与标记人按run真实认领ID读回，不借历史batch假扮本次评分成功',()=>{
 const doc=historical('douyin_comment_scoring');
 for(const a of doc.activities)for(const s of a.steps){assert.notEqual(s.dod.readback.type,'http');assert.notEqual(s.dod.readback.type,'none');if(s.dod.readback.query)assert.ok(!s.dod.readback.query.includes("harvest_batch = '$RUN_TAG'"));}
 const mark=doc.activities.find(a=>a.key==='mark_leads');
 assert.ok(mark.steps.every(s=>s.dod.readback.type==='evidence'));
 assert.match(readFileSync(doc.checks,'utf8'),/独立查询PG/);
 const current=loadContractsFromDisk().contracts.douyin_comment_scoring;
 const score=current.activities.find(a=>a.key==='scoring');
 assert.ok(score.preconditions.some(p=>/精确评论ID.*真实已提交/.test(p)));
 assert.ok(score.postconditions.some(p=>p.probe==='scores_readback'&&/精确ID.*已持久化并读回/.test(p.asserts)));
 const currentMark=current.activities.find(a=>a.key==='mark_leads');
 assert.ok(currentMark.preconditions.some(p=>/精确ID.*不改变历史harvest_batch/.test(p)));
 assert.ok(currentMark.postconditions.some(p=>p.probe==='pool_advanced'&&/同事务outbox逐ID可读/.test(p.asserts)));
});

test('103终态排除与异步bridge、104独立资格均有正式合同和读回',()=>{
 const ctx=loadContractsFromDisk(),processing=ctx.contracts.douyin_video_processing,scoring=ctx.contracts.douyin_comment_scoring,outreach=ctx.contracts.douyin_lead_outreach;
 assert.ok(ctx.objectTypes.NativeRecipientEvidence);assert.ok(ctx.objectTypes.RecipientQualification);assert.ok(ctx.objectTypes.OutreachBridgeIntent);
 assert.ok(processing.activities.find(a=>a.key==='collection').outputs.some(o=>o.type==='Comment'&&o.fields.includes('recipient_evidence')));
 const score=scoring.activities.find(a=>a.key==='scoring');
 assert.equal(historical('douyin_comment_scoring').activities.find(a=>a.key==='scoring').version,'2.8.0');
 assert.ok(score.postconditions.some(p=>p.probe==='exclusion_readback'&&/无Lead\/outbox.*技术失败不写排除/.test(p.asserts)));
 const mark=scoring.activities.find(a=>a.key==='mark_leads');assert.ok(mark.outputs.some(o=>o.type==='OutreachBridgeIntent'));assert.ok(mark.postconditions.some(p=>p.probe==='bridge_readback'&&/实际outbox IDs.*绝不重发/.test(p.asserts)));
 assert.ok(outreach.activities.find(a=>a.key==='send_dm').inputs.some(o=>o.type==='RecipientQualification'));
 const checks=loadChecks(scoring.checks,'services/phone-adb-controller/checks/schema.json');assert.ok(checks.doc.probes.some(p=>p.key==='bridge_readback'&&p.probe.ref==='metrics.bridge_readback_failures'&&p.expect.value===0));
 assert.ok(checks.doc.probes.some(p=>p.key==='exclusion_readback'&&p.probe.ref==='metrics.exclusion_readback_failures'&&p.expect.value===0&&p.severity==='error'));
});


test('预检开始只要求可在开工前读取的身份，原生登录和本轮锁在结束验证',()=>{
 const ctx=loadContractsFromDisk();
 for(const key of [keys[0],keys[1],keys[3]]){
  const preflight=assemble(ctx,key).activities.find(a=>a.key==='preflight');
  const expectedAccount=preflight.inputs.find(i=>i.type==='Account');
  const device=preflight.inputs.find(i=>i.type==='Device');
  assert.doesNotMatch(expectedAccount.source,/原生登录态/,key);
  assert.ok(!device.fields.includes('lock_holder'),key);
  assert.ok(preflight.postconditions.some(p=>p.probe==='pf_account_verified'&&/原生登录/.test(p.asserts)),key);
  assert.ok(preflight.postconditions.some(p=>p.probe==='pf_lock_acquired'&&/双锁|本地与中央/.test(p.asserts)),key);
 }
});

test('预检未开工时，无本轮资源可收尾；已有副作用仍要按归属核对',()=>{
 const ctx=loadContractsFromDisk();
 for(const key of [keys[0],keys[1],keys[3]]){
  const cleanup=assemble(ctx,key).activities.find(a=>a.key==='cleanup');
  const device=cleanup.inputs.find(i=>i.type==='Device');
  assert.ok(!device.fields.includes('lock_holder'),key);
  assert.ok(cleanup.failure.empty_ok.some(c=>/无本轮动作/.test(c)),key);
  assert.ok(cleanup.postconditions.some(p=>p.probe==='cl_lock_released'&&/确实持有/.test(p.asserts)),key);
  assert.ok(cleanup.postconditions.some(p=>p.probe==='cl_app_closed'&&/本轮打开/.test(p.asserts)),key);
 }
});
