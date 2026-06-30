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

  it('registers core endpoints (qr-bind / scheduler-tick；去飞书后 draft-review-poll 已删)', () => {
    const stack = (wechatRouter as any).stack;
    const paths = stack.filter((l: any) => l.route).map((l: any) => l.route.path);
    expect(paths).toContain('/qr-bind');
    expect(paths).toContain('/scheduler-tick');
    // 去飞书（2026-06-30）：飞书审批轮询端点已删，不应再注册
    expect(paths).not.toContain('/draft-review-poll');
  });

  it('registers exactly 10 unique endpoints (去飞书删 draft-review-poll：4 原有 + 3 关键人出站 + S3 汇总 + S4 日报×2)', () => {
    const stack = (wechatRouter as any).stack;
    const paths = [...new Set(stack.filter((l: any) => l.route).map((l: any) => l.route.path))];
    // 原有 4：qr-bind / scheduler-tick / draft-generate / listener-heartbeat（draft-review-poll 已删）
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
    // S4：客服日报（结算 + 回看）
    expect(paths).toContain('/cs/daily-report/settle');
    expect(paths).toContain('/cs/daily-report');
    expect(paths.length).toBe(10);
  });
});
