/**
 * wf-plan.test.js — 契约组装 → 执行计划（决策 7f842d12：Commander 当入口 + 契约组装执行）
 *
 * 钉四件事：①两个能力的计划输出（阶段串/源类型/发现入口）②缺 runtime 拒跑
 * ③步骤 implementation=missing 默认拒跑、--allow-missing 放行但记入 WF_MISSING
 * ④提交进仓库的 plans/*.plan 与重新生成的一致（改契约不重生成 = CI 红）。
 * 运行: node --test scripts/product-map/__tests__/wf-plan.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContractsFromDisk } from '../contracts-lib.mjs';
import { planFor, renderEnv, PLANS_DIR } from '../wf-plan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = resolve(ROOT, 'scripts/product-map/wf-plan.mjs');
const fresh = () => loadContractsFromDisk();
const act = (ctx, cap, key) => ctx.contracts[cap].activities.find((a) => a.key === key);
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: ROOT });
const versionFields = ['WF_BRAIN_WORKFLOW','WF_SOURCE_REPO','WF_CONTRACT_SHA256','WF_CONTRACT_RAW_SHA256','WF_ACTIVITY_REFS','WF_STEP_SPEC'];
const legacyEnv = env => Object.fromEntries(Object.entries(env).filter(([key]) => !versionFields.includes(key)));

test('计划含明确Brain身份、两种契约摘要与规范活动位置，无当前提交自引用', () => {
  const ctx = fresh(), r = planFor(ctx, 'benchmark_link_acquisition');
  assert.equal(r.env.WF_BRAIN_WORKFLOW, 'douyin_benchmark_leadgen');
  assert.equal(r.env.WF_SOURCE_REPO, 'perfectuser21/zenithjoy-workspace');
  assert.match(r.env.WF_CONTRACT_SHA256, /^[a-f0-9]{64}$/);
  assert.match(r.env.WF_CONTRACT_RAW_SHA256, /^[a-f0-9]{64}$/);
  assert.notEqual(r.env.WF_CONTRACT_SHA256, r.env.WF_CONTRACT_RAW_SHA256);
  assert.equal(r.env.WF_STEP_SPEC, 'plans/benchmark_link_acquisition.steps.json');
  const refs = JSON.parse(r.env.WF_ACTIVITY_REFS);
  assert.equal(refs.length, 8);
  assert.deepEqual(refs.map(x => x.sequence_no), [1,2,3,4,5,6,7,8]);
  assert.equal(refs[0].definition_key, 'keyword_acquisition.preflight');
  assert.equal(refs[1].definition_key, 'benchmark_link_acquisition.discovery');
  const previous = r.env.WF_CONTRACT_SHA256;
  act(ctx, 'keyword_acquisition', 'preflight').name = '预检修改';
  assert.notEqual(planFor(ctx, 'benchmark_link_acquisition').env.WF_CONTRACT_SHA256, previous);
});
test('Brain工作流映射缺失时计划明确拒跑', () => {
  const ctx = fresh(); delete ctx.contracts.keyword_acquisition.brain_workflow_key;
  const r = planFor(ctx, 'keyword_acquisition');
  assert.equal(r.ok, false); assert.ok(r.errors.some(e => /brain_workflow_key/.test(e)));
});

test('关键词获客：计划 = 5 段阶段串 + keyword 源 + discover-keyword.sh', () => {
  const r = planFor(fresh(), 'keyword_acquisition');
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
  assert.deepEqual(legacyEnv(r.env), {
    WF_CAP: 'keyword_acquisition',
    WF_WORKFLOW: 'social-keyword-leadgen',
    WF_STAGES: '拉Commander,预检,取词单,发现·判定·采集·评分·配送,效果回写',
    WF_SOURCE_KIND: 'keyword',
    WF_DISCOVER_CMD: 'discover-keyword.sh',
    WF_MISSING: '',
    ...BUDGETS,
  });
});

// 7d150e33（阶段1）：契约每活动 budget.max_duration_s 编进计划（WF_BUDGET_<key>），执行器按它封顶各活动段；
// 超时时的失败分类 WF_TIMEOUT_CLASS_<key>：活动 failure.retryable 里有「超时/timeout/scp/ssh 失败」条目 → retryable（重试一次），
// 否则 record（记账后进入下一单元）。两个能力共享同一套预算（benchmark 的非 discovery 活动都是 ref 过来的）。
const BUDGETS = {
  WF_BUDGET_preflight: '300', WF_BUDGET_discovery: '600', WF_BUDGET_qualification: '1800', WF_BUDGET_collection: '7200',
  WF_BUDGET_scoring: '1800', WF_BUDGET_delivery: '600', WF_BUDGET_outreach: '1500', WF_BUDGET_cleanup: '120',
  WF_TIMEOUT_CLASS_preflight: 'record', WF_TIMEOUT_CLASS_discovery: 'record', WF_TIMEOUT_CLASS_qualification: 'record',
  WF_TIMEOUT_CLASS_collection: 'record', WF_TIMEOUT_CLASS_scoring: 'record', WF_TIMEOUT_CLASS_delivery: 'retryable',
  WF_TIMEOUT_CLASS_outreach: 'record', WF_TIMEOUT_CLASS_cleanup: 'record',
};

test('活动 failure.retryable 含「超时」→ 该活动超时分类 retryable；缺 budget → 0', () => {
  const ctx = fresh();
  act(ctx, 'keyword_acquisition', 'discovery').failure.retryable.push('发现超时 timeout');
  delete act(ctx, 'keyword_acquisition', 'scoring').budget;
  const r = planFor(ctx, 'keyword_acquisition');
  assert.ok(r.ok, r.errors.join('\n'));
  assert.equal(r.env.WF_TIMEOUT_CLASS_discovery, 'retryable');
  assert.equal(r.env.WF_BUDGET_scoring, '0');
});

test('对标链接获客：发现四步已实现（338e3ec7）→ 默认放行，WF_MISSING 为空', () => {
  const r = planFor(fresh(), 'benchmark_link_acquisition');
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
  assert.deepEqual(legacyEnv(r.env), {
    WF_CAP: 'benchmark_link_acquisition',
    WF_WORKFLOW: 'social-benchmark-leadgen',
    WF_STAGES: '拉Commander,预检,取对标源,对标发现·判定·采集·评分·配送,效果回写',
    WF_SOURCE_KIND: 'benchmark',
    WF_DISCOVER_CMD: 'discover-benchmark.sh',
    WF_MISSING: '',
    ...BUDGETS,
  });
});

test('任一步骤 implementation=missing → 默认拒跑（无实现不得跑）', () => {
  const ctx = fresh();
  act(ctx, 'benchmark_link_acquisition', 'discovery').steps.find((s) => s.key === 'open_benchmark_profile').implementation.status = 'missing';
  const r = planFor(ctx, 'benchmark_link_acquisition');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /implementation=missing/.test(e) && /discovery\.open_benchmark_profile/.test(e)), r.errors.join('\n'));
});

test('--allow-missing：放行未实现步骤但缺口记入 WF_MISSING', () => {
  const ctx = fresh();
  act(ctx, 'benchmark_link_acquisition', 'discovery').steps.find((s) => s.key === 'open_benchmark_profile').implementation.status = 'missing';
  const r = planFor(ctx, 'benchmark_link_acquisition', { allowMissing: true });
  assert.deepEqual(r.errors, []);
  assert.equal(r.env.WF_DISCOVER_CMD, 'discover-benchmark.sh');
  assert.equal(r.env.WF_MISSING, 'discovery.open_benchmark_profile');
});

test('ref 过来的活动沿用被 ref 活动的 runtime', () => {
  const r = planFor(fresh(), 'benchmark_link_acquisition', { allowMissing: true });
  const kw = planFor(fresh(), 'keyword_acquisition');
  for (const key of ['preflight', 'qualification', 'collection', 'scoring', 'delivery', 'outreach', 'cleanup']) {
    assert.deepEqual(r.activities.find((a) => a.key === key).runtime, kw.activities.find((a) => a.key === key).runtime, key);
  }
});

test('任一活动缺 runtime → 拒跑并点名', () => {
  const ctx = fresh();
  delete act(ctx, 'keyword_acquisition', 'scoring').runtime;
  const r = planFor(ctx, 'keyword_acquisition');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /scoring/.test(e) && /缺 runtime/.test(e)), r.errors.join('\n'));
});

test('--allow-missing 放不过缺 runtime（只放未实现步骤）', () => {
  const ctx = fresh();
  delete act(ctx, 'keyword_acquisition', 'discovery').runtime;
  assert.equal(planFor(ctx, 'keyword_acquisition', { allowMissing: true }).ok, false);
});

test('组装不 ok → 拒跑', () => {
  const ctx = fresh();
  act(ctx, 'keyword_acquisition', 'discovery').inputs[0].type = 'Lead';
  const r = planFor(ctx, 'keyword_acquisition');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /未由 trigger_inputs 或前序活动交出/.test(e)), r.errors.join('\n'));
});

test('source 活动必须恰好一个', () => {
  const ctx = fresh();
  act(ctx, 'keyword_acquisition', 'qualification').runtime.phase = 'source';
  assert.ok(planFor(ctx, 'keyword_acquisition').errors.some((e) => /phase=source/.test(e)));
});

test('renderEnv 输出可被 shell eval，单引号转义正确', () => {
  const out = renderEnv({ A: "x'y", B: '拉Commander,预检' });
  const r = spawnSync('bash', ['-c', `${out}\nprintf '%s|%s' "$A" "$B"`], { encoding: 'utf8' });
  assert.equal(r.stdout, "x'y|拉Commander,预检");
});

test('CLI：两个能力 stdout 都可 eval，未知能力 exit 1', () => {
  const ok = cli('keyword_acquisition');
  assert.equal(ok.status, 0, ok.stderr);
  const r = spawnSync('bash', ['-c', `${ok.stdout}\nprintf '%s' "$WF_SOURCE_KIND/$WF_DISCOVER_CMD"`], { encoding: 'utf8' });
  assert.equal(r.stdout, 'keyword/discover-keyword.sh');
  const bm = cli('benchmark_link_acquisition');
  assert.equal(bm.status, 0, bm.stderr);
  const rb = spawnSync('bash', ['-c', `${bm.stdout}\nprintf '%s/%s/[%s]' "$WF_SOURCE_KIND" "$WF_DISCOVER_CMD" "$WF_MISSING"`], { encoding: 'utf8' });
  assert.equal(rb.stdout, 'benchmark/discover-benchmark.sh/[]');
  assert.equal(cli('no_such_cap').status, 1);
});

test('提交的 plans/*.plan 与契约重新生成的一致（改契约必须 --write 重生成）', () => {
  const r = cli('--check');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const kw = readFileSync(resolve(ROOT, PLANS_DIR, 'keyword_acquisition.plan'), 'utf8');
  assert.match(kw, /^WF_DISCOVER_CMD='discover-keyword\.sh'$/m);
});
