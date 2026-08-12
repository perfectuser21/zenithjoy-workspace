/**
 * contract.test.js — Sprint 08122228 failing-first 合同测试
 *
 * 验证 product-map.yaml 编辑后的目标状态：
 *   7 Value Stream（line01/02/04/05/07/00/10）
 *   18 条非废弃 Golden Path，精确分布 line01=1/line02=4/line04=7/line05=1/line07=1/line00=3/line10=1
 *   deprecated 历史条目原样保留、不计入 18
 *   line05/07/10 三条新 GP 精确锚定既有 smoke（不新写业务代码）
 *   generate 后无漂移；Cecelia 仓库零改动；无越界新文件
 *
 * 运行: node --test sprints/08122228-zenithjoy-product-map-seven-streams/tests/contract.test.js
 *
 * 红证据（本文件在 generator 编辑 product-map.yaml 之前跑，预期全部 FAIL）：
 *   - T1 FAIL：apps[].lines 目前只有 4 条（line00/01/02/04），不含 line05/07/10
 *   - T2 FAIL：line00 目前非 deprecated GP 有 4 条，不是目标 3 条
 *   - T3 FAIL：非 deprecated GP 总数目前是 15（未含新增 line05/07/10 三条），不是 18
 *   - T4 FAIL：line05/07/10 尚未定义，smoke_files 断言拿不到值
 *   - T5 FAIL：deprecated 集合目前只有 2 个（customer_smart_acquisition/customer_private_ai），
 *              不含 skill_acceptance
 *   - T6（generate 幂等）通常仍能通过（generate 逻辑本身不依赖本次编辑），非本轮红证据必需项
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAndValidateProductMap, validateSmokeFiles, productMapDigest } from '../../../scripts/product-map/lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const JSON_OUT = resolve(REPO_ROOT, 'product-map/generated/product-map.json');

const WANT_LINES = ['line00', 'line01', 'line02', 'line04', 'line05', 'line07', 'line10'];
const WANT_DIST = { line01: 1, line02: 4, line04: 7, line05: 1, line07: 1, line00: 3, line10: 1 };
const WANT_DEPRECATED = ['customer_private_ai', 'customer_smart_acquisition', 'skill_acceptance'];
const ANCHOR_SMOKE = {
  line05: '.github/workflows/scripts/smoke/ai-video-pipeline-local-smoke.sh',
  line07: '.github/workflows/scripts/smoke/golden-path-7-video-remake-smoke.sh',
  line10: '.github/workflows/scripts/smoke/customer-admin-backend-smoke.sh',
};

// 每个测试独立重新生成投影，避免测试间状态串扰、也避免依赖某个测试的运行顺序先跑过 generate。
function regenerate() {
  execFileSync('node', ['scripts/product-map/cli.mjs', 'generate'], { cwd: REPO_ROOT, stdio: 'pipe' });
}

// ─── T1: 7 条 Line 精确匹配 ─────────────────────────────────────────────────

test('T1: apps[].lines 精确等于 7 条（line00/01/02/04/05/07/10）', async () => {
  const { map, errors } = await loadAndValidateProductMap();
  assert.deepEqual(errors, [], `product-map.yaml 须先通过 schema 校验: ${JSON.stringify(errors)}`);

  const allLineIds = map.apps.flatMap(a => a.lines.map(l => l.id)).sort();
  assert.deepEqual(allLineIds, WANT_LINES);

  const customerApp = map.apps.find(a => a.id === 'customer_app');
  const staffApp = map.apps.find(a => a.id === 'staff_app');
  assert.deepEqual(customerApp.lines.map(l => l.id).sort(), ['line01', 'line02', 'line04', 'line05', 'line07']);
  assert.deepEqual(staffApp.lines.map(l => l.id).sort(), ['line00', 'line10']);
});

// ─── T2: line00 收敛为 3 条非废弃 GP，ability_acceptance 保持 active ────────

test('T2: line00 精确 3 条非废弃 GP（skill_acceptance 已 deprecated，ability_acceptance 仍 active）', async () => {
  const { map } = await loadAndValidateProductMap();
  const line00Gps = map.golden_paths.filter(g => g.app_id === 'staff_app' && g.line_id === 'line00');

  // 4 条条目本身（含 deprecated）必须原样保留，不删除
  assert.deepEqual(line00Gps.map(g => g.id).sort(), ['ability_acceptance', 'gp_anchor_enforcement', 'line_health', 'skill_acceptance']);

  const nonDeprecated = line00Gps.filter(g => g.status !== 'deprecated');
  assert.equal(nonDeprecated.length, 3, `line00 非废弃 GP 须精确为 3 条，实际: ${JSON.stringify(nonDeprecated.map(g => g.id))}`);

  const skillGp = line00Gps.find(g => g.id === 'skill_acceptance');
  assert.equal(skillGp.status, 'deprecated', 'skill_acceptance 须标记 deprecated（判定点：决策 fc7b5dc0 重写的是验收/ability_acceptance，非 skill_acceptance）');

  const abilityGp = line00Gps.find(g => g.id === 'ability_acceptance');
  assert.equal(abilityGp.status, 'active', 'ability_acceptance 须保持 active（2026-07-31 决策 fc7b5dc0：Staff Hub 直连 Brain 重新实现）');

  const anchorGp = line00Gps.find(g => g.id === 'gp_anchor_enforcement');
  assert.equal(anchorGp.status, 'active', 'gp_anchor_enforcement 受 gp_anchor 保护，不可被本 sprint 动摇');
  assert.ok(anchorGp.smoke_files.includes('.github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh'), 'gp_anchor_enforcement 的 smoke_files 不可被改动');

  const healthGp = line00Gps.find(g => g.id === 'line_health');
  assert.equal(healthGp.status, 'active', 'line_health 本轮不受影响，须保持 active');
});

// ─── T3: 全局 18 条非废弃 GP，按 line 精确分布 ──────────────────────────────

test('T3: 非 deprecated Golden Path 总数精确为 18，按 line 分布精确匹配', async () => {
  const { map } = await loadAndValidateProductMap();
  const nonDeprecated = map.golden_paths.filter(g => g.status !== 'deprecated');
  assert.equal(nonDeprecated.length, 18, `非 deprecated GP 总数须为 18，实际: ${nonDeprecated.length}（${JSON.stringify(nonDeprecated.map(g => g.id))}）`);

  const distByLine = {};
  for (const gp of nonDeprecated) {
    distByLine[gp.line_id] = (distByLine[gp.line_id] || 0) + 1;
  }
  assert.deepEqual(distByLine, WANT_DIST, `按 line 分布须精确匹配，实际: ${JSON.stringify(distByLine)}`);

  // proposed 状态（line02 三条占位 GP）不算 deprecated，须计入非废弃统计（PRD 边界情况显式声明）
  const proposedIds = ['live_acquisition', 'video_link_acquisition', 'benchmark_link_acquisition'];
  for (const id of proposedIds) {
    const gp = nonDeprecated.find(g => g.id === id);
    assert.ok(gp, `${id} 须在非废弃集合内（proposed ≠ deprecated）`);
    assert.equal(gp.status, 'proposed', `${id} 须维持原 proposed 状态，不得本 sprint 改动`);
  }
});

// ─── T4: line05/07/10 三条新 GP 精确锚定既有 smoke，不新写业务代码 ─────────

test('T4: line05/07/10 三条新 GP 精确锚定 PRD 指定的既有 smoke 文件', async () => {
  const { map } = await loadAndValidateProductMap();

  for (const [lineId, smokePath] of Object.entries(ANCHOR_SMOKE)) {
    const gps = map.golden_paths.filter(g => g.line_id === lineId && g.status !== 'deprecated');
    assert.equal(gps.length, 1, `${lineId} 须精确 1 条非废弃 GP，实际: ${gps.length}`);
    const gp = gps[0];
    assert.ok(Array.isArray(gp.smoke_files) && gp.smoke_files.length > 0, `${lineId}/${gp.id} 须声明 smoke_files`);
    assert.deepEqual(gp.smoke_files, [smokePath], `${lineId}/${gp.id} smoke_files 须精确锚定既有文件 ${smokePath}`);
    assert.ok(existsSync(resolve(REPO_ROOT, smokePath)), `锚定的 smoke 文件须真实存在于仓库: ${smokePath}`);
    assert.ok(Array.isArray(gp.steps) && gp.steps.length > 0, `${lineId}/${gp.id} 须含非空 steps 数组`);
  }

  // 三个被锚定的 smoke 文件本身内容合格（≥5 非空行 + ≥1 真实命令），复用既有 validateSmokeFiles 质量判据，
  // 防止误锚定到未来可能被清空的占位文件
  const result = validateSmokeFiles(map, REPO_ROOT);
  assert.equal(result.ok, true, `smoke_files 校验须全部通过: ${JSON.stringify(result.errors)}`);
});

// ─── T5: deprecated 历史条目原样保留、精确为 3 个、不计入 18 ───────────────

test('T5: deprecated 集合精确为三个历史 id，原样保留不删除', async () => {
  const { map } = await loadAndValidateProductMap();
  const deprecatedIds = map.golden_paths.filter(g => g.status === 'deprecated').map(g => g.id).sort();
  assert.deepEqual(deprecatedIds, WANT_DEPRECATED);

  // 老 GP 的业务归属（app_id/line_id）不得被本 sprint 篡改
  const csa = map.golden_paths.find(g => g.id === 'customer_smart_acquisition');
  assert.equal(csa.line_id, 'line02');
  const cpa = map.golden_paths.find(g => g.id === 'customer_private_ai');
  assert.equal(cpa.line_id, 'line04');
  const sa = map.golden_paths.find(g => g.id === 'skill_acceptance');
  assert.equal(sa.line_id, 'line00');
});

// ─── T6: generate 后无漂移，digest 幂等 ─────────────────────────────────────

test('T6: product-map:generate 重建投影后 digest 与当前 YAML 一致（无漂移）', async () => {
  regenerate();
  const { map } = await loadAndValidateProductMap();
  const currentDigest = productMapDigest(map);

  assert.ok(existsSync(JSON_OUT), 'generate 后 product-map.json 须存在');
  const generatedJson = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
  assert.equal(generatedJson.digest, currentDigest, 'generate 产物 digest 须与当前 YAML digest 一致');

  // check 命令须以 PASS + exit 0 收尾
  const out = execFileSync('node', ['scripts/product-map/cli.mjs', 'check'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.match(out, /PASS: no drift/);
});

// ─── T7: 边界隔离 — Cecelia 仓库零改动 + 无越界新文件（git diff 静态检查）──

test('T7: git diff 变更路径全部落在允许前缀内，且不含 Cecelia / 不新建注册脚本', () => {
  let changed;
  try {
    changed = execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    // origin/main 在某些沙盒环境不可达时（无网络 fetch），退化为对比工作区未提交改动，
    // 仍然是同一条边界约束的弱化验证，不静默跳过。
    changed = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  }

  const ALLOWED = /^(product-map\/product-map\.yaml|product-map\/generated\/product-map\.(json|md)|scripts\/product-map\/__tests__\/.*|sprints\/.*)$/;
  const outOfScope = changed.filter(f => !ALLOWED.test(f));
  assert.deepEqual(outOfScope, [], `以下改动越界（超出允许路径前缀）: ${JSON.stringify(outOfScope)}`);

  const ceceliaTouched = changed.filter(f => /cecelia/i.test(f));
  assert.deepEqual(ceceliaTouched, [], `不得触碰 Cecelia 仓库路径: ${JSON.stringify(ceceliaTouched)}`);

  // 三个被锚定的 smoke 文件不得出现在变更列表里（证明是纯锚定既有文件，非新写/修改）
  for (const smokePath of Object.values(ANCHOR_SMOKE)) {
    assert.ok(!changed.includes(smokePath), `锚定 smoke 文件不得被本 sprint 修改: ${smokePath}`);
  }
});
