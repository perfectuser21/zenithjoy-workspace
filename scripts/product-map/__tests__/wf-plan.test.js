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
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Ajv2020 from 'ajv/dist/2020.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContractsFromDisk } from '../contracts-lib.mjs';
import { planFor, jsonPlanFor, renderEnv, PLANS_DIR } from '../wf-plan.mjs';

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
    ...BUDGETS,
  });
});

// 7d150e33（阶段1）：契约每活动 budget.max_duration_s 编进计划（WF_BUDGET_<key>），执行器按它封顶各活动段；
// 超时时的失败分类 WF_TIMEOUT_CLASS_<key>：活动 failure.retryable 里有「超时/timeout/scp/ssh 失败」条目 → retryable（重试一次），
// 否则 record（记账后进入下一单元）。benchmark 的非 discovery 活动复用关键词预算；其发现预算仍独立为600秒。
const BUDGETS = {
  WF_BUDGET_preflight: '300', WF_BUDGET_discovery: '900', WF_BUDGET_qualification: '1800', WF_BUDGET_collection: '7200',
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
  assert.deepEqual(r.env, {
    WF_CAP: 'benchmark_link_acquisition',
    WF_WORKFLOW: 'social-benchmark-leadgen',
    WF_STAGES: '拉Commander,预检,取对标源,对标发现·判定·采集·评分·配送,效果回写',
    WF_SOURCE_KIND: 'benchmark',
    WF_DISCOVER_CMD: 'discover-benchmark.sh',
    WF_MISSING: '',
    ...BUDGETS,
    WF_BUDGET_discovery: '600',
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

const BINDINGS = resolve(ROOT, PLANS_DIR, 'keyword_activities.bindings.json');
function bindingsFixture({ scored = true } = {}) {
  const ctx = fresh();
  const io = key => structuredClone(act(ctx, 'keyword_acquisition', key));
  const phoneRuntime = (action, when) => ({ phase: 'per_item', entry: 'services/phone-adb-controller/video-activity.js',
    protocol: 'json-stdio-v1', argv: [action], input: { run_tag: '$.run_tag', line_key: '$.line_key', device: '$.device', video: '$item' },
    per_item: { group: 'videos', items: '$.videos', input: 'video', identity: 'video_id', ...(when ? { when } : {}) },
    on_failure: 'continue', max_attempts: 1, cleanup_grace_s: 10 });
  const batchRuntime = action => ({ phase: 'batch_end', entry: 'services/phone-adb-controller/comment-activity.js',
    protocol: 'json-stdio-v1', argv: [action], input: { run_tag: '$.run_tag', line_key: '$.line_key', comments: '$.comments' },
    on_failure: 'continue', max_attempts: 1, cleanup_grace_s: 10 });
  return { version: 1, capability: 'keyword_acquisition', source: { contract: 'product-map/contracts/keyword_acquisition.yaml', scope: 'activity-chain' },
    select: ['qualification', 'collection', ...(scored ? ['scoring'] : []), 'delivery'],
    trigger_inputs: ['Video', 'Device', 'Account', 'Run'], activities: {
      qualification: { runtime: phoneRuntime('qualification') },
      collection: { runtime: phoneRuntime('collection', { path: '$item.judgment_status', equals: 'matched' }) },
      ...(scored ? { scoring: { runtime: batchRuntime('scoring'), outputs: io('scoring').outputs.filter(o => o.type !== 'Lead') } } : {}),
      delivery: { runtime: batchRuntime('raw-delivery'), inputs: io('delivery').inputs.filter(i => i.type !== 'Lead'),
        outputs: [...io('delivery').outputs.filter(o => o.type === 'Comment'),
          ...(scored ? io('scoring').outputs.filter(o => o.type === 'Lead').map(o => ({ ...o, optional: true })) : [])] },
    } };
}
function jsonCli(bindings, cap = 'keyword_acquisition') {
  const file = resolve(mkdtempSync(resolve(tmpdir(), 'wf-json-')), 'bindings.json');
  writeFileSync(file, JSON.stringify(bindings));
  return cli(cap, '--json', '--bindings', file, '--allow-missing');
}

test('JSON真实CLI从opt-in绑定组装实际四活动，继承顺序/预算/来源并显式接本批产物', () => {
  const result = jsonCli(bindingsFixture());
  assert.equal(result.status, 0, result.stderr);
  const { contract } = JSON.parse(result.stdout);
  assert.equal(contract.workflow, 'social-keyword-leadgen');
  assert.deepEqual(contract.activities.map(a => [a.key, a.order]), [['qualification', 3], ['collection', 4], ['scoring', 5], ['delivery', 6]]);
  const [qualification, collection, scoring, delivery] = contract.activities;
  assert.equal(qualification.budget.max_duration_s, 1800);
  assert.deepEqual(qualification.source_contract, { capability: 'keyword_acquisition', version: '1.0.0' });
  assert.equal(qualification.runtime.input.video, '$item');
  assert.equal(collection.runtime.per_item.group, qualification.runtime.per_item.group);
  assert.deepEqual(collection.runtime.per_item.when, { path: '$item.judgment_status', equals: 'matched' });
  assert.deepEqual(scoring.runtime.argv, ['scoring']);
  assert.equal(scoring.runtime.input.comments, '$.comments');
  assert.deepEqual(delivery.runtime.argv, ['raw-delivery']);
  assert.equal(delivery.runtime.input.comments, '$.comments');
  assert.deepEqual(delivery.inputs.map(i => i.type), ['Video', 'Comment', 'Run']);
  assert.equal(delivery.outputs.find(o => o.type === 'Lead').optional, true);
  assert.deepEqual(Object.keys(JSON.parse(result.stdout)), ['contract']);
});

test('JSON无评分变体显式消费Comment而不要求或承诺Lead', () => {
  const result = jsonCli(bindingsFixture({ scored: false }));
  assert.equal(result.status, 0, result.stderr);
  const activities = JSON.parse(result.stdout).contract.activities;
  assert.deepEqual(activities.map(a => a.key), ['qualification', 'collection', 'delivery']);
  assert.deepEqual(activities.at(-1).outputs.map(o => o.type), ['Comment']);
});

test('JSON复用真实ref来源，不按select数组重排或改写真实元数据', () => {
  const bindings = bindingsFixture();
  bindings.capability = 'benchmark_link_acquisition';
  bindings.source.contract = 'product-map/contracts/benchmark_link_acquisition.yaml';
  bindings.select.reverse();
  const result = jsonCli(bindings, 'benchmark_link_acquisition');
  assert.equal(result.status, 0, result.stderr);
  const activities = JSON.parse(result.stdout).contract.activities;
  assert.deepEqual(activities.map(a => a.key), ['qualification', 'collection', 'scoring', 'delivery']);
  assert.deepEqual(activities[0].source_contract, { capability: 'keyword_acquisition', version: '1.0.0' });
});

test('JSON原契约schema不合法或未实现步骤不得由绑定遮盖', () => {
  const ctx = fresh();
  act(ctx, 'keyword_acquisition', 'scoring').runtime.unapproved = true;
  const invalid = jsonPlanFor(ctx, 'keyword_acquisition', { bindings: bindingsFixture(), allowMissing: true });
  assert.equal(invalid.ok, false); assert.match(invalid.errors.join('\n'), /schema/);
  delete act(ctx, 'keyword_acquisition', 'scoring').runtime.unapproved;
  act(ctx, 'keyword_acquisition', 'scoring').steps[0].implementation.status = 'missing';
  assert.equal(jsonPlanFor(ctx, 'keyword_acquisition', { bindings: bindingsFixture() }).ok, false);
  assert.equal(jsonPlanFor(ctx, 'keyword_acquisition', { bindings: bindingsFixture(), allowMissing: true }).ok, true);
});

test('JSON删评分但保留Lead必填或缺Comment来源，仍被真实组装闸拒绝', () => {
  for (const missing of ['Lead', 'Comment']) {
    const bindings = bindingsFixture({ scored: false });
    if (missing === 'Lead') bindings.activities.delivery.inputs = act(fresh(), 'keyword_acquisition', 'delivery').inputs;
    else { bindings.select = ['qualification', 'delivery']; delete bindings.activities.collection; }
    const result = jsonCli(bindings);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`${missing} 未由 trigger_inputs 或前序活动交出`));
    assert.equal(result.stdout, '');
  }
});

test('JSON真实CLI读取提交的绑定文件且旧YAML/shell计划仍不切换', () => {
  assert.ok(existsSync(BINDINGS), '缺opt-in绑定文件');
  const result = cli('keyword_acquisition', '--json', '--bindings', BINDINGS, '--allow-missing');
  assert.equal(result.status, 0, result.stderr);
  const activities = JSON.parse(result.stdout).contract.activities;
  assert.equal(activities.length, 4);
  assert.deepEqual(activities.map(a => a.runtime.entry), ['video-activity.js', 'video-activity.js', 'comment-activity.js', 'comment-activity.js']);
  assert.deepEqual(activities.slice(0, 2).map(a => a.runtime.cleanup_grace_s), [30, 30]);
  assert.equal(cli('--check').status, 0);
});

test('JSON不得静默忽略非法runtime、binding或重复选择；未绑定legacy也不得伪装JSON', () => {
  const mutations = [b => { b.activities.scoring.runtime.entry = '../steal.js'; },
    b => { b.activities.scoring.runtime.entry = 'node scoring.js; evil'; },
    b => { b.activities.scoring.runtime.max_attempts = 3; },
    b => { b.activities.scoring.unapproved = true; }, b => { b.select.push('scoring'); },
    b => { b.activities.scoring.runtime.input.comments = '$input.history'; }];
  for (const mutate of mutations) {
    const bindings = bindingsFixture(); mutate(bindings);
    assert.equal(jsonCli(bindings).status, 1);
  }
  const result = cli('keyword_acquisition', '--json', '--allow-missing');
  assert.equal(result.status, 1); assert.match(result.stderr, /json-stdio-v1/);
});

test('schema只对JSON允许安全相对JS/MJS/SH路径，legacy仍只允许原sh形式', () => {
  const schema = JSON.parse(readFileSync(resolve(ROOT, 'product-map/contracts/activity-contract.schema.json'), 'utf8'));
  const validate = new Ajv2020({ strict: true }).compile({ $defs: schema.$defs, $ref: '#/$defs/runtime' });
  const runtime = bindingsFixture().activities.scoring.runtime;
  assert.ok(validate(runtime), JSON.stringify(validate.errors));
  for (const entry of ['scoring.mjs', 'nested/entry.sh']) assert.ok(validate({ ...runtime, entry }));
  for (const entry of ['/tmp/run.js', '../run.js', 'a/../run.js', 'node a.js', 'a.js;evil', 'a//b.js']) assert.equal(validate({ ...runtime, entry }), false, entry);
  assert.ok(validate({ phase: 'batch_end', entry: 'batch2.sh' }));
  assert.equal(validate({ phase: 'batch_end', entry: 'scoring.js' }), false);
  const ctx = fresh(); act(ctx, 'keyword_acquisition', 'scoring').runtime = runtime;
  assert.ok(planFor(ctx, 'keyword_acquisition').errors.some(e => /JSON|json-stdio/.test(e)));
});

test('per_item.items只允许累计上下文顶层数组，避免schema放行执行器无法合并的nested路径', () => {
  const bindings = bindingsFixture();
  bindings.activities.qualification.runtime.per_item.items = '$.nested.videos';
  const result = jsonCli(bindings);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /schema/);
  assert.equal(result.stdout, '');
});
