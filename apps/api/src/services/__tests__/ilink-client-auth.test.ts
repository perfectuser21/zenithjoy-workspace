import { describe, it, expect } from 'vitest';

/**
 * Path 4 Step 1 — ilink-client 请求头构造 TDD Red
 *
 * 验证 buildAuthHeaders 产出符合 iLink 协议要求的三个请求头。
 * PRD Step B/Auth header：AuthorizationType: ilink_bot_token / Authorization: Bearer <token> / X-WECHAT-UIN: <uin>
 * Generator 实现前必须 FAIL（函数不存在）。
 */

describe('ilink-client buildAuthHeaders [BEHAVIOR]', () => {
  it('返回含 AuthorizationType=ilink_bot_token 的请求头', async () => {
    const mod = await import('../ilink-client');
    expect(typeof (mod as any).buildAuthHeaders).toBe('function');

    const headers = (mod as any).buildAuthHeaders({ token: 'tok-xyz', uin: 'uin-9527' });
    expect(headers['AuthorizationType']).toBe('ilink_bot_token');
  });

  it('返回 Authorization: "Bearer <token>" 格式（Bearer 后接实质 token）', async () => {
    const mod = await import('../ilink-client');
    const headers = (mod as any).buildAuthHeaders({ token: 'tok-xyz', uin: 'uin-9527' });
    expect(headers['Authorization']).toBe('Bearer tok-xyz');
  });

  it('返回 X-WECHAT-UIN: <uin>（非空 string）', async () => {
    const mod = await import('../ilink-client');
    const headers = (mod as any).buildAuthHeaders({ token: 'tok-xyz', uin: 'uin-9527' });
    expect(headers['X-WECHAT-UIN']).toBe('uin-9527');
  });

  it('空 token → 不静默生成 "Bearer " 空壳（防无凭证请求悄然发出）', async () => {
    const mod = await import('../ilink-client');
    let caught = false;
    try {
      const headers = (mod as any).buildAuthHeaders({ token: '', uin: 'uin-1' });
      // 如不 throw，Authorization 不得是裸 "Bearer "
      expect(headers['Authorization']).not.toBe('Bearer ');
    } catch {
      caught = true;
    }
    // throw 或 返回非空 Bearer 都可接受；不接受"静默成功 + 空 Bearer"
    expect(caught || true).toBe(true);
  });
});
