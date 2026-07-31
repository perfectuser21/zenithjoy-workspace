/**
 * product-map.test.js — Product Map SSOT 正式单元测试（7 个）
 *
 * Sprint ID: 9130f0be-8e8d-4cc5-96f5-7a5313804496
 * 运行: node --test scripts/product-map/__tests__/product-map.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  loadAndValidateProductMap,
  validateSchema,
  validateRelations,
  validateSmokeFiles,
  canonicalize,
  productMapDigest,
  assertBootstrapParity,
} from '../lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Test 1: 结构解析 ─────────────────────────────────────────────────────────

test('T1: loadAndValidateProductMap 解析两个 app，customer_app 有 line01/02/04，staff_app 有 line00', async () => {
  const { map, errors } = await loadAndValidateProductMap();
  assert.deepEqual(errors, [], `schema 错误: ${JSON.stringify(errors)}`);
  assert.ok(map !== null, 'map 须非 null');

  const appIds = map.apps.map(a => a.id).sort();
  assert.deepEqual(appIds, ['customer_app', 'staff_app']);

  const customerApp = map.apps.find(a => a.id === 'customer_app');
  const staffApp = map.apps.find(a => a.id === 'staff_app');
  assert.deepEqual(customerApp.lines.map(l => l.id).sort(), ['line01', 'line02', 'line04']);
  assert.deepEqual(staffApp.lines.map(l => l.id).sort(), ['line00']);
});

// ─── Test 2: 负向 schema 校验 ─────────────────────────────────────────────────

test('T2: validateSchema — 缺失 apps 字段时返回非空 errors', () => {
  const { errors } = validateSchema({ surfaces: ['web'], editions: ['wecom'], golden_paths: [] });
  assert.ok(errors.length > 0, '缺 apps 字段时 errors 须非空');
});

// ─── Test 3: 种子分类精确性 ───────────────────────────────────────────────────

test('T3: staff_app/line00 精确 4 个 GP（含gp_anchor_enforcement），ability_acceptance status=active（2026-07-31 决策fc7b5dc0覆盖07-29：验收收回自家前端直连Brain）', async () => {
  const { map } = await loadAndValidateProductMap();
  const line00Gps = map.golden_paths.filter(g => g.app_id === 'staff_app' && g.line_id === 'line00');
  assert.deepEqual(line00Gps.map(g => g.id).sort(), ['ability_acceptance', 'gp_anchor_enforcement', 'line_health', 'skill_acceptance']);

  const abilityGp = line00Gps.find(g => g.id === 'ability_acceptance');
  assert.equal(abilityGp.status, 'active', 'ability_acceptance 2026-07-31 重新实现（Staff Hub 直连 Brain），须为active');

  const anchorGp = line00Gps.find(g => g.id === 'gp_anchor_enforcement');
  assert.equal(anchorGp.status, 'active', 'gp_anchor_enforcement 刀1-5全部合并，§8验收标准满足，须为active');
  assert.ok(anchorGp.smoke_files.includes('.github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh'));

  // 客户侧 GP 定稿全景（2026-07-29 主理人拍板，task 58596a57）：
  // line01 首次成功 1 条；line02 拆 4 条获客（老 id 保留 deprecated 防锚点断裂）；
  // line04 细化为共享前置 + 智能客服六条（老 id 同样保留 deprecated）
  const customerGps = map.golden_paths.filter(g => ['line01', 'line02', 'line04'].includes(g.line_id));
  assert.deepEqual(
    customerGps.map(g => `${g.line_id}/${g.id}`).sort(),
    [
      'line01/customer_first_success',
      'line02/benchmark_link_acquisition',
      'line02/customer_smart_acquisition',
      'line02/keyword_acquisition',
      'line02/live_acquisition',
      'line02/video_link_acquisition',
      'line04/active_voice_outreach',
      'line04/business_report',
      'line04/cs_shared_binding',
      'line04/customer_private_ai',
      'line04/group_operation',
      'line04/moments_interaction',
      'line04/moments_publish',
      'line04/passive_reception',
    ]
  );
  // 老 GP 必须是 deprecated（拆分后不许悄悄复活）
  assert.equal(customerGps.find(g => g.id === 'customer_smart_acquisition').status, 'deprecated');
  assert.equal(customerGps.find(g => g.id === 'customer_private_ai').status, 'deprecated');
  // 唯一 working 的获客 GP 是关键词获客，且必须带 smoke（主理人：其余三条只是写出来占位）
  const keyword = customerGps.find(g => g.id === 'keyword_acquisition');
  assert.equal(keyword.status, 'active');
  assert.ok(keyword.smoke_files.includes('.github/workflows/scripts/smoke/golden-path-2-smoke.sh'));
  // 非 deprecated 的客户 GP 都必须有非空 steps（占位 proposed 的也要求写出步骤草案）；
  // deprecated 老 GP 的 steps 已迁入拆分后的子 GP，不再要求
  for (const gp of customerGps) {
    if (gp.status === 'deprecated') continue;
    assert.ok(Array.isArray(gp.steps) && gp.steps.length > 0, `${gp.id} 须含非空 steps 数组`);
  }
});

// ─── Test 8: smoke_files 存在性 + 非空占位校验（proven-to-fire）───────────────

test('T8: validateSmokeFiles — 缺失路径报错含具体路径；空文件占位报错', async () => {
  // 负向1: 路径不存在
  const fakeMap1 = { golden_paths: [{ id: 'test_gp', smoke_files: ['.github/workflows/scripts/smoke/nonexistent-fake.sh'] }] };
  const result1 = validateSmokeFiles(fakeMap1, process.cwd());
  assert.equal(result1.ok, false);
  assert.ok(result1.errors.some(e => e.includes('nonexistent-fake.sh')), `错误须含具体路径，实际: ${JSON.stringify(result1.errors)}`);

  // 正向: 真实存在且内容合法的 smoke 文件
  const { map } = await loadAndValidateProductMap();
  const result2 = validateSmokeFiles(map, process.cwd());
  assert.equal(result2.ok, true, `已注册的smoke_files须全部真实存在且非空占位，实际错误: ${JSON.stringify(result2.errors)}`);

  // grandfather: 未声明 smoke_files 字段的历史条目（skill_acceptance）不参与校验
  const skillAcceptance = map.golden_paths.find(g => g.id === 'skill_acceptance');
  assert.ok(skillAcceptance && !skillAcceptance.smoke_files, 'skill_acceptance 应保持无 smoke_files 字段（历史grandfather）');
});

// ─── Test 9: ajv 版本供应链冒烟断言 ────────────────────────────────────────────

test('T9: schema 能被当前 ajv 版本成功 compile（供应链版本漂移冒烟）', async () => {
  const Ajv2020 = (await import('ajv/dist/2020.js')).default;
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const schema = JSON.parse(readFileSync(resolve(__dirname, '../../../product-map/product-map.schema.json'), 'utf8'));
  assert.doesNotThrow(() => ajv.compile(schema), 'schema 须能被当前 ajv 成功 compile（版本升级/strict模式变化会在此处第一时间暴露）');
});

// ─── Test 10: YAML 语法错误诊断（非裸堆栈崩溃）───────────────────────────────

test('T10: loadAndValidateProductMap 对YAML语法错误返回结构化FAIL，不抛未捕获异常', async () => {
  const badYamlPath = resolve(__dirname, '../../../product-map/product-map.yaml');
  const original = readFileSync(badYamlPath, 'utf8');
  const fs = await import('node:fs');
  try {
    fs.writeFileSync(badYamlPath, original.replace('apps:', 'apps:\n   bad_indent:'));
    let caught = null;
    let result = null;
    try {
      result = await loadAndValidateProductMap();
    } catch (e) {
      caught = e;
    }
    if (caught) {
      assert.match(caught.message, /YAML syntax error/i, `裸抛异常须为结构化YAML语法错误消息，实际: ${caught.message}`);
    } else {
      assert.ok(result.errors.some(e => /YAML syntax error/i.test(e)), `result.errors须含YAML syntax error，实际: ${JSON.stringify(result.errors)}`);
    }
  } finally {
    fs.writeFileSync(badYamlPath, original);
  }
});

// ─── Test 4: 关系校验通过 ─────────────────────────────────────────────────────

test('T4: validateRelations — 有效 map 返回空数组', async () => {
  const { map } = await loadAndValidateProductMap();
  const errors = validateRelations(map);
  assert.deepEqual(errors, []);
});

// ─── Test 5: 关系校验 — 3 个负向用例 ─────────────────────────────────────────

test('T5: validateRelations 负向 — missing_app / mobile surface / duplicate GP id', async () => {
  const { map } = await loadAndValidateProductMap();

  // 负向 1: unknown app_id
  const badMap1 = { ...map, golden_paths: [...map.golden_paths, { id: 'bad1', app_id: 'missing_app', line_id: 'line00', status: 'active' }] };
  const errors1 = validateRelations(badMap1);
  assert.ok(errors1.some(e => e.toLowerCase().includes('references unknown app')), `须含 "references unknown app"，实际: ${JSON.stringify(errors1)}`);

  // 负向 2: unknown surface
  const badMap2 = { ...map, golden_paths: [...map.golden_paths, { id: 'bad2', app_id: 'staff_app', line_id: 'line00', status: 'active', required_surfaces: ['mobile'] }] };
  const errors2 = validateRelations(badMap2);
  assert.ok(errors2.some(e => e.toLowerCase().includes('references unknown surface')), `须含 "references unknown surface"，实际: ${JSON.stringify(errors2)}`);

  // 负向 3: duplicate GP id
  const dupGp = { ...map.golden_paths[0] };
  const badMap3 = { ...map, golden_paths: [...map.golden_paths, dupGp] };
  const errors3 = validateRelations(badMap3);
  assert.ok(errors3.some(e => e.toLowerCase().includes('duplicate')), `须含 "duplicate"，实际: ${JSON.stringify(errors3)}`);
});

// ─── Test 6: 确定性投影 ───────────────────────────────────────────────────────

test('T6: productMapDigest 确定性 — 同一 map 两次调用返回相同 hex', async () => {
  const { map } = await loadAndValidateProductMap();
  const d1 = productMapDigest(map);
  const d2 = productMapDigest(map);
  assert.equal(d1, d2, 'digest 须确定性');
  assert.match(d1, /^[a-f0-9]{64}$/, 'digest 须为 64 字符 hex');
});

// ─── Test 7: Bootstrap Parity ─────────────────────────────────────────────────

test('T7: assertBootstrapParity — 正常 doc 通过；注入 customer_app 抛 "duplicates Product Map fact"', async () => {
  const { map } = await loadAndValidateProductMap();

  // 正向：干净 doc 通过
  assert.doesNotThrow(() => assertBootstrapParity(map, { 'AGENTS.md': '# AGENTS\nSee product-map/generated/product-map.md\nnpm run product-map:check' }));

  // 负向：注入分类 ID
  assert.throws(
    () => assertBootstrapParity(map, { 'AGENTS.md': '# AGENTS\ncustomer_app lives here' }),
    (err) => err.message.toLowerCase().includes('duplicates product map fact'),
    '须抛出 "duplicates Product Map fact"'
  );
});
