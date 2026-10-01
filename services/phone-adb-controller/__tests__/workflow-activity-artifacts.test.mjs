import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { updateArtifacts } = require('../keyword-workflow-activity.js');

test('所有采集归位均读回才汇总真实重搜率', () => {
  let state = updateArtifacts({}, 'collection', { status: 'completed', metrics: { returns_attempted: 1, rescan_count: 1, rescan_rate: 1 }, evidence: [] });
  state = updateArtifacts(state, 'collection', { status: 'completed', metrics: { returns_attempted: 1, rescan_count: 0, rescan_rate: 0 }, evidence: [] });
  assert.equal(state.collection.metrics.rescan_rate, 0.5);
  assert.equal(state.collection.confirmed_returns, 2);
});

test('汇总不修改输入，也不把非数值指标拼成伪计数', () => {
  const previous = { qualification: { status: 'completed', calls: 1, metrics: { matched: 1 }, evidence: [] } };
  const next = updateArtifacts(previous, 'qualification', { status: 'completed', metrics: { matched: 2, rejected: '3' }, evidence: [] });
  assert.equal(previous.qualification.calls, 1);
  assert.equal(next.qualification.metrics.matched, 3);
  assert.equal(next.qualification.metrics.rejected, undefined);
});

test('一个词1/1重搜不能被另一词4次正常归位稀释为整批0.2通过', async () => {
  const { runWorkflowActivity } = require('../keyword-workflow-activity.js');
  const { checksDigest } = await import('../workflow-probes.mjs');
  const input = { run_tag: 'word-rescan-fixture', line_key: 'jinuo', videos: [], comments: [], execution: {} };
  let artifacts = {};
  for (let index = 0; index < 5; index++) {
    const word = index === 0 ? '高重搜' : '正常词';
    const out = await runWorkflowActivity('collection', { ...input, workflow_artifacts: artifacts,
      video: { keyword: word }, return_to_results: true }, { invoke: async () => ({ code: 0, value: {
      schema_version: 1, ...input, status: 'completed', failure_class: null, outputs: {}, evidence: [],
      metrics: { returns_attempted: 1, rescan_count: index === 0 ? 1 : 0, rescan_rate: index === 0 ? 1 : 0 },
    } }) });
    artifacts = out.outputs.workflow_artifacts;
  }
  const output = await runWorkflowActivity('delivery', { ...input, workflow_artifacts: artifacts }, {
    invoke: async entry => entry === 'comment-activity.js' ? { code: 0, value: {
      schema_version: 1, ...input, status: 'completed', failure_class: null, outputs: {}, evidence: [],
      metrics: { comments_written: 5, leads_written: 0 },
    } } : { code: 0, value: { checks_sha256: checksDigest(), probes: [
      { key: 'videos_readback', observed: 0, probed_at: new Date().toISOString() },
      { key: 'comments_readback', observed: 5, probed_at: new Date().toISOString() },
      { key: 'line_key_not_null', observed: ['jinuo'], probed_at: new Date().toISOString() },
      { key: 'coll_only_matched', observed: 0, probed_at: new Date().toISOString() },
      { key: 'coll_video_binding_consistent', observed: 0, probed_at: new Date().toISOString() },
    ] } },
  });
  assert.notEqual(output.status, 'completed');
  const reports = output.outputs.workflow_artifacts.collection.probes.filter(report => report.evaluated_after === 'delivery');
  assert.equal(reports.find(report => report.scope.word === '高重搜').probes.find(p => p.key === 'coll_rescan_rate').pass, false);
  assert.equal(reports.find(report => report.scope.word === '正常词').probes.find(p => p.key === 'coll_rescan_rate').pass, true);
});
