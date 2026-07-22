import { afterEach, describe, expect, it, vi } from 'vitest';
import { feishuLogin } from './feishuLogin';

describe('feishuLogin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('打 /api/staff/feishu-login（带白名单校验的路由），不是裸 /api/feishu-login（会被nginx代理到无白名单的通用飞书登录服务）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, user: { id: 'ou_1', name: '张三', email: 'staff@test.com', feishu_user_id: 'ou_1', access_token: 'tok' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await feishuLogin('real-code');

    expect(fetchMock).toHaveBeenCalledWith('/api/staff/feishu-login', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'real-code' }),
    }));
  });

  it('透传后端返回的 success/user/error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ success: false, error: '该飞书账号邮箱不在员工白名单内' }),
    }));

    const result = await feishuLogin('bad-code');
    expect(result).toEqual({ success: false, error: '该飞书账号邮箱不在员工白名单内' });
  });
});
