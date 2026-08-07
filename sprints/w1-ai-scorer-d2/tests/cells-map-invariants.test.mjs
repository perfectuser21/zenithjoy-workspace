/**
 * cells-map-invariants.test.mjs
 * INV-1 / INV-2 / INV-8: cells-map.mjs 静态约束检查
 *
 * INV-1: action 枚举恰为 {observe, trigger_collect}，禁止 signup_flow
 * INV-2: trigger_collect 格恰为 ['S6-c3','S10-c4']
 * INV-8: opportunistic 格数 == 0（yaml 中 scenario_class=opportunistic 零格）
 *
 * 这是 failing test（commit-1），实现完成后（commit-2）应全绿。
 */

import { CELLS_MAP } from '../../../scripts/acceptance-spec/ai-run/cells-map.mjs';

describe('INV-1: action 枚举约束', () => {
  const ALLOWED_ACTIONS = new Set(['observe', 'trigger_collect']);

  test('所有格的 action 只含 observe 或 trigger_collect', () => {
    const violations = CELLS_MAP.filter(c => !ALLOWED_ACTIONS.has(c.action));
    if (violations.length > 0) {
      console.error('违规格：', violations.map(c => `${c.id}:${c.action}`));
    }
    expect(violations).toHaveLength(0);
  });

  test('signup_flow 零出现', () => {
    const signupCells = CELLS_MAP.filter(c => c.action === 'signup_flow');
    expect(signupCells).toHaveLength(0);
  });
});

describe('INV-2: trigger_collect 格恰为 S6-c3 + S10-c4', () => {
  test('trigger_collect 格 ID 列表 == ["S6-c3","S10-c4"]', () => {
    const ids = CELLS_MAP
      .filter(c => c.action === 'trigger_collect')
      .map(c => c.id)
      .sort();
    expect(ids).toEqual(['S6-c3', 'S10-c4']);
  });

  test('S6-c3 route 为 /area/acquisition/tasks', () => {
    const s6c3 = CELLS_MAP.find(c => c.id === 'S6-c3');
    expect(s6c3).toBeDefined();
    expect(s6c3.route).toBe('/area/acquisition/tasks');
  });

  test('S10-c4 route 为 /area/acquisition/tasks（二次采集同页面）', () => {
    const s10c4 = CELLS_MAP.find(c => c.id === 'S10-c4');
    expect(s10c4).toBeDefined();
    expect(s10c4.route).toBe('/area/acquisition/tasks');
  });
});

describe('INV-8: opportunistic 零格', () => {
  test('CELLS_MAP 无 scenario_class=opportunistic 格', () => {
    // cells-map.mjs 本身无 scenario_class 字段（来自 yaml），这里检查无明显 opportunistic 标注
    const opportunistic = CELLS_MAP.filter(c =>
      c.scenario_class === 'opportunistic' || c.note?.includes('opportunistic')
    );
    expect(opportunistic).toHaveLength(0);
  });
});

describe('S1-c3 改动验证', () => {
  test('S1-c3 action 为 observe（不再是 signup_flow）', () => {
    const s1c3 = CELLS_MAP.find(c => c.id === 'S1-c3');
    expect(s1c3).toBeDefined();
    expect(s1c3.action).toBe('observe');
  });

  test('S1-c3 route 为 /area/acquisition/accounts（不再是 /signup）', () => {
    const s1c3 = CELLS_MAP.find(c => c.id === 'S1-c3');
    expect(s1c3.route).toBe('/area/acquisition/accounts');
  });
});

describe('S7-c2 / S9-c2 wait_budget_ms 验证', () => {
  test('S7-c2 wait_budget_ms = 300000 (5分钟)', () => {
    const s7c2 = CELLS_MAP.find(c => c.id === 'S7-c2');
    expect(s7c2).toBeDefined();
    expect(s7c2.wait_budget_ms).toBe(300000);
  });

  test('S9-c2 wait_budget_ms = 180000 (3分钟)', () => {
    const s9c2 = CELLS_MAP.find(c => c.id === 'S9-c2');
    expect(s9c2).toBeDefined();
    expect(s9c2.wait_budget_ms).toBe(180000);
  });
});
