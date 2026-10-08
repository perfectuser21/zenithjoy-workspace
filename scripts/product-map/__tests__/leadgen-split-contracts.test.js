import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {loadContractsFromDisk,validateContracts} from '../contracts-lib.mjs';
import {planFor} from '../wf-plan.mjs';
const require=createRequire(import.meta.url);
const {loadChecks}=require('../../../services/phone-adb-controller/checks/probes-lib.js');
const keys=['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'];
test('四独立契约保留全部旧步骤语义，断言只可迁移不得删掉',()=>{
 const ctx=loadContractsFromDisk();assert.deepEqual(validateContracts(ctx),[]);
 const expected=new Set(ctx.contracts.keyword_acquisition.activities.flatMap(a=>a.steps.map(s=>s.key)));
 const actual=new Set(keys.flatMap(k=>ctx.contracts[k].activities.flatMap(a=>a.steps.map(s=>s.key))));
 for(const key of expected)assert.ok(actual.has(key),`旧步骤消失：${key}`);
 for(const key of keys){const doc=ctx.contracts[key],plan=planFor(ctx,key);
  assert.equal(doc.capability,'keyword_acquisition');assert.equal(plan.ok,true,plan.errors.join('\n'));
  assert.equal(plan.env.WF_MISSING,'');
  for(const a of doc.activities){assert.equal(a.commander.entry,'activity-commander.mjs');assert.equal(a.runtime.entry,'leadgen-activity.sh');assert.ok(a.postconditions.length>0);}
 }
});
test('新检查文件由正式零依赖探针加载器接受，每阶段实际有error门禁',()=>{
 const ctx=loadContractsFromDisk();
 for(const key of keys){const doc=ctx.contracts[key];
  const loaded=loadChecks(doc.checks,'services/phone-adb-controller/checks/schema.json');assert.deepEqual(loaded.errors,[],key);
  for(const a of doc.activities)assert.ok(loaded.doc.probes.some(p=>p.stage===a.key&&p.severity==='error'),`${key}.${a.key}没有门禁`);
 }
});
test('评分与标记人按run真实认领ID读回，不借历史batch假扮本次评分成功',()=>{
 const ctx=loadContractsFromDisk(),doc=ctx.contracts.douyin_comment_scoring;
 for(const a of doc.activities)for(const s of a.steps){assert.notEqual(s.dod.readback.type,'http');assert.notEqual(s.dod.readback.type,'none');if(s.dod.readback.query)assert.ok(!s.dod.readback.query.includes("harvest_batch = '$RUN_TAG'"));}
 const mark=doc.activities.find(a=>a.key==='mark_leads');
 assert.ok(mark.steps.every(s=>s.dod.readback.type==='evidence'));
 assert.match(readFileSync(doc.checks,'utf8'),/独立查询PG/);
});
