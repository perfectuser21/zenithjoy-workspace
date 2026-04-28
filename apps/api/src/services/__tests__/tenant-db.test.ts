import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../../db/connection';
import { findTenantByLicense } from '../tenant-db';

const mockQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('findTenantByLicense', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when no tenant found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    const result = await findTenantByLicense('ZJ-NOTEXIST');
    expect(result).toBeNull();
  });

  it('returns mapped tenant when found', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'uuid-1', name: 'TestCo', license_key: 'ZJ-TEST1234', plan: 'free' }],
    } as any);
    const result = await findTenantByLicense('ZJ-TEST1234');
    expect(result).toEqual({ id: 'uuid-1', name: 'TestCo', licenseKey: 'ZJ-TEST1234', plan: 'free' });
  });

  it('queries by license_key param', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    await findTenantByLicense('ZJ-ABC');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE license_key = $1'),
      ['ZJ-ABC']
    );
  });
});
