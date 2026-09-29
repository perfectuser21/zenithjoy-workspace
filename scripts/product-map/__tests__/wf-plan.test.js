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

test('关键词获客：计划 = 5 段阶段串 + keyword 源 + discover-keyword.sh', () => {
  const r = planFor(fresh(), 'keyword_acquisition');
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
  assert.deepEqual(r.env, {
    WF_CAP: 'keyword_acquisition',
    WF_WORKFLOW: 'social-keyword-leadgen',
    WF_STAGES: '拉Commander,预检,取词单,发现·判定·采集·评分·配送,效果回写',
    WF_SOURCE_KIND: 'keyword',
    WF_DISCOVER_CMD: 'discover-keyword.sh',
    WF_MISSING: '',
  });
});

test('对标链接获客：发现未实现 → 默认拒跑（无实现不得跑）', () => {
  const r = planFor(fresh(), 'benchmark_link_acquisition');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /implementation=missing/.test(e) && /discovery\.open_benchmark_profile/.test(e)), r.errors.join('\n'));
});

test('对标链接获客 --allow-missing：benchmark 源 + discover-benchmark.sh，缺口记入 WF_MISSING', () => {
  const r = planFor(fresh(), 'benchmark_link_acquisition', { allowMissing: true });
  assert.deepEqual(r.errors, []);
  assert.equal(r.env.WF_CAP, 'benchmark_link_acquisition');
  assert.equal(r.env.WF_WORKFLOW, 'social-benchmark-leadgen');
  assert.equal(r.env.WF_STAGES, '拉Commander,预检,取对标源,对标发现·判定·采集·评分·配送,效果回写');
  assert.equal(r.env.WF_SOURCE_KIND, 'benchmark');
  assert.equal(r.env.WF_DISCOVER_CMD, 'discover-benchmark.sh');
  assert.match(r.env.WF_MISSING, /discovery\.open_benchmark_profile/);
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

test('CLI：关键词获客 stdout 可 eval，对标获客默认 exit 1', () => {
  const ok = cli('keyword_acquisition');
  assert.equal(ok.status, 0, ok.stderr);
  const r = spawnSync('bash', ['-c', `${ok.stdout}\nprintf '%s' "$WF_SOURCE_KIND/$WF_DISCOVER_CMD"`], { encoding: 'utf8' });
  assert.equal(r.stdout, 'keyword/discover-keyword.sh');
  const bad = cli('benchmark_link_acquisition');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /implementation=missing/);
  assert.equal(cli('benchmark_link_acquisition', '--allow-missing').status, 0);
  assert.equal(cli('no_such_cap').status, 1);
});

test('提交的 plans/*.plan 与契约重新生成的一致（改契约必须 --write 重生成）', () => {
  const r = cli('--check');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const kw = readFileSync(resolve(ROOT, PLANS_DIR, 'keyword_acquisition.plan'), 'utf8');
  assert.match(kw, /^WF_DISCOVER_CMD='discover-keyword\.sh'$/m);
});
