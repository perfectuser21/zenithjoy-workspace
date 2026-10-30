import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAidgeAccess } from './aidge-access';

afterEach(() => vi.unstubAllGlobals());

describe('Aidge 试用角色读取', () => {
  it('从服务端会话读取 viewer 身份', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ role: 'viewer' }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await getAidgeAccess()).toBe('viewer');
    expect(fetchMock).toHaveBeenCalledWith('/api/aidge/access', { credentials: 'include', cache: 'no-store' });
  });

  it('普通客户没有 Aidge 角色；服务异常不能默认为普通客户', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 401 }).mockResolvedValueOnce({ ok: false, status: 503 }));
    expect(await getAidgeAccess()).toBeNull();
    await expect(getAidgeAccess()).rejects.toThrow('无法验证 Aidge 访问权限');
  });
});
