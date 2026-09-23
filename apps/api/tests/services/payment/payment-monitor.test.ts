import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/db/connection', () => ({
  default: { query: vi.fn() },
}));

// vi.mock 工厂会被提升到文件顶部（早于普通 const 初始化），工厂里引用的 mock 函数
// 必须经 vi.hoisted 声明，否则会报 "Cannot access 'xxx' before initialization"。
const { expireMock } = vi.hoisted(() => ({
  expireMock: vi.fn(),
}));

vi.mock('../../../src/services/payment/orders.service', () => ({
  expireStaleOrders: expireMock,
}));

import {
  startPaymentMonitor,
  stopPaymentMonitor,
  scanPendingBacklog,
  _resetBacklogAlertState,
} from '../../../src/services/payment/payment-monitor';

const pool = (await import('../../../src/db/connection') as any).default;

beforeEach(() => {
  vi.useFakeTimers();
  pool.query.mockReset();
  expireMock.mockReset().mockResolvedValue({ scanned: 0, credited: 0, expired: 0 });
  _resetBacklogAlertState();
});

afterEach(() => {
  stopPaymentMonitor();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('startPaymentMonitor', () => {
  it('按间隔调用 expireStaleOrders', async () => {
    startPaymentMonitor(1000);
    expect(expireMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(expireMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(expireMock).toHaveBeenCalledTimes(2);
  });

  it('重复调用不会起第二个 timer', async () => {
    startPaymentMonitor(1000);
    startPaymentMonitor(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(expireMock).toHaveBeenCalledTimes(1);
  });

  it('expireStaleOrders 抛错不会让定时器停摆', async () => {
    expireMock.mockRejectedValueOnce(new Error('boom'));
    startPaymentMonitor(1000);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(expireMock).toHaveBeenCalledTimes(2);
  });

  it('stopPaymentMonitor 之后不再触发', async () => {
    startPaymentMonitor(1000);
    await vi.advanceTimersByTimeAsync(1000);
    stopPaymentMonitor();
    await vi.advanceTimersByTimeAsync(5000);
    expect(expireMock).toHaveBeenCalledTimes(1);
  });

  // I-2：expireStaleOrders 串行处理最多 200 单、每单一次跨境 fetch，单个 tick 可能
  // 远超 interval（此前 provider fetch 无超时，undici 默认 300s）。没有重入闸时，
  // 下一次 interval 触发会叠加起新一轮 tick，重复扫同一批订单。
  it('I-2：上一轮 tick 尚未结束时，下一次 interval 触发应跳过本轮，不重入扫描', async () => {
    let resolveFirstTick!: (v: { scanned: number; credited: number; expired: number }) => void;
    expireMock.mockReset().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstTick = resolve;
        })
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      startPaymentMonitor(1000);

      // 第一轮触发，卡在 expireMock 返回的 pending promise 里（模拟慢查单）
      await vi.advanceTimersByTimeAsync(1000);
      expect(expireMock).toHaveBeenCalledTimes(1);

      // 第二个 interval 到点，此时第一轮仍未结束 —— 应被跳过，不应发起第二次 expireStaleOrders
      await vi.advanceTimersByTimeAsync(1000);
      expect(expireMock).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalled();

      // 放行第一轮
      expireMock.mockResolvedValue({ scanned: 0, credited: 0, expired: 0 });
      resolveFirstTick({ scanned: 0, credited: 0, expired: 0 });
      await vi.advanceTimersByTimeAsync(0);

      // 第一轮结束后，下一个 interval 应能正常再次触发
      await vi.advanceTimersByTimeAsync(1000);
      expect(expireMock).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('scanPendingBacklog', () => {
  it('积压笔数超阈值 → 告警', async () => {
    pool.query.mockResolvedValue({
      rows: [{ total: '60', oldest_age_ms: '1000' }],
    });
    const r = await scanPendingBacklog();
    expect(r.total).toBe(60);
    expect(r.alerted).toBe(true);
  });

  it('最老一笔超 2 小时 → 告警（即使笔数不多）', async () => {
    pool.query.mockResolvedValue({
      rows: [{ total: '2', oldest_age_ms: String(3 * 60 * 60 * 1000) }],
    });
    const r = await scanPendingBacklog();
    expect(r.alerted).toBe(true);
  });

  it('正常水位 → 不告警', async () => {
    pool.query.mockResolvedValue({
      rows: [{ total: '3', oldest_age_ms: '60000' }],
    });
    const r = await scanPendingBacklog();
    expect(r.alerted).toBe(false);
  });

  it('没有 pending 订单 → 不告警且 oldestAgeMs 为 null', async () => {
    pool.query.mockResolvedValue({ rows: [{ total: '0', oldest_age_ms: null }] });
    const r = await scanPendingBacklog();
    expect(r.total).toBe(0);
    expect(r.oldestAgeMs).toBeNull();
    expect(r.alerted).toBe(false);
  });
});

describe('scanPendingBacklog 飞书告警', () => {
  // 60 笔 pending，最老一笔积压 3 小时（180 分钟）——笔数与时长两个阈值都命中
  const backlogRow = { rows: [{ total: '60', oldest_age_ms: String(3 * 60 * 60 * 1000) }] };
  const normalRow = { rows: [{ total: '3', oldest_age_ms: '60000' }] };

  it('命中阈值 → 调用飞书 webhook，body 含 pending 笔数与积压时长', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', 'http://mock-webhook.test/hook');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    pool.query.mockResolvedValue(backlogRow);

    await scanPendingBacklog();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('http://mock-webhook.test/hook');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const text: string = body?.content?.text ?? '';
    expect(text).toContain('60'); // pending 笔数
    expect(text).toContain('180'); // 最老一笔积压分钟数（3小时）
  });

  it('去重生效：连续两次 tick 都命中阈值 → 只发一次飞书', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', 'http://mock-webhook.test/hook');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    pool.query.mockResolvedValue(backlogRow);

    await scanPendingBacklog();
    await scanPendingBacklog();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('恢复后可重新告警：命中→恢复正常→再次命中 → 第二次又发送', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', 'http://mock-webhook.test/hook');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    pool.query.mockResolvedValueOnce(backlogRow);
    await scanPendingBacklog();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    pool.query.mockResolvedValueOnce(normalRow);
    const recovered = await scanPendingBacklog();
    expect(recovered.alerted).toBe(false);

    pool.query.mockResolvedValueOnce(backlogRow);
    await scanPendingBacklog();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('未配置 FEISHU_ALERT_WEBHOOK → 不抛异常、降级为 console，且不调用 fetch', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', '');
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    pool.query.mockResolvedValue(backlogRow);

    await expect(scanPendingBacklog()).resolves.not.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetch 抛错（网络故障）→ 不影响巡检主流程，下一次 tick 仍正常触发', async () => {
    vi.stubEnv('FEISHU_ALERT_WEBHOOK', 'http://mock-webhook.test/hook');
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error('network fail'));
    vi.stubGlobal('fetch', mockFetch);
    pool.query.mockResolvedValue(backlogRow);

    await expect(scanPendingBacklog()).resolves.not.toThrow();

    mockFetch.mockResolvedValueOnce({ ok: true });
    const r = await scanPendingBacklog();
    expect(r.alerted).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
