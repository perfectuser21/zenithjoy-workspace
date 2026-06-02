import { describe, it, expect } from 'vitest';

/**
 * Path 4 Step 1 — wechat-ilink 路由层 TDD Red
 *
 * 验证 wechat.ts 注册了三个新端点（旧端点不动）。
 * Generator 实现前必须 FAIL（端点未注册）。
 */

describe('wechat-ilink routes [BEHAVIOR]', () => {
  it('wechatRouter 注册了 ilink-login-start / ilink-login-status / ilink-poller-start 三个路径', async () => {
    const mod = await import('../../../apps/api/src/routes/wechat');
    const router: any = (mod as any).wechatRouter;
    expect(router).toBeDefined();

    // express Router 内部 stack[i].route.path
    const paths: string[] = (router.stack || [])
      .map((l: any) => l?.route?.path)
      .filter((p: any) => typeof p === 'string');

    expect(paths.some((p) => p.includes('ilink-login-start'))).toBe(true);
    expect(paths.some((p) => p.includes('ilink-login-status'))).toBe(true);
    expect(paths.some((p) => p.includes('ilink-poller-start'))).toBe(true);
  });

  it('旧路由（draft-review-poll / scheduler-tick / draft-generate / qr-bind）仍存在（不破坏前 sprint）', async () => {
    const mod = await import('../../../apps/api/src/routes/wechat');
    const router: any = (mod as any).wechatRouter;
    const paths: string[] = (router.stack || [])
      .map((l: any) => l?.route?.path)
      .filter((p: any) => typeof p === 'string');

    const keepers = ['qr-bind', 'draft-review-poll', 'scheduler-tick', 'draft-generate'];
    for (const k of keepers) {
      expect(paths.some((p) => p.includes(k))).toBe(true);
    }
  });
});
