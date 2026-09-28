/**
 * contracts.test.js — 主干活动契约（决策 3240824c / f18f56b8，任务 5b4605eb）
 *
 * 契约 = 接口：product-map/contracts/<能力>.yaml 按 15 字段描述每个主干活动。
 * 这里钉三件事：①格式（schema + 对象类型表 + 探针交叉引用）②组装闸（输入类型必须由
 * 前序活动交出；账本/探针里出现的阶段必须有契约）③验收：对标链接获客只换「发现」即组装成功。
 * 运行: node --test scripts/product-map/__tests__/contracts.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadContractsFromDisk,
  validateContracts,
  assemble,
  contractsDigest,
} from '../contracts-lib.mjs';

const DESIGN_ORDER = ['preflight', 'discovery', 'qualification', 'collection', 'scoring', 'delivery', 'outreach', 'cleanup'];
const clone = (x) => JSON.parse(JSON.stringify(x));
const fresh = () => loadContractsFromDisk();
const act = (ctx, cap, key) => ctx.contracts[cap].activities.find((a) => a.key === key);
const expectError = (ctx, re) => {
  const errors = validateContracts(ctx);
  assert.ok(errors.some((e) => re.test(e)), `应报 ${re}，实际：\n${errors.join('\n')}`);
};

// ── 真实仓库 ────────────────────────────────────────────────────────────────

test('真实契约零错误', () => {
  assert.deepEqual(validateContracts(fresh()), []);
});

test('关键词获客：8 个主干活动按设计顺序（判定在采集之前）', () => {
  const r = assemble(fresh(), 'keyword_acquisition');
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
  assert.deepEqual(r.activities.map((a) => a.key), DESIGN_ORDER);
});

test('每个活动 15 字段齐全，后置条件全部挂 error 级探针', () => {
  const ctx = fresh();
  for (const a of ctx.contracts.keyword_acquisition.activities) {
    for (const f of ['key', 'version', 'compatibility', 'owner', 'inputs', 'outputs', 'preconditions', 'postconditions',
      'execution', 'budget', 'resources', 'idempotency', 'failure', 'side_effects', 'invokers']) {
      assert.ok(f in a, `${a.key} 缺 ${f}`);
    }
    assert.ok(a.postconditions.length >= 1, `${a.key} 无后置条件`);
  }
});

test('步骤 key 全 snake_case 不带序号、活动内唯一，顺序靠 order', () => {
  for (const a of fresh().contracts.keyword_acquisition.activities) {
    const keys = a.steps.map((s) => s.key);
    assert.equal(new Set(keys).size, keys.length, `${a.key} 步骤 key 重复`);
    for (const k of keys) assert.match(k, /^[a-z][a-z_]*[a-z]$/, `${a.key}.${k} 须 snake_case 且不含数字序号`);
  }
});

test('验收：对标链接获客只自带「发现」，其余 7 个活动原样引用关键词获客，组装成功', () => {
  const ctx = fresh();
  const bench = ctx.contracts.benchmark_link_acquisition;
  const own = bench.activities.filter((a) => !a.ref).map((a) => a.key);
  assert.deepEqual(own, ['discovery']);
  const refs = bench.activities.filter((a) => a.ref).map((a) => a.ref).sort();
  assert.deepEqual(refs, DESIGN_ORDER.filter((k) => k !== 'discovery').map((k) => `keyword_acquisition.${k}`).sort());
  const r = assemble(ctx, 'benchmark_link_acquisition');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.activities.map((a) => `${a.key}@${a.from}`), DESIGN_ORDER.map((k) =>
    `${k}@${k === 'discovery' ? 'benchmark_link_acquisition' : 'keyword_acquisition'}`));
});

test('对标发现与关键词发现交出同一对象类型（Video），这是可替换的前提', () => {
  const ctx = fresh();
  const types = (a) => a.outputs.map((o) => o.type).sort();
  assert.deepEqual(types(act(ctx, 'benchmark_link_acquisition', 'discovery')), types(act(ctx, 'keyword_acquisition', 'discovery')));
});

test('哈希：稳定、按活动分项；改一个字段只变该活动与所属能力', () => {
  const a = contractsDigest(fresh());
  assert.deepEqual(a, contractsDigest(fresh()));
  assert.match(a.capabilities.keyword_acquisition.sha256, /^[0-9a-f]{64}$/);
  const ctx = fresh();
  act(ctx, 'keyword_acquisition', 'scoring').budget.max_duration_s += 1;
  const b = contractsDigest(ctx);
  assert.notEqual(b.capabilities.keyword_acquisition.sha256, a.capabilities.keyword_acquisition.sha256);
  assert.notEqual(b.capabilities.keyword_acquisition.activities.scoring, a.capabilities.keyword_acquisition.activities.scoring);
  assert.equal(b.capabilities.keyword_acquisition.activities.preflight, a.capabilities.keyword_acquisition.activities.preflight);
});

// ── proven-to-fire：组装闸必须真报红 ───────────────────────────────────────

test('删掉「判定」契约 → 账本 stage 无契约 + 组装失败', () => {
  const ctx = fresh();
  ctx.contracts.keyword_acquisition.activities = ctx.contracts.keyword_acquisition.activities.filter((a) => a.key !== 'qualification');
  expectError(ctx, /qualification.*无契约/);
  assert.equal(assemble(ctx, 'keyword_acquisition').ok, false);
});

test('输入类型断链（采集要 Comment 以外的前序未交出类型）→ 组装失败', () => {
  const ctx = fresh();
  act(ctx, 'keyword_acquisition', 'collection').inputs.push({ type: 'BenchmarkAccount', cardinality: 'one', required_fields: ['sec_uid'] });
  const r = assemble(ctx, 'keyword_acquisition');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /collection.*BenchmarkAccount/.test(e)), r.errors.join('\n'));
});

test('后置条件引用不存在的探针 → 报错', () => {
  const ctx = fresh();
  act(ctx, 'keyword_acquisition', 'preflight').postconditions.push({ probe: 'no_such_probe', asserts: 'x' });
  expectError(ctx, /no_such_probe/);
});

test('后置条件探针 stage 与活动不符 → 报错', () => {
  const ctx = fresh();
  act(ctx, 'keyword_acquisition', 'preflight').postconditions.push({ probe: 'videos_readback', asserts: 'x' });
  expectError(ctx, /videos_readback.*stage/);
});

test('探针被降成 warn → 报错（每步拦截）', () => {
  const ctx = fresh();
  const probe = Object.values(ctx.checks)[0].probes.find((p) => p.key === 'pool_advanced');
  probe.severity = 'warn';
  expectError(ctx, /pool_advanced.*error/);
});

test('步骤缺确定性判定 → schema 拒', () => {
  const ctx = fresh();
  delete act(ctx, 'keyword_acquisition', 'discovery').steps[0].check;
  expectError(ctx, /check/);
});

test('步骤 uses_llm 但活动无 model → 报错', () => {
  const ctx = fresh();
  const a = act(ctx, 'keyword_acquisition', 'preflight');
  a.steps[0].uses_llm = true;
  delete a.model;
  expectError(ctx, /preflight.*model/);
});

test('needs_human 无告警对象 → schema 拒', () => {
  const ctx = fresh();
  delete act(ctx, 'keyword_acquisition', 'outreach').failure.needs_human.alert;
  expectError(ctx, /alert/);
});

test('失败语义出现闭集外分类 → schema 拒', () => {
  const ctx = fresh();
  act(ctx, 'keyword_acquisition', 'discovery').failure.other = ['x'];
  expectError(ctx, /failure/);
});

test('字段不在对象类型表 → 报错', () => {
  const ctx = fresh();
  act(ctx, 'keyword_acquisition', 'discovery').outputs[0].fields.push('no_such_field');
  expectError(ctx, /no_such_field/);
});

test('步骤读了本活动没拿到的类型 → 报错', () => {
  const ctx = fresh();
  act(ctx, 'keyword_acquisition', 'preflight').steps[0].reads.push('Lead.douyin_id');
  expectError(ctx, /preflight\..*Lead/);
});

test('能力不在 product-map.yaml → 报错', () => {
  const ctx = fresh();
  ctx.contracts.no_such_cap = { ...clone(ctx.contracts.keyword_acquisition), capability: 'no_such_cap' };
  expectError(ctx, /no_such_cap.*product-map/);
});

test('ref 指向不存在的活动 → 报错', () => {
  const ctx = fresh();
  ctx.contracts.benchmark_link_acquisition.activities.find((a) => a.ref).ref = 'keyword_acquisition.nope';
  expectError(ctx, /keyword_acquisition\.nope/);
});
