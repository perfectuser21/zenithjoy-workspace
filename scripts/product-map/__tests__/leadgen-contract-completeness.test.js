import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parse } from 'yaml';

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

test('共享预检的定时闸不误写成手动活动条件', () => {
  const doc = parse(readFileSync(resolve(root, 'product-map/contracts/douyin_video_processing.yaml'), 'utf8'));
  const preflight = doc.activities.find(activity => activity.key === 'preflight');
  assert.ok(preflight.preconditions.every(condition => !condition.includes('harvest-cron.sh:')));
  assert.ok(preflight.preconditions.some(condition => condition.includes('手动或 Brain 派发')));
});

test('104 订单生命周期与发送验收缺口如实入合同', () => {
  const doc = parse(readFileSync(resolve(root, 'product-map/contracts/douyin_lead_outreach.yaml'), 'utf8'));
  const activity = Object.fromEntries(doc.activities.filter(a => a.key).map(a => [a.key, a]));
  assert.ok(!activity.preflight.outputs.some(output => output.type === 'OutreachOrder'));
  assert.equal(activity.preflight.version, '5.0.0');
  assert.equal(activity.preflight.compatibility, 'breaking');
  assert.ok(activity.send_dm.inputs.some(input => input.type === 'OutreachOrder'));
  assert.equal(activity.send_dm.outputs.find(output => output.type === 'OutreachOrder').effect, 'update');
  assert.equal(activity.send_dm.version, '4.0.0');
  assert.equal(activity.send_dm.compatibility, 'breaking');
  assert.equal(activity.write_back.outputs.find(output => output.type === 'OutreachOrder').effect, 'update');
  assert.equal(activity.write_back.version, '4.0.0');
  assert.equal(activity.write_back.compatibility, 'breaking');
  assert.ok(activity.send_dm.known_gaps.some(gap => gap.gap.includes('硬性 Activity probe')));
});

test('103 评分与线索交付分段验收', () => {
  const doc = parse(readFileSync(resolve(root, 'product-map/contracts/douyin_comment_scoring.yaml'), 'utf8'));
  const scoring = doc.activities.find(activity => activity.key === 'scoring');
  const markLeads = doc.activities.find(activity => activity.key === 'mark_leads');
  assert.match(scoring.postconditions.find(condition => condition.probe === 'scores_readback').asserts, /本活动只交评分/);
  assert.ok(markLeads.postconditions.length > 0);
});
