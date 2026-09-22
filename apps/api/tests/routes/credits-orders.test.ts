/**
 * credits-orders 路由测试 —— 低成本顺手项：未知 provider 的状态码
 *
 * getProvider（provider-registry.ts）在 provider 名未注册时抛
 * `UNKNOWN_PROVIDER: <name>`（普通 Error）。这个异常从 createRechargeOrder
 * 一路冒到 POST / 的兜底 catch，此前落进和"下单失败"同一个分支，返 502——
 * 语义应为 400：客户端传了个系统里压根没有的 provider 名，是客户端传错参数，
 * 不是网关/后端故障。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// tenantContext / simpleRateLimit 都依赖 DB/auth，这里换成直通中间件，只关心
// POST / 的错误分类逻辑（同仓库先例：acquisition-dispatch.test.ts）。
vi.mock('../../src/middleware/tenant-context', () => ({
  tenantContext: (req: any, _res: any, next: () => void) => {
    req.tenantId = 't-1';
    req.tenantRole = 'owner';
    next();
  },
}));
vi.mock('../../src/middleware/simple-rate-limit', () => ({
  simpleRateLimit: () => (_req: any, _res: any, next: () => void) => next(),
}));

const { createOrderMock } = vi.hoisted(() => ({ createOrderMock: vi.fn() }));
vi.mock('../../src/services/payment/orders.service', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, createRechargeOrder: createOrderMock };
});

vi.mock('../../src/db/connection', () => ({
  default: { query: vi.fn() },
}));

const { creditsOrdersRouter } = await import('../../src/routes/credits-orders');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/credits/orders', creditsOrdersRouter);
  return app;
}

beforeEach(() => {
  createOrderMock.mockReset();
});

describe('POST /api/credits/orders', () => {
  it('未知 provider → 400（客户端传错参数，不是网关故障），不是 502', async () => {
    createOrderMock.mockRejectedValue(new Error('UNKNOWN_PROVIDER: paypal'));

    const res = await request(makeApp())
      .post('/api/credits/orders')
      .send({ tier_id: 'tier_100', provider: 'paypal' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('其它下单失败（如 provider 网关报错）→ 仍是 502', async () => {
    createOrderMock.mockRejectedValue(new Error('ALIPAY_CREATE_ORDER_FAILED: boom'));

    const res = await request(makeApp())
      .post('/api/credits/orders')
      .send({ tier_id: 'tier_100', provider: 'alipay' });

    expect(res.status).toBe(502);
  });
});
