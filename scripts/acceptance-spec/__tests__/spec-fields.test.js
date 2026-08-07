/**
 * spec-fields.test.js — 口径定案表逐项断言（D1 数据层地基）
 *
 * 规程 yaml 的静态属性（kind / scenario_class / verifiable_by / hard）是建单生成器
 * 与 Brain acceptance_checks 的唯一 SSOT。本文件把定案表的每一条数出来钉死，
 * 任何人改 yaml 改漏一格都会在这里报出具体格号。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAndValidateSpec } from '../lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

/** 建行格 = 非 fixedNa 步骤下、排除 na:true 的格 */
function buildCells(spec) {
  const out = [];
  for (const step of spec.steps) {
    if (step.fixedNa === true) continue;
    for (const ck of ['c1', 'c2', 'c3', 'c4']) {
      const cell = step.cells[ck];
      if (cell.na === true) continue;
      out.push({ id: `S${step.n}-${ck}`, ...cell });
    }
  }
  return out;
}

async function loadCells() {
  const { spec, errors } = await loadAndValidateSpec();
  assert.deepEqual(errors, [], `规程文件校验失败: ${errors.join('; ')}`);
  return { spec, cells: buildCells(spec) };
}

test('建行格恰 36', async () => {
  const { cells } = await loadCells();
  assert.equal(cells.length, 36);
});

test('J14-A 每个建行格都有合法 kind', async () => {
  const { cells } = await loadCells();
  const bad = cells.filter(c => !['FR', 'NFR', 'Invariant', 'SOP'].includes(c.kind));
  assert.deepEqual(bad.map(c => c.id), []);
});

test('kind 四类基数：FR 20 / NFR 4 / Invariant 9 / SOP 3', async () => {
  const { cells } = await loadCells();
  const count = k => cells.filter(c => c.kind === k).length;
  assert.deepEqual(
    { FR: count('FR'), NFR: count('NFR'), Invariant: count('Invariant'), SOP: count('SOP') },
    { FR: 20, NFR: 4, Invariant: 9, SOP: 3 }
  );
});

test('S14-c1 虽不建行也必须带 kind: SOP（红线13 是员工规程，schema else 分支要求 kind）', async () => {
  const { spec } = await loadCells();
  const s14c1 = spec.steps.find(s => s.n === 14).cells.c1;
  assert.equal(s14c1.kind, 'SOP');
});

test('S13-c4 改判后 human_only 17 / machine_db 19', async () => {
  const { cells } = await loadCells();
  const by = v => cells.filter(c => c.verifiable_by === v).length;
  assert.equal(by('human_only'), 17);
  assert.equal(by('machine_db'), 19);
});

test('S13-c4 的 verifiable_by 是 human_only（只改这一格）', async () => {
  const { cells } = await loadCells();
  assert.equal(cells.find(c => c.id === 'S13-c4').verifiable_by, 'human_only');
});

test('时限三格仍留在 machine_db（拍板 ① 后 AI 自持计时）', async () => {
  const { cells } = await loadCells();
  for (const id of ['S7-c2', 'S9-c2', 'S4-c2']) {
    assert.equal(cells.find(c => c.id === id).verifiable_by, 'machine_db', `${id} 应为 machine_db`);
  }
});

test('hard 恰 8 格', async () => {
  const { cells } = await loadCells();
  assert.deepEqual(
    cells.filter(c => c.hard === true).map(c => c.id),
    ['S2-c4', 'S5-c4', 'S6-c4', 'S8-c4', 'S10-c4', 'S11-c4', 'S12-c4', 'S13-c4']
  );
});

test('A17① scenario_class 三集合与台账逐格相等', async () => {
  const { cells } = await loadCells();
  const of = v => cells.filter(c => c.scenario_class === v).map(c => c.id).sort();
  assert.deepEqual(of('mandatory'), ['S10-c4', 'S4-c2', 'S4-c3', 'S5-c3', 'S5-c4'].sort());
  assert.deepEqual(of('unverifiable_this_version'), ['S13-c4']);
});

test('A17① opportunistic 恰为空集（失败即说明有人重新引入了 opportunistic 格，必须同批补回闸②/Q3″/scenario_falsified 整套机制）', async () => {
  const { cells } = await loadCells();
  assert.equal(cells.filter(c => c.scenario_class === 'opportunistic').length, 0);
});

test('A17⑥ mandatory ∩ machine_db 基数为 5', async () => {
  const { cells } = await loadCells();
  const hit = cells.filter(c => c.scenario_class === 'mandatory' && c.verifiable_by === 'machine_db');
  assert.equal(hit.length, 5);
});

test('拍板② op 加厚：S5 含掉线场景、S10 含二次采集对照', async () => {
  const { spec } = await loadCells();
  const op = n => spec.steps.find(s => s.n === n).op;
  assert.ok(op(5).includes('掉线'), `S5 op 应含掉线场景，实际: ${op(5)}`);
  assert.ok(op(10).includes('再发起一次采集'), `S10 op 应含二次采集对照，实际: ${op(10)}`);
});

test('scenario_required 已从 cells-map 迁走（静态属性单一 SSOT 在 yaml）', () => {
  const src = readFileSync(resolve(REPO_ROOT, 'scripts/acceptance-spec/ai-run/cells-map.mjs'), 'utf8');
  assert.ok(!src.includes('scenario_required'), 'cells-map.mjs 不应再出现 scenario_required');
});
