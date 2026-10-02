import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const service = join(dirname(fileURLToPath(import.meta.url)), '..');
const input = { run_tag: 'workflow-probe-fixture', line_key: 'jinuo' };
const result = { status: 'completed', outputs: {}, metrics: {} };
const module = () => import('../workflow-probes.mjs');

test('真实探针CLI用原声明检查预检四个指标，缺失指标必须未知', () => {
  const run = spawnSync(process.execPath, [join(service, 'workflow-probe.js')], {
    input: JSON.stringify({ stage: 'preflight', ...input,
      metrics: { device_verified: 1, account_verified: 1, call_state_idle: 1 } }),
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: '/nonexistent-probe-fixture' },
  });
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.equal(out.probes.length, 4);
  assert.equal(out.probes.find(p => p.key === 'pf_lock_acquired').pass, null);
  assert.equal(out.gate.verdict, 'unknown');
  assert.match(out.checks_sha256, /^[a-f0-9]{64}$/);
});

test('配送读回分母取真实本批新增评论，最终线索不能冒充池计数', async () => {
  const { metricsForProbe } = await module();
  assert.deepEqual(metricsForProbe('delivery', { comments_written: 2, leads_written: 1, duplicates: 5 }),
    { comments_written: 2, leads_written: 2, duplicates: 5, final_leads_written: 1, videos_pushed: 0 });
});

test('单视频判定仍有后续候选时，全批SQL显式延期而非误杀或假绿', async () => {
  const { verifyWorkflowStage } = await module();
  let requests = 0;
  const out = await verifyWorkflowStage({ stage: 'qualification', input, result, defer: true },
    { remote: async () => { requests++; throw Error('must not execute'); } });
  assert.equal(requests, 0);
  assert.equal(out.gate.verdict, 'deferred');
  assert.equal(out.gate.action, 'continue');
  assert.ok(out.probes.length > 0);
  assert.ok(out.probes.every(p => p.pass === null && p.status === 'deferred'));
});

test('内存评分后的推进探针延期；交付后真实HTTP观测按原判据报红', async () => {
  const { verifyWorkflowStage, checksDigest } = await module();
  const deferred = await verifyWorkflowStage({ stage: 'scoring', input, result, defer: true });
  assert.equal(deferred.probes[0].pass, null);
  const observed = await verifyWorkflowStage({ stage: 'scoring', input, result, evaluatedAfter: 'delivery' }, {
    remote: async () => ({ checks_sha256: checksDigest(), probes: [
      { key: 'pool_advanced', observed: 1, pass: true, probed_at: new Date().toISOString() },
    ] }),
  });
  assert.equal(observed.probes[0].pass, false, '不能信远端自报pass');
  assert.equal(observed.gate.verdict, 'fail');
  assert.equal(observed.evaluated_after, 'delivery');
});

test('坏JSON、漏探针及旧声明哈希不许变成none或continue', async () => {
  const { verifyWorkflowStage } = await module();
  for (const bad of [undefined, {}, { probes: [] }, { checks_sha256: 'stale', probes: [] }]) {
    const out = await verifyWorkflowStage({ stage: 'delivery', input, result }, { remote: async () => bad });
    assert.equal(out.gate.verdict, 'unknown');
    assert.equal(out.gate.action, 'fail_stage');
    assert.equal(out.probes.length, 3);
    assert.ok(out.probes.every(p => p.pass === null));
  }
});

test('未执行归位步骤不能补rescan_rate=0骗过过程探针', async () => {
  const { verifyWorkflowStage, checksDigest } = await module();
  const out = await verifyWorkflowStage({ stage: 'collection', input, result }, {
    remote: async () => ({ checks_sha256: checksDigest(), probes: [
      { key: 'coll_only_matched', observed: 0, probed_at: new Date().toISOString() },
      { key: 'coll_video_binding_consistent', observed: 0, probed_at: new Date().toISOString() },
    ] }),
  });
  const rescan = out.probes.find(p => p.key === 'coll_rescan_rate');
  assert.equal(rescan.pass, null);
  assert.equal(out.gate.verdict, 'unknown');
});

test('远端probes不是数组也须保留全部预期探针为unknown', async () => {
  const { verifyWorkflowStage, checksDigest } = await module();
  const out = await verifyWorkflowStage({ stage: 'delivery', input, result }, {
    remote: async () => ({ checks_sha256: checksDigest(), probes: { comments_readback: 1 } }),
  });
  assert.equal(out.probes.length, 3);
  assert.ok(out.probes.every(p => p.pass === null));
  assert.equal(out.gate.verdict, 'unknown');
});

test('活动包装配送实际传池新增作分母，少一条读回必须失败', async () => {
  const { createRequire } = await import('node:module');
  const { runWorkflowActivity } = createRequire(import.meta.url)('../keyword-workflow-activity.js');
  const { checksDigest } = await module();
  const requests = [];
  const output = await runWorkflowActivity('delivery', { ...input, comments: [], workflow_artifacts: {}, execution: {} }, {
    invoke: async (entry, args, request) => {
      if (entry === 'comment-activity.js') return { code: 0, value: { schema_version: 1, ...input,
        status: 'completed', failure_class: null, outputs: { comments: [] },
        metrics: { comments_written: 2, leads_written: 1 }, evidence: [] } };
      assert.equal(entry, 'workflow-probe.js'); requests.push(request);
      return { code: 0, value: { checks_sha256: checksDigest(), probes: [
        { key: 'videos_readback', observed: 0, probed_at: new Date().toISOString() },
        { key: 'comments_readback', observed: 1, probed_at: new Date().toISOString() },
        { key: 'line_key_not_null', observed: ['jinuo'], probed_at: new Date().toISOString() },
      ] } };
    },
  });
  assert.equal(requests[0].metrics.leads_written, 2);
  const report = output.outputs.workflow_artifacts.delivery.probes[0];
  assert.equal(report.probes.find(p => p.key === 'comments_readback').pass, false);
  assert.notEqual(output.status, 'completed');
});

test('真实重扫比例超过原阈值会报红，不改既有阈值', async () => {
  const { verifyWorkflowStage, checksDigest } = await module();
  const out = await verifyWorkflowStage({ stage: 'collection', input,
    result: { ...result, metrics: { rescan_rate: 1 } } }, {
    remote: async () => ({ checks_sha256: checksDigest(), probes: [
      { key: 'coll_only_matched', observed: 0, probed_at: new Date().toISOString() },
      { key: 'coll_video_binding_consistent', observed: 0, probed_at: new Date().toISOString() },
    ] }),
  });
  assert.equal(out.probes.find(p => p.key === 'coll_rescan_rate').pass, false);
  assert.equal(out.gate.verdict, 'fail');
});

test('发现按词使用不同的真实候选分母，保留原声明SQL', async () => {
  const { verifyWorkflowStage, checksDigest } = await module();
  const seen = [];
  for (const [word, count] of [['AI 考证', 1], ['AI 部署', 3]]) {
    const out = await verifyWorkflowStage({ stage: 'discovery', input, result,
      word, metrics: { candidates: count } }, { remote: async request => {
      seen.push(request);
      return { checks_sha256: checksDigest(), probes: [
        { key: 'disc_candidates_persisted', observed: count, probed_at: new Date().toISOString() },
      ] };
    } });
    assert.equal(out.gate.verdict, 'pass');
  }
  assert.deepEqual(seen.map(r => [r.word, r.metrics.candidates]), [['AI 考证', 1], ['AI 部署', 3]]);
});
