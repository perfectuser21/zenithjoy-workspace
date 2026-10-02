import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const service = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compiler = join(service, '../../scripts/product-map/wf-plan.mjs');
const bindings = join(service, 'plans/keyword_workflow.bindings.json');

test('完整显式绑定来自原契约，配送必须先于归位且同为finalize', () => {
  assert.equal(existsSync(bindings), true, '缺少完整workflow显式绑定');
  const run = spawnSync(process.execPath, [compiler, 'keyword_acquisition', '--json', '--bindings', bindings], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const activities = JSON.parse(run.stdout).contract.activities;
  assert.deepEqual(activities.map(a => a.key), ['preflight', 'discovery', 'qualification', 'collection', 'scoring', 'delivery', 'cleanup']);
  assert.equal(activities.find(a => a.key === 'delivery').runtime.phase, 'finalize');
  assert.equal(activities.find(a => a.key === 'cleanup').runtime.phase, 'finalize');
  assert.equal(activities.find(a => a.key === 'collection').runtime.input.return_to_results, '$input.return_to_results');
  assert.equal(activities.find(a => a.key === 'cleanup').runtime.input.device, '$input.device');
});

test('完整链删除评分只改绑定，组装不需要Lead必填输入', t => {
  assert.equal(existsSync(bindings), true);
  const home = mkdtempSync(join(tmpdir(), 'keyword-bindings-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const value = JSON.parse(readFileSync(bindings, 'utf8'));
  value.select = value.select.filter(key => key !== 'scoring');
  delete value.activities.scoring;
  const file = join(home, 'without-score.json'); writeFileSync(file, JSON.stringify(value));
  const run = spawnSync(process.execPath, [compiler, 'keyword_acquisition', '--json', '--bindings', file], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).contract.activities.some(a => a.key === 'scoring'), false);
});

test('整批runner校验失败仅输出一个JSON，不运行编译/执行器', async () => {
  const { createRequire } = await import('node:module');
  const { runKeywordWorkflow } = createRequire(import.meta.url)('../keyword-workflow.js');
  let called = false;
  const out = await runKeywordWorkflow({ run_tag: 'invalid', line_key: 'jinuo', device: {}, keywords: [] }, {
    runtime: '/nonexistent-runtime', invoke: async () => { called = true; throw Error('should not run'); },
  });
  assert.equal(out.status, 'failed');
  assert.equal(out.reason_code, 'invalid_workflow_input');
  assert.equal(called, false);
});

test('活动账保留阶段失败，后续成功不能覆盖成成功', async () => {
  const { createRequire } = await import('node:module');
  const { updateArtifacts } = createRequire(import.meta.url)('../keyword-workflow-activity.js');
  const first = updateArtifacts({}, 'qualification', { status: 'failed', metrics: { videos_matched: 0 } });
  const second = updateArtifacts(first, 'qualification', { status: 'completed', metrics: { videos_matched: 1 } });
  assert.equal(second.qualification.status, 'failed');
  assert.equal(second.qualification.calls, 2);
  assert.equal(second.qualification.metrics.videos_matched, 1);
});

test('缺归位指标的一条不能被另一条成功覆盖成rescan_rate=0', async () => {
  const { createRequire } = await import('node:module');
  const { updateArtifacts } = createRequire(import.meta.url)('../keyword-workflow-activity.js');
  const first = updateArtifacts({}, 'collection', { status: 'partial', metrics: { returns_attempted: 0 } });
  const second = updateArtifacts(first, 'collection', { status: 'completed',
    metrics: { returns_attempted: 1, rescan_count: 0, rescan_rate: 0 } });
  assert.equal(second.collection.metrics.rescan_rate, undefined);
});
