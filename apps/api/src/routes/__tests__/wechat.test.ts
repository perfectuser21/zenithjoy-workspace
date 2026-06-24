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

  it('registers exactly 9 unique endpoints (5 原有 + 3 关键人出站 + 1 客服工作汇总；iLink 已删除)', () => {
    const stack = (wechatRouter as any).stack;
    const paths = [...new Set(stack.filter((l: any) => l.route).map((l: any) => l.route.path))];
    // 原有 5：qr-bind / draft-review-poll / scheduler-tick / draft-generate / listener-heartbeat
    expect(paths).toContain('/draft-generate');
    expect(paths).toContain('/listener-heartbeat');
    // iLink 个人号通道已彻底删除（用户否决，决策 9d2234ba）—— 不应再注册任何 ilink-* 端点
    expect(paths).not.toContain('/ilink-login-start');
    expect(paths).not.toContain('/ilink-poller-start');
    // C1 尾巴：关键人出站任务 3 端点（agent 拉取待发 / 回执 / 失败告警入队）
    expect(paths).toContain('/cs/outbound');
    expect(paths).toContain('/cs/outbound/:id/receipt');
    expect(paths).toContain('/cs/alert');
    // S3：客服工作汇总统计
    expect(paths).toContain('/cs/stats');
    expect(paths.length).toBe(9);
  });
});
