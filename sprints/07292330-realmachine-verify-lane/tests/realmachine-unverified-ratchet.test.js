/**
 * realmachine-unverified-ratchet.test.js — TDD Red 阶段
 *
 * 真机验证车道三层防假绿守卫 · 第3层 ci-patrol 棘轮指标单元测试。
 * 跟进 scripts/product-map/__tests__/gp-smoke-ratchet.test.js 的 node:test 原生模式
 * （非 vitest —— package.json test:product-map 脚本固定用 node --test 显式文件列表）。
 *
 * Generator 落地时：
 *   1. 把 computeRealmachineUnverifiedRatchet 加入 scripts/product-map/lib.mjs
 *   2. 把本文件复制到 scripts/product-map/__tests__/realmachine-unverified-ratchet.test.js
 *   3. package.json 的 test:product-map 脚本加上该文件路径
 *
 * 运行: node --test sprints/07292330-realmachine-verify-lane/tests/realmachine-unverified-ratchet.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRealmachineUnverifiedRatchet } from '../../../scripts/product-map/lib.mjs';

test('T1: nightly_ref 指向的脚本在 nightly yml 中被引用 → 计入已覆盖，不计数', () => {
  const markers = [
    { file: 'golden-path-2-smoke.sh', line: 1180, nightlyRef: 'account-scan-realmachine-smoke.sh' },
  ];
  const nightlyYaml = 'jobs:\n  account-scan:\n    steps:\n      - run: bash .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh\n';
  const result = computeRealmachineUnverifiedRatchet(markers, nightlyYaml);
  assert.equal(result.realmachine_unverified_count, 0);
  assert.deepEqual(result.realmachine_unverified_ids, []);
});

test('T2: nightly_ref 指向的脚本未在 nightly yml 中出现 → 计入未覆盖', () => {
  const markers = [
    { file: 'golden-path-98-smoke.sh', line: 5, nightlyRef: 'nonexistent-not-in-nightly.sh' },
  ];
  const nightlyYaml = 'jobs:\n  account-scan:\n    steps:\n      - run: bash .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh\n';
  const result = computeRealmachineUnverifiedRatchet(markers, nightlyYaml);
  assert.equal(result.realmachine_unverified_count, 1);
  assert.deepEqual(result.realmachine_unverified_ids, ['golden-path-98-smoke.sh:5']);
});

test('T3: 标记缺 nightly_ref（未声明覆盖来源）同样计入未覆盖', () => {
  const markers = [
    { file: 'golden-path-97-smoke.sh', line: 3, nightlyRef: null },
  ];
  const result = computeRealmachineUnverifiedRatchet(markers, 'jobs: {}');
  assert.equal(result.realmachine_unverified_count, 1);
  assert.deepEqual(result.realmachine_unverified_ids, ['golden-path-97-smoke.sh:3']);
});

test('T4: 混合场景 —— 已覆盖 + 未覆盖 + 缺nightly_ref 各一条，只计未覆盖两条', () => {
  const markers = [
    { file: 'a-smoke.sh', line: 1, nightlyRef: 'account-scan-realmachine-smoke.sh' },
    { file: 'b-smoke.sh', line: 2, nightlyRef: 'not-there.sh' },
    { file: 'c-smoke.sh', line: 3, nightlyRef: null },
  ];
  const nightlyYaml = 'run: bash .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh';
  const result = computeRealmachineUnverifiedRatchet(markers, nightlyYaml);
  assert.equal(result.realmachine_unverified_count, 2);
  assert.deepEqual(result.realmachine_unverified_ids, ['b-smoke.sh:2', 'c-smoke.sh:3']);
});

test('T5: markers 为空数组时不报错，计数为 0', () => {
  const result = computeRealmachineUnverifiedRatchet([], '');
  assert.equal(result.realmachine_unverified_count, 0);
  assert.deepEqual(result.realmachine_unverified_ids, []);
});
