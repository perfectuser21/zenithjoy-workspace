import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLine02AccountStatus } from './line02.api';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('getLine02AccountStatus', () => {
  it('returns accounts on success', async () => {
    const mockData = { accounts: [{ label: 'live101', role: 'main', health: 'ok' }] };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: mockData }),
    });
    const result = await getLine02AccountStatus();
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].label).toBe('live101');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(getLine02AccountStatus()).rejects.toThrow();
  });
});
