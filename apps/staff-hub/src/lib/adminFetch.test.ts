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
});
