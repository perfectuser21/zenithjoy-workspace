/**
 * 支付回调限流生效测试 —— CodeQL js/missing-rate-limiting 修复项。
 *
 * 独立成单独文件（而不是塞进 payment-callback.test.ts）：vitest 默认按文件隔离模块，
 * 这里需要真实打满 CALLBACK_RATE_LIMIT_MAX 次请求验证第 301 次真的被拦，若和其它
 * 用例共用同一个 paymentCallbackRouter 单例，会被此前测试已消耗的配额污染计数。
 *
 * 阈值来自源码导出的常量，不在本文件里写死 300 这个 magic number——阈值改了，
 * 这条测试的请求次数自动跟着变。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/services/payment/settlement.service', () => ({
  settleOrder: vi.fn(),
  recordCallback: vi.fn(),
  markRefundPending: vi.fn(),
  findOrderByOutTradeNo: vi.fn(),
  deleteCallbackRecord: vi.fn(),
}));

import {
  paymentCallbackRouter,
  CALLBACK_RATE_LIMIT_MAX,
} from '../../src/routes/payment-callback';
import { __setProviderForTest } from '../../src/services/payment/provider-registry';
import { MockProvider } from '../../src/services/payment/mock.provider';

function makeApp() {
  const app = express();
  app.use('/api/payment/callback', express.raw({ type: '*/*' }), paymentCallbackRouter);
  return app;
}

beforeEach(() => {
  __setProviderForTest('mock', new MockProvider());
});

describe('POST /api/payment/callback/:provider 限流（按 IP，CodeQL js/missing-rate-limiting）', () => {
  it(
    `超过 ${CALLBACK_RATE_LIMIT_MAX} 次/分钟/IP 后返回 429 RATE_LIMITED，挡在验签之前`,
    async () => {
      const app = makeApp();
      // 用错误签名：限流命中的关键在于"根本不该跑到验签逻辑"，用哪种 body 无所谓。
      let lastStatus = 0;
      let lastBody: unknown;
      for (let i = 0; i < CALLBACK_RATE_LIMIT_MAX + 1; i++) {
        const res = await request(app)
          .post('/api/payment/callback/mock')
          .set('Content-Type', 'application/json')
          .set('x-mock-signature', 'bad')
          .send('{}');
        lastStatus = res.status;
        lastBody = res.body;
      }

      expect(lastStatus).toBe(429);
      expect((lastBody as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
    },
    20_000
  );
});
