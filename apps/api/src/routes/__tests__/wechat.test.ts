/* eslint-disable @typescript-eslint/no-explicit-any */
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

  it('registers exactly 5 unique endpoints (4 原有 + 1 心跳；iLink 已删除)', () => {
    const stack = (wechatRouter as any).stack;
    const paths = [...new Set(stack.filter((l: any) => l.route).map((l: any) => l.route.path))];
    // 原有 4：qr-bind / draft-review-poll / scheduler-tick / draft-generate
    expect(paths).toContain('/draft-generate');
    // iLink 个人号通道已彻底删除（用户否决，决策 9d2234ba）—— 不应再注册任何 ilink-* 端点
    expect(paths).not.toContain('/ilink-login-start');
    expect(paths).not.toContain('/ilink-poller-start');
    // 进程守护：监听心跳上报端点
    expect(paths).toContain('/listener-heartbeat');
    expect(paths.length).toBe(5);
  });
});
