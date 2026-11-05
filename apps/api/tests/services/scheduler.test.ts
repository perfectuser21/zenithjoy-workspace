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

vi.mock('../../src/db/connection', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../../src/services/acquisition-dispatch', () => ({
  dispatchDue: vi.fn().mockResolvedValue({ dispatched: 0, skipped_window: 0, skipped_limit: 0 }),
}));
vi.mock('../../src/routes/acquisition', () => ({
  sweepCollectTimeouts: vi.fn().mockResolvedValue({ swept: 0 }),
}));

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

describe('retired acquisition scheduler', () => {
  it('does not enqueue retired Kotlin warmup at the former daily time', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-05T01:59:00Z'));
      const warmup = await import('../../src/services/warmup-dispatch');
      const spy = vi.spyOn(warmup, 'enqueueWarmupTasks').mockResolvedValue({ enqueued: 0 } as any);
      const { startScheduler, stopScheduler } = await import('../../src/services/scheduler');
      const handle = startScheduler();
      await vi.advanceTimersByTimeAsync(60_000);
      stopScheduler(handle);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    } finally { vi.useRealTimers(); }
  });
  it('minute tick does not dispatch queued legacy leads while timeout settlement remains active', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-05T04:21:00Z'));
      const pool = (await import('../../src/db/connection')).default;
      const dispatch = await import('../../src/services/acquisition-dispatch');
      const acquisition = await import('../../src/routes/acquisition');
      vi.clearAllMocks();
      vi.mocked(pool.query).mockResolvedValue({ rows: [{ tenant_id: 'tenant-queued' }] } as any);
      const { startScheduler, stopScheduler } = await import('../../src/services/scheduler');
      const handle = startScheduler();
      await vi.advanceTimersByTimeAsync(60_000);
      stopScheduler(handle);
      expect(dispatch.dispatchDue).not.toHaveBeenCalled();
      expect(pool.query).not.toHaveBeenCalled();
      expect(acquisition.sweepCollectTimeouts).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

describe('ws4 services/scheduler.ts — triggerCollectTimeoutSweep（issue 2026-07-28：sweep-timeouts 看门狗接线）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('export triggerCollectTimeoutSweep', () => {
    const src = fs.readFileSync(SCHEDULER_PATH, 'utf-8');
    expect(src).toMatch(
      /export\s+(async\s+)?function\s+triggerCollectTimeoutSweep\b|export\s+\{[^}]*triggerCollectTimeoutSweep[^}]*\}/,
    );
  });

  it('调用一次 sweepCollectTimeouts', async () => {
    const acquisitionModule = await import('../../src/routes/acquisition');
    const sweepMock = acquisitionModule.sweepCollectTimeouts as unknown as ReturnType<typeof vi.fn>;
    sweepMock.mockResolvedValue({ swept: 3 });

    const { triggerCollectTimeoutSweep } = await import('../../src/services/scheduler');
    await triggerCollectTimeoutSweep();

    expect(sweepMock).toHaveBeenCalledTimes(1);
  });

  it('sweepCollectTimeouts 抛异常时，只 warn 不向上抛出', async () => {
    const acquisitionModule = await import('../../src/routes/acquisition');
    const sweepMock = acquisitionModule.sweepCollectTimeouts as unknown as ReturnType<typeof vi.fn>;
    sweepMock.mockRejectedValue(new Error('boom'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { triggerCollectTimeoutSweep } = await import('../../src/services/scheduler');
    await expect(triggerCollectTimeoutSweep()).resolves.not.toThrow();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('并发场景：上一轮尚未完成时，本次 tick 应立即跳过（不重复调用，且 warn 一次）', async () => {
    const acquisitionModule = await import('../../src/routes/acquisition');
    const sweepMock = acquisitionModule.sweepCollectTimeouts as unknown as ReturnType<typeof vi.fn>;

    let resolveSweep!: (value: { swept: number }) => void;
    const deferred = new Promise<{ swept: number }>((resolve) => {
      resolveSweep = resolve;
    });
    sweepMock.mockReturnValue(deferred);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { triggerCollectTimeoutSweep } = await import('../../src/services/scheduler');

    const firstCall = triggerCollectTimeoutSweep();
    const secondCall = triggerCollectTimeoutSweep();
    await secondCall;

    expect(sweepMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('上一轮尚未完成'));

    resolveSweep({ swept: 0 });
    await firstCall;

    warnSpy.mockRestore();
  });

  it('startScheduler 的 setInterval 回调里，每次 tick 都会调用 sweepCollectTimeouts（不按时刻门控）', async () => {
    vi.useFakeTimers();
    try {
      const poolModule = await import('../../src/db/connection');
      const mockPool = poolModule.default as unknown as { query: ReturnType<typeof vi.fn> };
      mockPool.query.mockResolvedValue({ rows: [] });

      const acquisitionModule = await import('../../src/routes/acquisition');
      const sweepMock = acquisitionModule.sweepCollectTimeouts as unknown as ReturnType<typeof vi.fn>;
      sweepMock.mockResolvedValue({ swept: 0 });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ generated: 0, skipped: [] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const { startScheduler, stopScheduler } = await import('../../src/services/scheduler');
      const handle = startScheduler();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(sweepMock).toHaveBeenCalled();

      stopScheduler(handle);
    } finally {
      vi.useRealTimers();
    }
  });
});
