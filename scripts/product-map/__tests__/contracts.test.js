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
import { stepDodSpec } from '../contracts-lib.mjs';
import { readFileSync as readFileSyncCt } from 'node:fs';

const DESIGN_ORDER = ['preflight', 'discovery', 'qualification', 'collection', 'scoring', 'delivery', 'outreach', 'cleanup'];
const clone = (x) => JSON.parse(JSON.stringify(x));
const fresh = () => loadContractsFromDisk();
const act = (ctx, cap, key) => ctx.contracts[cap].activities.find((a) => a.key === key);
const expectError = (ctx, re) => {
  const errors = validateContracts(ctx);
  assert.ok(errors.some((e) => re.test(e)), `应报 ${re}，实际：\n${errors.join('\n')}`);
};

test('对标清单展开共享36步但保持关键词规范身份，独有4步归对标', () => {
  const ctx = fresh(), keyword = stepDodSpec(ctx, 'keyword_acquisition'), benchmark = stepDodSpec(ctx, 'benchmark_link_acquisition');
  assert.equal(keyword.steps.length, 44); assert.equal(benchmark.steps.length, 40);
  const shared = benchmark.steps.filter(s => s.key.startsWith('keyword_acquisition.'));
  assert.equal(shared.length, 36);
  for (const s of shared) {
    assert.ok(keyword.steps.some(k => k.key === s.key));
    assert.equal(s.usage.workflow_key, 'douyin_benchmark_leadgen');
    assert.equal(s.usage.slot_key, s.activity);
  }
  assert.equal(benchmark.steps.filter(s => s.key.startsWith('benchmark_link_acquisition.discovery.')).length, 4);
  assert.equal(benchmark.brain_workflow_key, 'douyin_benchmark_leadgen');
  assert.deepEqual(JSON.parse(readFileSyncCt(new URL('../../../services/phone-adb-controller/plans/benchmark_link_acquisition.steps.json', import.meta.url), 'utf8')), benchmark);
});
test('结构化实现引用允许契约来源版本，拒绝浮动main及越界路径', () => {
  const ctx = fresh(), a = act(ctx, 'keyword_acquisition', 'preflight');
  a.implementation_bindings = [{ kind: 'code', repo: 'perfectuser21/zenithjoy-workspace', path: 'services/phone-adb-controller/wf-run.sh', revision: 'contract' }];
  assert.deepEqual(validateContracts(ctx), []);
  a.implementation_bindings[0].revision = 'main'; expectError(ctx, /revision/);
  a.implementation_bindings[0].revision = 'contract'; a.implementation_bindings[0].path = '../secret'; expectError(ctx, /path/);
});

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
  act(ctx, 'keyword_acquisition', 'preflight').postconditions.push({ probe: 'no_such_probe', asserts: '不存在的探针' });
  expectError(ctx, /no_such_probe/);
});

test('后置条件探针 stage 与活动不符 → 报错', () => {
  const ctx = fresh();
  act(ctx, 'keyword_acquisition', 'preflight').postconditions.push({ probe: 'videos_readback', asserts: '挂错阶段的探针' });
  expectError(ctx, /videos_readback.*stage/);
});

test('探针被降成 warn → 报错（每步拦截）', () => {
  const ctx = fresh();
  const probe = Object.values(ctx.checks).flatMap((d) => d.probes).find((p) => p.key === 'pool_advanced');
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

// ── 任务 8bb3af55：先判后采落地后，契约不得再把「判定在采集之后」挂成已知缺口 ──
test('先判后采（8bb3af55）：候选落库/标记已采两步已实现，契约不再挂 8bb3af55 缺口', () => {
  const ctx = fresh();
  const step = (a, k) => act(ctx, 'keyword_acquisition', a).steps.find((s) => s.key === k);
  assert.equal(step('discovery', 'persist_candidates').implementation.status, 'implemented');
  assert.equal(step('collection', 'mark_video_collected').implementation.status, 'implemented');
  const doc = ctx.contracts.keyword_acquisition;
  const gaps = [...(doc.known_gaps || []), ...doc.activities.flatMap((a) => a.known_gaps || [])];
  assert.deepEqual(gaps.filter((g) => g.task === '8bb3af55').map((g) => g.gap), []);
  assert.match(act(ctx, 'keyword_acquisition', 'qualification').execution.via, /qualify-video\.js/);
});

// ── 任务 6b133a81：后置条件运行时拦截——探针的失败语义必须落在所属活动的 failure 闭集里 ──
test('每条后置条件探针的 failure_class 必须是所属活动 failure 里声明过（非空）的分类', () => {
  const ctx = fresh();
  const probes = Object.values(ctx.checks).flatMap((d) => d.probes);
  for (const a of ctx.contracts.keyword_acquisition.activities) {
    for (const pc of a.postconditions) {
      const p = probes.find((x) => x.key === pc.probe);
      const cls = p.failure_class;
      const declared = cls === 'needs_human' ? a.failure.needs_human.cases : a.failure[cls];
      assert.ok(Array.isArray(declared) && declared.length > 0, `${a.key}.${pc.probe} failure_class=${cls} 未在活动 failure 声明`);
    }
  }
});

test('探针 failure_class 落在活动未声明的分类 → 报错（proven-to-fire）', () => {
  const ctx = fresh();
  const probe = Object.values(ctx.checks).flatMap((d) => d.probes).find((p) => p.key === 'pool_advanced');
  probe.failure_class = 'fatal';   // scoring.failure.fatal = []
  expectError(ctx, /pool_advanced.*fatal/);
});

test('契约 known_gaps 不再挂 6b133a81（运行时读回+拦截已全部落地）', () => {
  const doc = fresh().contracts.keyword_acquisition;
  const gaps = [...(doc.known_gaps || []), ...doc.activities.flatMap((a) => a.known_gaps || [])];
  assert.deepEqual(gaps.filter((g) => g.task === '6b133a81').map((g) => g.gap), []);
});

// ── 任务 9032cdad：步骤 DoD 可执行化（决策 2a60378a）——文字 check 旁挂结构化 dod，生成物随部署下发 ──

test('44 个步骤全部带 dod：mode ∈ checkpoint|hard；none 须写 reason；hard 不得是 none', () => {
  const steps = fresh().contracts.keyword_acquisition.activities.flatMap((a) => a.steps.map((s) => ({ ...s, act: a.key })));
  assert.equal(steps.length, 44);
  for (const s of steps) {
    assert.ok(s.dod, `${s.act}.${s.key} 缺 dod`);
    assert.ok(['checkpoint', 'hard'].includes(s.dod.mode));
    if (s.dod.readback.type === 'none') assert.ok(s.dod.reason, `${s.act}.${s.key} 读不回须写原因`);
  }
});

// 0930 决策 f425e3fd：采集里每张卡片处理完的「归位」此前在 43 步契约里没有自己的步骤——它藏在 collection 实现里，
// 三次修复（草稿页误判/漏切视频 tab/锁被占）都没有一个格子能变红。补成独立步骤，读回 metrics.rescan_rate（兜底重搜/打开作品数
// = 1 − 一次做对率 %C&A），checkpoint 起步。
test('collection 有 return_to_results 步（归位一次做对率）：metric rescan_rate <= 0.3，checkpoint', () => {
  const s = act(fresh(), 'keyword_acquisition', 'collection').steps.find((x) => x.key === 'return_to_results');
  assert.ok(s, 'collection 缺 return_to_results 步');
  assert.equal(s.dod.mode, 'checkpoint');
  assert.deepEqual(s.dod.readback, { type: 'metric', ref: 'metrics.rescan_rate', expect: { op: '<=', value: 0.3 } });
});

test('生成物 step-dod.json 与契约一致（改契约必须重跑 gen-step-dod.mjs）', () => {
  const want = stepDodSpec(fresh(), 'keyword_acquisition');
  const got = JSON.parse(readFileSyncCt(new URL('../../../services/phone-adb-controller/step-dod.json', import.meta.url), 'utf8'));
  assert.deepEqual(got, want);
});

test('dod 缺失 / none 无 reason / hard 却 none / sql 不带 $RUN_TAG / at 指向前序活动 → 报错（proven-to-fire）', () => {
  const s0 = (ctx) => act(ctx, 'keyword_acquisition', 'delivery').steps[0];
  let ctx = fresh(); delete s0(ctx).dod; expectError(ctx, /dod/);
  ctx = fresh(); s0(ctx).dod = { mode: 'checkpoint', readback: { type: 'none' } }; expectError(ctx, /reason/);
  ctx = fresh(); s0(ctx).dod = { mode: 'hard', readback: { type: 'none' }, reason: '读不回的原因写在这里' }; expectError(ctx, /hard.*none/);
  ctx = fresh(); s0(ctx).dod = { mode: 'checkpoint', readback: { type: 'sql', query: 'SELECT 1', expect: { op: '>=', value: 1 } } }; expectError(ctx, /RUN_TAG/);
  ctx = fresh(); s0(ctx).dod = { mode: 'checkpoint', at: 'preflight', readback: { type: 'metric', ref: 'metrics.videos_pushed', expect: { op: '>=', value: 0 } } }; expectError(ctx, /at/);
});

test('两真实Workflow四调用位置各自声明Enabler完整文件来源，实际manifest可固定全部字节', async () => {
  const {deploymentManifest}=await import('../../../services/phone-adb-controller/deployment-manifest.mjs');
  const {fileURLToPath}=await import('node:url');
  const root=fileURLToPath(new URL('../../../',import.meta.url));
  const lock=['douyin-phone-adb','phone-lock-lib.sh','phone-lock-helper.py'];
  const expected={preflight:{device_lock:lock,account_selfcheck:['douyin-phone-adb']},collection:{return_to_results:['douyin-phone-adb']},cleanup:{device_lock:lock}};
  const manifest=deploymentManifest(root,lock);
  const deploy=readFileSyncCt(new URL('../../../services/phone-adb-controller/deploy.sh',import.meta.url),'utf8');
  const deviceFiles=/DEVICE_CTL_FILES=\(([\s\S]*?)\)/.exec(deploy)[1].trim().split(/\s+/);
  for(const name of lock)assert.ok(deviceFiles.includes(name),`实际部署清单缺${name}`);
  for(const cap of ['keyword_acquisition','benchmark_link_acquisition']){
    const activities=assemble(fresh(),cap).activities;
    for(const [key,groups] of Object.entries(expected))for(const [enabler,files] of Object.entries(groups)){
      const a=activities.find(a=>a.key===key),bindings=a.implementation_bindings.filter(b=>b.enabler_key===enabler);
      assert.deepEqual(bindings.map(b=>b.path.split('/').at(-1)),files,`${cap}/${key}/${enabler}`);
      for(const b of bindings){
        assert.equal(b.kind,'code');assert.equal(b.revision,'contract');assert.equal(b.repo,'perfectuser21/zenithjoy-workspace');assert.equal(b.symbol,undefined);
        assert.ok(manifest.files.some(f=>f.path===b.path&&/^[a-f0-9]{64}$/.test(f.content_sha256)));
      }
    }
  }
});
test('Enabler声明schema只允许非空稳定键，保留显式固定文件规则',()=>{
  const ctx=fresh(),a=act(ctx,'keyword_acquisition','preflight');
  a.implementation_bindings[0].enabler_key='device_lock';assert.deepEqual(validateContracts(ctx),[]);
  a.implementation_bindings[0].enabler_key='';expectError(ctx,/enabler_key/);
  a.implementation_bindings[0].enabler_key='../other';expectError(ctx,/enabler_key/);
});
