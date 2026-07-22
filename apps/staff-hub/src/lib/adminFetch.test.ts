import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminFetch } from './adminFetch';

describe('adminFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('会附带 X-User-Email 和 credentials include', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await adminFetch('/api/staff/path-health', 'staff@test.com', { method: 'GET' });

    expect(fetchMock).toHaveBeenCalledWith('/api/staff/path-health', expect.objectContaining({
      credentials: 'include',
      headers: expect.objectContaining({ 'X-User-Email': 'staff@test.com' }),
    }));
  });

  it('传入 user 对象时附带 X-Feishu-User-Id（部分飞书账号无邮箱，靠 open_id 兜底鉴权）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await adminFetch('/api/staff/path-health', { email: '', feishu_user_id: 'ou_abc123' }, { method: 'GET' });

    expect(fetchMock).toHaveBeenCalledWith('/api/staff/path-health', expect.objectContaining({
      credentials: 'include',
      headers: expect.objectContaining({ 'X-Feishu-User-Id': 'ou_abc123' }),
    }));
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers['X-User-Email']).toBeUndefined();
  });

  it('传入 user 对象且同时有 email 和 feishu_user_id 时两个头都附带', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await adminFetch('/api/staff/path-health', { email: 'staff@test.com', feishu_user_id: 'ou_abc123' });

    expect(fetchMock).toHaveBeenCalledWith('/api/staff/path-health', expect.objectContaining({
      headers: expect.objectContaining({ 'X-User-Email': 'staff@test.com', 'X-Feishu-User-Id': 'ou_abc123' }),
    }));
  });
});
