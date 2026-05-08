/**
 * Path 4 Sprint 1 ws4 — services/scheduler.ts 单元测试（RED）。
 *
 * 测试 startScheduler：
 *   1) 文件存在 + 含 cron 表达式字面量 '0 9 * * *'
 *   2) 含 thin server 时区注释
 *   3) startScheduler() 调用后会返回 stop handle，且 timer 已注册（可被 stopScheduler 清掉）
 *   4) tick 触发时（手动 invoke triggerSchedulerTick 或 setInterval flush）会 fetch
 *      POST localhost:5200/api/wechat/scheduler-tick
 *
 * 注：不测真实 setInterval 计时（单元测试中不可控），改测 triggerSchedulerTick 直接调用
 * 是否触发 fetch（合同中的 "cron 触发时调 POST scheduler-tick" 行为契约）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

const SCHEDULER_PATH = path.resolve(__dirname, '../../src/services/scheduler.ts');

describe('ws4 services/scheduler.ts — 静态契约', () => {
  it('文件存在', () => {
    expect(fs.existsSync(SCHEDULER_PATH)).toBe(true);
  });

  it('含 cron 表达式 \'0 9 * * *\'（grep 字面量）', () => {
    const src = fs.readFileSync(SCHEDULER_PATH, 'utf-8');
    expect(src).toMatch(/cron[\s\S]{0,200}?['"`]0 9 \* \* \*['"`]/);
  });

  it('含 thin server 时区注释', () => {
    const src = fs.readFileSync(SCHEDULER_PATH, 'utf-8');
    expect(src).toMatch(/thin.*server\s*时区/);
  });

  it('export startScheduler + stopScheduler + triggerSchedulerTick', () => {
    const src = fs.readFileSync(SCHEDULER_PATH, 'utf-8');
    expect(src).toMatch(
      /export\s+(async\s+)?function\s+startScheduler\b|export\s+\{[^}]*startScheduler[^}]*\}/,
    );
    expect(src).toMatch(
      /export\s+(async\s+)?function\s+stopScheduler\b|export\s+\{[^}]*stopScheduler[^}]*\}/,
    );
    expect(src).toMatch(
      /export\s+(async\s+)?function\s+triggerSchedulerTick\b|export\s+\{[^}]*triggerSchedulerTick[^}]*\}/,
    );
  });
});

describe('ws4 services/scheduler.ts — triggerSchedulerTick 触发 fetch /api/wechat/scheduler-tick', () => {
  const ORIGINAL_FETCH = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('triggerSchedulerTick() → 调用 fetch POST localhost:5200/api/wechat/scheduler-tick {force:false}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ generated: 0, skipped: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { triggerSchedulerTick } = await import('../../src/services/scheduler');
    await triggerSchedulerTick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/wechat\/scheduler-tick$/);
    expect(String(url)).toMatch(/localhost:5200|127\.0\.0\.1:5200|:5200/);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ force: false });
  });

  it('startScheduler 返回非空 handle，stopScheduler 能清掉 timer 不抛错', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ generated: 0, skipped: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { startScheduler, stopScheduler } = await import(
      '../../src/services/scheduler'
    );
    const handle = startScheduler();
    expect(handle).toBeTruthy();
    expect(() => stopScheduler(handle)).not.toThrow();
  });
});
