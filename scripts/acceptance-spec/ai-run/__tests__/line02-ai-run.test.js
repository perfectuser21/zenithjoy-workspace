import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getMachineCellIds,
  checkCellsMapComplete,
  validateAiColumn,
} from '../lib.mjs';
import { CELLS_MAP } from '../cells-map.mjs';

test('规程文件里 machine_db 格正好 19 个，格号格式 S<步>-c<列>', async () => {
  const ids = await getMachineCellIds();
  assert.equal(ids.length, 19);
  for (const id of ids) {
    assert.match(id, /^S\d+-c[1-4]$/, `格号格式不对: ${id}`);
  }
});

test('cells-map 与规程文件 machine_db 格 1:1，多一格少一格都报错且带具体格号', async () => {
  const { errors } = await checkCellsMapComplete(CELLS_MAP);
  assert.deepEqual(errors, [], `映射与规程不一致: ${JSON.stringify(errors)}`);

  // 少一格 → 报错必须点名少的是哪格
  const oneMissing = CELLS_MAP.filter(c => c.id !== 'S7-c1');
  const r1 = await checkCellsMapComplete(oneMissing);
  assert.ok(r1.errors.length > 0);
  assert.ok(r1.errors.some(e => e.includes('S7-c1')), `报错未点名缺失格号: ${JSON.stringify(r1.errors)}`);

  // 多一个规程里不存在的格 → 也报错
  const oneExtra = [...CELLS_MAP, { id: 'S99-c1', route: '/x', action: 'observe', wait_budget_ms: 1000 }];
  const r2 = await checkCellsMapComplete(oneExtra);
  assert.ok(r2.errors.some(e => e.includes('S99-c1')), `多余格未被报: ${JSON.stringify(r2.errors)}`);
});

test('cells-map 每格必须有路由、动作、等待预算', () => {
  for (const c of CELLS_MAP) {
    assert.ok(c.route && c.route.startsWith('/'), `${c.id} 缺路由`);
    assert.ok(['observe', 'signup_flow', 'trigger_collect'].includes(c.action), `${c.id} 动作非法: ${c.action}`);
    assert.ok(Number.isInteger(c.wait_budget_ms) && c.wait_budget_ms > 0, `${c.id} 缺等待预算`);
  }
});

function goodColumn(ids) {
  return {
    schema_version: 1,
    environment: '预发后台',
    boundary: '验证环境=预发后台；未覆盖：真机/收信端',
    version_stamp: {
      captured_at: '2026-08-04T10:00:00Z',
      staging_url: 'https://staging-autopilot.zenjoymedia.media',
      backend_sha: 'unknown(健康端点未暴露构建号)',
      apk_expected: '2.1.19',
    },
    cells: ids.map(id => ({
      id,
      verdict: '无法验证',
      criteria: '判据原文占位',
      symptoms: [],
      reasons: ['样例'],
      evidence: [`evidence/${id}/page.png`],
    })),
  };
}

test('AI列结果：合法样例通过校验', async () => {
  const ids = await getMachineCellIds();
  const { errors } = await validateAiColumn(goodColumn(ids));
  assert.deepEqual(errors, []);
});

test('AI列结果：verdict 只允许三态，非法值报错', async () => {
  const ids = await getMachineCellIds();
  const col = goodColumn(ids);
  col.cells[0].verdict = '大概过了';
  const { errors } = await validateAiColumn(col);
  assert.ok(errors.length > 0, '非法三态值应报错');
});

test('AI列结果：缺 version_stamp 或 environment 报错', async () => {
  const ids = await getMachineCellIds();
  const c1 = goodColumn(ids);
  delete c1.version_stamp;
  assert.ok((await validateAiColumn(c1)).errors.length > 0);

  const c2 = goodColumn(ids);
  delete c2.environment;
  assert.ok((await validateAiColumn(c2)).errors.length > 0);
});

test('AI列结果：19 格必须齐——少一格报错点名格号', async () => {
  const ids = await getMachineCellIds();
  const col = goodColumn(ids);
  col.cells = col.cells.filter(c => c.id !== 'S11-c3');
  const { errors } = await validateAiColumn(col);
  assert.ok(errors.some(e => e.includes('S11-c3')), `缺格未点名: ${JSON.stringify(errors)}`);
});

test('AI列结果：每格 evidence 非空数组，空的报错', async () => {
  const ids = await getMachineCellIds();
  const col = goodColumn(ids);
  col.cells[3].evidence = [];
  const { errors } = await validateAiColumn(col);
  assert.ok(errors.length > 0, '空 evidence 应报错');
});
