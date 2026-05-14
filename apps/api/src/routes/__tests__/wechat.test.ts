/**
 * P4 WS1 — wechat.ts pairing unit test
 *
 * 配套 lint-test-pairing 要求. 真业务测试 (3 endpoint 行为) 在
 * apps/api/tests/integration/p4-sprint-1-ws1/wechat-routes.integration.test.ts
 * (整合测试用 supertest 真起 express app + 真 DB).
 */
import { describe, it, expect } from 'vitest';
import { wechatRouter } from '../wechat';

describe('wechat.ts — router export', () => {
  it('exports wechatRouter as Express Router', () => {
    expect(wechatRouter).toBeDefined();
    expect(typeof wechatRouter).toBe('function');
    // express Router 函数本身 + .stack 内含已注册路由
    expect(Array.isArray((wechatRouter as any).stack)).toBe(true);
  });

  it('registers 3 endpoints (qr-bind / draft-review-poll / scheduler-tick)', () => {
    const stack = (wechatRouter as any).stack;
    const paths = stack.filter((l: any) => l.route).map((l: any) => l.route.path);
    expect(paths).toContain('/qr-bind');
    expect(paths).toContain('/draft-review-poll');
    expect(paths).toContain('/scheduler-tick');
  });

  it('registers 4 endpoints (含 draft-submit)', () => {
    const stack = (wechatRouter as any).stack;
    const paths = stack.filter((l: any) => l.route).map((l: any) => l.route.path);
    expect(paths).toContain('/draft-submit');
  });
});
