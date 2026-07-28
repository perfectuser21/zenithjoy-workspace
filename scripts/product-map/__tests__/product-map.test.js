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
import {
  loadAndValidateProductMap,
  validateSchema,
  validateRelations,
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

test('T3: staff_app/line00 精确 3 个 GP，ability_acceptance status=active', async () => {
  const { map } = await loadAndValidateProductMap();
  const line00Gps = map.golden_paths.filter(g => g.app_id === 'staff_app' && g.line_id === 'line00');
  assert.deepEqual(line00Gps.map(g => g.id).sort(), ['ability_acceptance', 'line_health', 'skill_acceptance']);

  const abilityGp = line00Gps.find(g => g.id === 'ability_acceptance');
  assert.equal(abilityGp.status, 'active');

  // Line 01/02/04 无任何 GP
  const customerGps = map.golden_paths.filter(g => ['line01', 'line02', 'line04'].includes(g.line_id));
  assert.equal(customerGps.length, 0, 'Line 01/02/04 须无 GP');
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
