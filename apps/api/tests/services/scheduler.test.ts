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

describe('ws4 services/scheduler.ts — triggerDmDispatchSweep（Path2 Seg4 DM派单周期扫描）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('export triggerDmDispatchSweep', () => {
    const src = fs.readFileSync(SCHEDULER_PATH, 'utf-8');
    expect(src).toMatch(
      /export\s+(async\s+)?function\s+triggerDmDispatchSweep\b|export\s+\{[^}]*triggerDmDispatchSweep[^}]*\}/,
    );
  });

  it('有到期 queued 租户时，对每个租户调用一次 dispatchDue', async () => {
    const poolModule = await import('../../src/db/connection');
    const mockPool = poolModule.default as unknown as { query: ReturnType<typeof vi.fn> };
    mockPool.query.mockResolvedValue({
      rows: [{ tenant_id: 'tenant-a' }, { tenant_id: 'tenant-b' }],
    });

    const dispatchModule = await import('../../src/services/acquisition-dispatch');
    const dispatchDueMock = dispatchModule.dispatchDue as unknown as ReturnType<typeof vi.fn>;

    const { triggerDmDispatchSweep } = await import('../../src/services/scheduler');
    await triggerDmDispatchSweep();

    expect(dispatchDueMock).toHaveBeenCalledTimes(2);
    expect(dispatchDueMock).toHaveBeenCalledWith(expect.anything(), 'tenant-a');
    expect(dispatchDueMock).toHaveBeenCalledWith(expect.anything(), 'tenant-b');
  });

  it('无到期租户时，不调用 dispatchDue', async () => {
    const poolModule = await import('../../src/db/connection');
    const mockPool = poolModule.default as unknown as { query: ReturnType<typeof vi.fn> };
    mockPool.query.mockResolvedValue({ rows: [] });

    const dispatchModule = await import('../../src/services/acquisition-dispatch');
    const dispatchDueMock = dispatchModule.dispatchDue as unknown as ReturnType<typeof vi.fn>;

    const { triggerDmDispatchSweep } = await import('../../src/services/scheduler');
    await triggerDmDispatchSweep();

    expect(dispatchDueMock).not.toHaveBeenCalled();
  });

  it('单个租户 dispatchDue 抛异常时，只 warn 不影响其它租户/不向上抛出', async () => {
    const poolModule = await import('../../src/db/connection');
    const mockPool = poolModule.default as unknown as { query: ReturnType<typeof vi.fn> };
    mockPool.query.mockResolvedValue({
      rows: [{ tenant_id: 'tenant-fail' }, { tenant_id: 'tenant-ok' }],
    });

    const dispatchModule = await import('../../src/services/acquisition-dispatch');
    const dispatchDueMock = dispatchModule.dispatchDue as unknown as ReturnType<typeof vi.fn>;
    dispatchDueMock.mockImplementation((_pool: unknown, tenantId: string) => {
      if (tenantId === 'tenant-fail') return Promise.reject(new Error('boom'));
      return Promise.resolve({ dispatched: 0, skipped_window: 0, skipped_limit: 0 });
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { triggerDmDispatchSweep } = await import('../../src/services/scheduler');
    await expect(triggerDmDispatchSweep()).resolves.not.toThrow();

    expect(dispatchDueMock).toHaveBeenCalledWith(expect.anything(), 'tenant-ok');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('startScheduler 的 setInterval 回调里，每次 tick 都会调用 triggerDmDispatchSweep（不按时刻门控）', async () => {
    // 注：brief 原文用同步 `it(..., () => {...})` + `require(...)`，在本文件的 vitest ESM 配置下
    // `require` 不可用；改用 `async` test body + `await import(...)`——模块在本文件前面的用例中
    // 已被多次动态 import 过，vitest 会命中模块缓存，dynamic import() 的 promise 解析走的是
    // 真实 microtask 队列（不受 vi.useFakeTimers() 影响，后者只 fake 计时器/Date），
    // 因此在 fake timers 上下文里 await import() 依然可靠，不存在时序竞争。
    vi.useFakeTimers();
    try {
      const poolModule = await import('../../src/db/connection');
      const mockPool = poolModule.default as unknown as { query: ReturnType<typeof vi.fn> };
      mockPool.query.mockResolvedValue({ rows: [] });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ generated: 0, skipped: [] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const { startScheduler, stopScheduler } = await import('../../src/services/scheduler');
      const handle = startScheduler();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockPool.query).toHaveBeenCalled();

      stopScheduler(handle);
    } finally {
      vi.useRealTimers();
    }
  });
});
