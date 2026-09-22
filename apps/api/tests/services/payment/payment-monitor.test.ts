import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/db/connection', () => ({
  default: { query: vi.fn() },
}));

// vi.mock 工厂会被提升到文件顶部（早于普通 const 初始化），工厂里引用的 mock 函数
// 必须经 vi.hoisted 声明，否则会报 "Cannot access 'xxx' before initialization"。
const { expireMock, alertMock } = vi.hoisted(() => ({
  expireMock: vi.fn(),
  alertMock: vi.fn(),
}));

vi.mock('../../../src/services/payment/orders.service', () => ({
  expireStaleOrders: expireMock,
}));

vi.mock('../../../src/services/feishu-alert', () => ({
  sendFeishuAlert: alertMock,
}), { virtual: true });

import {
  startPaymentMonitor,
  stopPaymentMonitor,
  scanPendingBacklog,
} from '../../../src/services/payment/payment-monitor';

const pool = (await import('../../../src/db/connection') as any).default;

beforeEach(() => {
  vi.useFakeTimers();
  pool.query.mockReset();
  expireMock.mockReset().mockResolvedValue({ scanned: 0, credited: 0, expired: 0 });
  alertMock.mockReset();
});

afterEach(() => {
  stopPaymentMonitor();
  vi.useRealTimers();
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
