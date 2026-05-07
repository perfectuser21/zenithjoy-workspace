/**
 * Walking Skeleton #1 — account.api unit tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAccountMe } from '../account.api';

describe('fetchAccountMe', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('200 → 解出 user + license', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { id: 'u1', email: 'a@b.com', name: 'A' },
          license: {
            license_key: 'ZJ-F-ABC123',
            tier: 'free',
            max_machines: 1,
            expires_at: '2036-01-01T00:00:00Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const me = await fetchAccountMe();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/account/me');
    expect(init?.credentials).toBe('include');
    expect(me.user.email).toBe('a@b.com');
    expect(me.license?.license_key).toBe('ZJ-F-ABC123');
    expect(me.license?.max_machines).toBe(1);
  });

  it('200 license:null → license 字段为 null（用户还没建 license）', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { id: 'u1', email: 'a@b.com', name: 'A' },
          license: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const me = await fetchAccountMe();
    expect(me.license).toBeNull();
  });

  it('401 → 抛错（消息含 HTTP_401）', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: '未登录' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(fetchAccountMe()).rejects.toThrow(/HTTP_401/);
  });
});
