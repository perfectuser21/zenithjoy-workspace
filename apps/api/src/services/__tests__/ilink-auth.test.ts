import { describe, it, expect } from 'vitest';

/**
 * Path 4 Step 1 — ilink-auth TDD Red
 *
 * 验证 ilink-auth.ts 扫码登录流程的可注入行为接口。
 * Generator 实现前必须 FAIL（模块/函数不存在）。
 */

describe('ilink-auth [ARTIFACT + BEHAVIOR]', () => {
  it('startLogin 返回 session_id (string) + qr_url (string)', async () => {
    const mod = await import('../ilink-auth');
    expect(typeof (mod as any).startLogin).toBe('function');

    const mockFetch = async (url: string) => {
      if (url.includes('/auth/qrcode')) {
        return { qr_url: 'https://ilinkai.weixin.qq.com/qr/mock-token', ticket: 'tick-1' };
      }
      throw new Error(`unexpected url: ${url}`);
    };

    const result = await (mod as any).startLogin({
      agentId: 'e2e-burner-1',
      fetch: mockFetch,
    });

    expect(typeof result.session_id).toBe('string');
    expect(result.session_id.length).toBeGreaterThan(0);
    expect(typeof result.qr_url).toBe('string');
    expect(result.qr_url).toContain('qr');
  });

  it('pollLoginStatus 返回 { status: "pending" } 当 iLink 尚未扫码', async () => {
    const mod = await import('../ilink-auth');
    expect(typeof (mod as any).pollLoginStatus).toBe('function');

    const result = await (mod as any).pollLoginStatus({
      sessionId: 'sess-pending-1',
      fetch: async () => ({ status: 'pending' }),
    });

    expect(result.status).toBe('pending');
  });

  it('pollLoginStatus 返回 { status: "bound", token, uin, wxid, nickname } 当扫码授权成功', async () => {
    const mod = await import('../ilink-auth');

    const result = await (mod as any).pollLoginStatus({
      sessionId: 'sess-ok-1',
      fetch: async () => ({
        status: 'confirmed',
        access_token: 'bearer-tok-xyz',
        uin: '12345678',
        wxid: 'wxid_abc',
        nickname: '测试号',
      }),
    });

    expect(result.status).toBe('bound');
    expect(typeof result.token).toBe('string');
    expect(result.token).toBe('bearer-tok-xyz');
    expect(result.uin).toBe('12345678');
    expect(result.wxid).toBe('wxid_abc');
    expect(result.nickname).toBe('测试号');
  });

  it('pollLoginStatus 返回 { status: "expired" } 当二维码超时', async () => {
    const mod = await import('../ilink-auth');

    const result = await (mod as any).pollLoginStatus({
      sessionId: 'sess-exp-1',
      fetch: async () => ({ status: 'expired' }),
    });

    expect(result.status).toBe('expired');
  });
});
