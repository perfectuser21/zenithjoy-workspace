/**
 * gp-smoke-ratchet.test.js — GP 无 smoke 覆盖计数棘轮指标单元测试
 *
 * 刀5（GP锚定闭环 patrol 棘轮）：只做 GP 粒度（非 step 粒度，非目标②已拍板）
 * 运行: node --test scripts/product-map/__tests__/gp-smoke-ratchet.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGpSmokeRatchet } from '../lib.mjs';

test('T1: smoke_files 为 null 的 GP 被计入无覆盖', () => {
  const map = {
    golden_paths: [
      { id: 'gp_a', smoke_files: null },
      { id: 'gp_b', smoke_files: ['.github/workflows/scripts/smoke/x-smoke.sh'] },
    ],
  };
  const result = computeGpSmokeRatchet(map);
  assert.equal(result.gp_no_smoke_count, 1);
  assert.deepEqual(result.gp_no_smoke_ids, ['gp_a']);
});

test('T2: smoke_files 字段缺失（未声明）同样计入无覆盖', () => {
  const map = {
    golden_paths: [
      { id: 'gp_c' },
      { id: 'gp_d', smoke_files: ['.github/workflows/scripts/smoke/y-smoke.sh'] },
    ],
  };
  const result = computeGpSmokeRatchet(map);
  assert.equal(result.gp_no_smoke_count, 1);
  assert.deepEqual(result.gp_no_smoke_ids, ['gp_c']);
});

test('T3: smoke_files 为空数组同样计入无覆盖', () => {
  const map = {
    golden_paths: [{ id: 'gp_e', smoke_files: [] }],
  };
  const result = computeGpSmokeRatchet(map);
  assert.equal(result.gp_no_smoke_count, 1);
  assert.deepEqual(result.gp_no_smoke_ids, ['gp_e']);
});

test('T4: 全部 GP 都有 smoke_files 时计数为 0', () => {
  const map = {
    golden_paths: [
      { id: 'gp_f', smoke_files: ['.github/workflows/scripts/smoke/f-smoke.sh'] },
      { id: 'gp_g', smoke_files: ['.github/workflows/scripts/smoke/g-smoke.sh'] },
    ],
  };
  const result = computeGpSmokeRatchet(map);
  assert.equal(result.gp_no_smoke_count, 0);
  assert.deepEqual(result.gp_no_smoke_ids, []);
});

test('T5: golden_paths 为空数组时不报错，计数为 0', () => {
  const result = computeGpSmokeRatchet({ golden_paths: [] });
  assert.equal(result.gp_no_smoke_count, 0);
  assert.deepEqual(result.gp_no_smoke_ids, []);
});
