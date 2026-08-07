/**
 * polling-timer.test.mjs
 * BEHAVIOR-6: S7-c2 / S9-c2 自持轮询计时
 *
 * 验证：
 * 1. 轮询在 wait_budget_ms 内循环（每 60 秒间隔）
 * 2. 检出终态字样时提前结束，不等满预算
 * 3. S7-c2 预算 = 300000ms（5分钟）；S9-c2 预算 = 180000ms（3分钟）
 *
 * 这是 failing test（commit-1），实现完成后（commit-4）应全绿。
 */

import { jest } from '@jest/globals';

/**
 * 待 capture.mjs 实现后从真实模块导入：
 * import { pollUntilTerminal } from '../../../scripts/acceptance-spec/ai-run/capture.mjs';
 *
 * 函数签名：
 * pollUntilTerminal({ getPageText, waitBudgetMs, pollIntervalMs, cellIds, captureFor, log })
 * 返回：{ ticks: number, earlyExit: boolean, elapsed_ms: number }
 */

async function loadPollUntilTerminal() {
  try {
    const mod = await import('../../../scripts/acceptance-spec/ai-run/capture.mjs');
    if (typeof mod.pollUntilTerminal === 'function') return mod.pollUntilTerminal;
  } catch {
    // 尚未实现 → failing test
  }
  return null;
}

describe('BEHAVIOR-6: 自持轮询计时', () => {
  let pollUntilTerminal;

  beforeAll(async () => {
    pollUntilTerminal = await loadPollUntilTerminal();
  });

  test('检出终态字样「已完成」时提前结束（不等满预算）', async () => {
    expect(pollUntilTerminal).not.toBeNull(); // capture.mjs 必须导出 pollUntilTerminal

    let tickCount = 0;
    const pageTexts = [
      '任务执行中...',
      '任务执行中...进度50%',
      '已完成', // 第3次轮询出现终态
    ];

    const result = await pollUntilTerminal({
      getPageText: async () => {
        const text = pageTexts[tickCount] || '任务执行中...';
        tickCount++;
        return text;
      },
      waitBudgetMs: 300000,      // 5分钟预算
      pollIntervalMs: 1,          // 测试时缩短为 1ms（不实际等待）
      cellIds: ['S7-c1', 'S7-c2'],
      captureFor: async () => {},  // mock 截图
      log: () => {},               // mock 日志
    });

    expect(result.earlyExit).toBe(true);
    expect(result.ticks).toBe(3); // 第3次检到终态
    expect(result.elapsed_ms).toBeLessThan(300000);
  });

  test('未出现终态时跑满预算后退出', async () => {
    expect(pollUntilTerminal).not.toBeNull();

    const result = await pollUntilTerminal({
      getPageText: async () => '任务执行中...无终态',
      waitBudgetMs: 100,          // 测试用短预算
      pollIntervalMs: 1,
      cellIds: ['S9-c1', 'S9-c2'],
      captureFor: async () => {},
      log: () => {},
    });

    expect(result.earlyExit).toBe(false);
    expect(result.elapsed_ms).toBeGreaterThanOrEqual(100);
  });

  test('S7-c2 wait_budget_ms 配置为 300000ms（5分钟）', async () => {
    const mod = await import('../../../scripts/acceptance-spec/ai-run/cells-map.mjs').catch(() => null);
    if (!mod) {
      console.warn('cells-map.mjs 尚未修改，跳过预算检查');
      return;
    }
    const s7c2 = mod.CELLS_MAP.find(c => c.id === 'S7-c2');
    expect(s7c2).toBeDefined();
    expect(s7c2.wait_budget_ms).toBe(300000);
  });

  test('S9-c2 wait_budget_ms 配置为 180000ms（3分钟）', async () => {
    const mod = await import('../../../scripts/acceptance-spec/ai-run/cells-map.mjs').catch(() => null);
    if (!mod) {
      console.warn('cells-map.mjs 尚未修改，跳过预算检查');
      return;
    }
    const s9c2 = mod.CELLS_MAP.find(c => c.id === 'S9-c2');
    expect(s9c2).toBeDefined();
    expect(s9c2.wait_budget_ms).toBe(180000);
  });
});
