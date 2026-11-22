import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'yaml';
import { runProbes } from '../../../services/phone-adb-controller/verify-step.mjs';

const { loadChecks } = createRequire(import.meta.url)('../../../services/phone-adb-controller/checks/probes-lib.js');

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const workflows = [
  'douyin_video_discovery',
  'douyin_video_processing',
  'douyin_comment_scoring',
  'douyin_lead_outreach',
];

test('四条获客流程的每个 Activity 都有可展示的业务合同', () => {
  let uniqueActivities = 0;
  for (const key of workflows) {
    const doc = parse(readFileSync(resolve(root, `product-map/contracts/${key}.yaml`), 'utf8'));
    for (const activity of doc.activities) {
      if (activity.ref) continue;
      uniqueActivities += 1;
      const label = `${key}.${activity.key}`;
      assert.ok(activity.promise?.trim().length >= 8, `${label} 缺业务承诺`);
      for (const input of activity.inputs) {
        assert.ok(input.source?.trim(), `${label} ${input.type} 缺输入来源`);
      }
      for (const output of activity.outputs) {
        assert.ok(output.destination?.trim(), `${label} ${output.type} 缺输出去向`);
      }
      const candidates = activity.sample_candidates;
      assert.equal(candidates?.owner_labeled, false, `${label} 不得把历史候选冒充业务已确认样本`);
      assert.equal(candidates?.current_skill_verified, false, `${label} 不得把历史代码运行冒充当前 Skill 实机验收`);
      assert.equal(candidates?.activity_key, activity.key, `${label} 候选索引的 Activity 身份不一致`);
      assert.equal(candidates?.index, 'services/phone-adb-controller/__tests__/fixtures/leadgen-historical-evidence-index.json');
      const index = JSON.parse(readFileSync(resolve(root, candidates.index), 'utf8'));
      for (const workflowKey of candidates.workflow_keys) {
        assert.ok(index.workflows?.[workflowKey]?.activities?.[activity.key], `${label} 的 ${workflowKey} 候选证据不存在`);
      }
      for (const condition of activity.postconditions) {
        assert.doesNotMatch(condition.asserts, /保留原后置条件/, `${label} ${condition.probe} 验收条件是占位文本`);
      }
    }
  }
  assert.equal(uniqueActivities, 12);
});

test('101 按原Video字段交接指标结构，原XML由通用Checker独立读取', () => {
  const doc = parse(readFileSync(resolve(root, 'product-map/contracts/douyin_video_discovery.yaml'), 'utf8'));
  const collect = doc.activities.find(activity => activity.key === 'collect_videos');
  const video = collect.outputs.find(output => output.type === 'Video');
  assert.deepEqual(video.fields, ['line_key', 'video_id', 'video_url', 'title', 'keyword', 'comment_count',
    'discovery_metrics', 'harvest_batch', 'author']);
  const check = collect.postconditions.find(condition => condition.probe === 'disc_candidates_persisted');
  assert.match(check.asserts, /outputs\.Video/);
  const run = collect.outputs.find(output => output.type === 'Run');
  assert.match(run.destination, /实际操作、提交和读回终态.*执行提案状态/);
  assert.match(check.asserts, /仅原始XML .*evidence\.xml.*可由原件引用交付/);
  assert.match(check.asserts, /原XML.*SHA256.*持久行/);
  const readback = collect.postconditions.find(condition => condition.probe === 'videos_readback');
  assert.match(readback.asserts, /写前 process_status 为“评论已采”/);
  assert.match(readback.asserts, /部分采集阶段的视频进度以该视频写前 process_status 为准/);
  assert.match(collect.side_effects[0].description, /写前 process_status 为“评论已采”/);
  assert.match(collect.side_effects[0].description, /写入表为 zenithjoy\.leadgen_videos/);
  assert.doesNotMatch(collect.side_effects[0].description, /评论行的历史来源/);
});

test('共享预检的定时闸不误写成手动活动条件', () => {
  const doc = parse(readFileSync(resolve(root, 'product-map/contracts/douyin_video_processing.yaml'), 'utf8'));
  const preflight = doc.activities.find(activity => activity.key === 'preflight');
  assert.ok(preflight.preconditions.every(condition => !condition.includes('harvest-cron.sh:')));
  assert.ok(preflight.preconditions.some(condition =>
    condition.includes('Brain 正式派单') && condition.includes('原绝对 deadline')));
});

test('101 与 102 共用收尾契约并按本轮真实资源核验', () => {
  const discovery = parse(readFileSync(resolve(root, 'product-map/contracts/douyin_video_discovery.yaml'), 'utf8'));
  const processing = parse(readFileSync(resolve(root, 'product-map/contracts/douyin_video_processing.yaml'), 'utf8'));
  assert.ok(discovery.activities.some(activity => activity.ref === 'douyin_video_processing.cleanup'));
  const cleanup = processing.activities.find(activity => activity.key === 'cleanup');
  assert.match(cleanup.outputs.find(output => output.type === 'Run').destination, /本次检查之后生成.*无须另有收尾成功回执/);
  const lock = cleanup.postconditions.find(condition => condition.probe === 'cl_lock_released');
  assert.match(lock.asserts, /业务 claim 释放不适用.*102 若实际认领.*独立查验/);
  assert.match(cleanup.failure.needs_human.cases.join(' '), /独立可读的工件.*旧 finalize 脚本/);
});

test('104 订单生命周期与发送结果由完整合同规定', () => {
  const doc = parse(readFileSync(resolve(root, 'product-map/contracts/douyin_lead_outreach.yaml'), 'utf8'));
  const activity = Object.fromEntries(doc.activities.filter(a => a.key).map(a => [a.key, a]));
  assert.ok(!activity.preflight.outputs.some(output => output.type === 'OutreachOrder'));
  assert.equal(activity.preflight.version, '5.3.1');
  assert.equal(activity.preflight.compatibility, 'breaking');
  assert.ok(activity.send_dm.inputs.some(input => input.type === 'OutreachOrder'));
  assert.equal(activity.send_dm.outputs.find(output => output.type === 'OutreachOrder').effect, 'update');
  assert.equal(activity.send_dm.version, '6.1.2');
  assert.equal(activity.send_dm.compatibility, 'breaking');
  assert.equal(activity.write_back.outputs.find(output => output.type === 'OutreachOrder').effect, 'update');
  assert.equal(activity.write_back.version, '4.1.1');
  assert.equal(activity.write_back.compatibility, 'breaking');
  assert.ok(activity.send_dm.postconditions.some(condition => condition.probe === 'out_delivery_result_verified'));
  assert.ok(activity.send_dm.postconditions.some(condition => condition.probe === 'out_order_scope_verified'));
  assert.ok(!activity.send_dm.known_gaps?.some(gap => gap.gap.includes('硬性 Activity probe')));
});
test('历史独立探针：104 send_dm 缺冻结精确订单范围结果时封闭', async () => {
  const {doc,errors}=loadChecks(resolve(root,'services/phone-adb-controller/checks/douyin-lead-outreach.yaml'),resolve(root,'services/phone-adb-controller/checks/schema.json'));
  assert.deepEqual(errors,[]);
  const check=async metrics => {
    const result=await runProbes({doc,stage:'send_dm',params:{metrics},deps:{now:()=> '2026-10-31T00:00:00Z'}});
    return result.probes.find(probe=>probe.key==='out_order_scope_verified');
  };
  assert.equal((await check({commander_verified:1,messages_sent_while_paused:0,delivery_result_verified:1}))?.pass,null);
  assert.equal((await check({commander_verified:1,messages_sent_while_paused:0,delivery_result_verified:1,order_selection_verified:0}))?.pass,false);
  assert.equal((await check({commander_verified:1,messages_sent_while_paused:0,delivery_result_verified:1,order_selection_verified:1}))?.pass,true);
});

test('历史独立探针：104 send_dm 原生发送结果缺失或为零时封闭', async () => {
  const { doc, errors } = loadChecks(
    resolve(root, 'services/phone-adb-controller/checks/douyin-lead-outreach.yaml'),
    resolve(root, 'services/phone-adb-controller/checks/schema.json'),
  );
  assert.deepEqual(errors, []);
  const check = async metrics => {
    const result = await runProbes({ doc, stage: 'send_dm', params: { metrics }, deps: { now: () => '2026-10-31T00:00:00Z' } });
    return result.probes.find(probe => probe.key === 'out_delivery_result_verified');
  };
  assert.equal((await check({ commander_verified: 1, messages_sent_while_paused: 0 }))?.pass, null);
  assert.equal((await check({ commander_verified: 1, messages_sent_while_paused: 0, delivery_result_verified: 0 }))?.pass, false);
  assert.equal((await check({ commander_verified: 1, messages_sent_while_paused: 0, delivery_result_verified: 1 }))?.pass, true);
});

test('103 评分与线索交付分段验收', () => {
  const doc = parse(readFileSync(resolve(root, 'product-map/contracts/douyin_comment_scoring.yaml'), 'utf8'));
  const scoring = doc.activities.find(activity => activity.key === 'scoring');
  const markLeads = doc.activities.find(activity => activity.key === 'mark_leads');
  assert.match(scoring.postconditions.find(condition => condition.probe === 'scores_readback').asserts, /本活动不创建Lead/);
  assert.ok(markLeads.postconditions.length > 0);
});

test('102 判定和采集按本轮操作查验账号和链接回执', () => {
  const doc = parse(readFileSync(resolve(root, 'product-map/contracts/douyin_video_processing.yaml'), 'utf8'));
  for (const key of ['qualification', 'collection']) {
    const preconditions = doc.activities.find(activity => activity.key === key).preconditions.join(' ');
    assert.match(preconditions, /host\.receipts/);
    assert.match(preconditions, /preflight.{0,60}phone(?:\/|.{0,20}=)account-current/);
    assert.match(preconditions, /(?:Task\/run|run_id.{0,15}task_id)/);
    assert.doesNotMatch(preconditions, /receipts\/(?:pf-account-current|qual-current-link)\.json/);
    if (key === 'collection') assert.match(preconditions, /qualification.{0,40}phone\/current-video-link/);
  }
});


test('102 合法空结果收尾及采集账号使用同轮原件', () => {
  const doc = parse(readFileSync(resolve(root, 'product-map/contracts/douyin_video_processing.yaml'), 'utf8'));
  const qualification = doc.activities.find(activity => activity.key === 'qualification');
  const collection = doc.activities.find(activity => activity.key === 'collection');
  const account = collection.inputs.find(input => input.type === 'Account');
  const empty = qualification.failure.empty_ok.find(reason => reason.includes('全部按冻结政策判为 rejected'));
  assert.match(empty ?? '', /全部条款通过后必须以 empty .*进入 cleanup/);
  assert.match(empty, /存在 unknown .*不能判 empty/);
  assert.deepEqual(account.fields, ['sender_id', 'nickname']);
  assert.match(account.source, /context\.Account\.sender_id.*phone\/account-current/);
  assert.match(account.source, /douyin_id= 与 sender_id 一致.*非空 nickname=/);
  assert.match(collection.preconditions[0], /只接收.*matched/);
});

test('101 工具说明使用本次冻结关键词和筛选', () => {
  const file = resolve(root, 'services/phone-adb-controller/leadgen-foundation/sources/101.json');
  const { source } = JSON.parse(readFileSync(file, 'utf8')).files['TOOLS.txt'];
  assert.match(source, /context\.keyword/);
  assert.match(source, /context\.search_filters/);
  assert.doesNotMatch(source, /本轮来源：.*已启用关键词/);
  assert.doesNotMatch(source, /search-time-layer one_week EID most_liked/);
});
