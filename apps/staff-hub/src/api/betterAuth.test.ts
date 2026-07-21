import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSession } from './betterAuth';

describe('betterAuth api', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getSession 在后端返回 null 时返回 null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => null,
    }));

    await expect(getSession()).resolves.toBeNull();
  });

  it('getSession 在后端返回 user 时透传', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: 'u1', email: 'staff@test.com', name: 'Staff' } }),
    }));

    await expect(getSession()).resolves.toEqual({
      user: { id: 'u1', email: 'staff@test.com', name: 'Staff' },
    });
  });
});
