import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContractsFromDisk, validateContracts } from '../../../scripts/product-map/contracts-lib.mjs';
import { planFor } from '../../../scripts/product-map/wf-plan.mjs';

const workflows = {
  douyin_video_discovery: ['preflight', 'collect_videos', 'cleanup'],
  douyin_video_processing: ['preflight', 'dedup', 'qualification', 'collection', 'cleanup'],
  douyin_comment_scoring: ['scoring', 'mark_leads'],
  douyin_lead_outreach: ['preflight', 'send_dm', 'write_back', 'cleanup'],
};

test('四流程可分别组装，仍归同一智能获客能力，每个活动有Commander绑定', () => {
  const ctx = loadContractsFromDisk();
  assert.deepEqual(validateContracts(ctx), []);
  for (const [key, slots] of Object.entries(workflows)) {
    const doc = ctx.contracts[key];
    assert.ok(doc, `缺正式契约: ${key}`);
    assert.equal(doc.capability, 'keyword_acquisition');
    assert.equal(doc.brain_workflow_key, key);
    const plan = planFor(ctx, key);
    assert.equal(plan.ok, true, plan.errors?.join('\n'));
    assert.deepEqual(plan.activities.map(a => a.key), slots);
    assert.equal(plan.env.WF_RUNNER, 'leadgen-workflow.mjs');
    assert.equal(plan.env.WF_MISSING, '');
    for (const a of plan.activities) assert.equal(a.commander.entry, 'activity-commander.mjs');
  }
});

test('阶段执行必须带真实Commander回执，模型不可达不能冒充已上岗，清场仍执行', async () => {
  const { runActivity } = await import('../activity-commander.mjs');
  const events = [];
  let executed = 0;
  const result = await runActivity({
    activity: { key: 'source', budget: { max_duration_s: 5 } },
    context: { run_id: 'test', workflow_key: 'douyin_video_discovery' },
    execute: async () => { executed++; return { cards: 2 }; },
    commander: async receipt => { events.push(receipt); return { action: 'continue', reason: '已核实' }; },
    record: async receipt => events.push(receipt),
  });
  assert.equal(executed, 1);
  assert.equal(result.status, 'completed');
  assert.ok(events.some(e => e.phase === 'before'));
  assert.ok(events.some(e => e.phase === 'after'));
  await assert.rejects(runActivity({
    activity: { key: 'source', budget: { max_duration_s: 5 } }, context: {},
    execute: async () => { executed++; }, commander: async () => { throw Error('AUTH_UNAVAILABLE'); },
    record: async () => {},
  }), /AUTH_UNAVAILABLE/);
  assert.equal(executed, 1);
  let cleaned = false;
  const cleanup = await runActivity({
    activity: { key: 'cleanup', budget: { max_duration_s: 5 } }, context: {},
    execute: async () => { cleaned = true; return { lock_released: true }; },
    commander: async () => { throw Error('AUTH_UNAVAILABLE'); }, record: async () => {},
  });
  assert.equal(cleaned, true);
  assert.equal(cleanup.commander_status, 'unavailable');
});
