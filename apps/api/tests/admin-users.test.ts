import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn(), connect: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const INTERNAL_TOKEN = 'test-super-token';
const ADMIN_USER = 'ou_admin_001';

const USER_ROW = {
  id: 'user-uuid-1',
  email: 'alice@example.com',
  name: 'Alice',
  created_at: '2026-01-01T00:00:00Z',
  tenants: [],
};

describe('Admin Users API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN', INTERNAL_TOKEN);
    vi.stubEnv('ADMIN_FEISHU_OPENIDS', ADMIN_USER);
  });

  const authHeader = () => ({ 'X-Internal-Token': INTERNAL_TOKEN });

  describe('GET /api/admin/users', () => {
    it('returns user list with internal token', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [USER_ROW], rowCount: 1 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });
      const res = await request(app)
        .get('/api/admin/users')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.users)).toBe(true);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/admin/users');
      expect(res.status).toBe(401);
    });

    it('respects limit/offset query params', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      const res = await request(app)
        .get('/api/admin/users?limit=10&offset=20')
        .set(authHeader());
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/admin/users/:userId/tenant-members', () => {
    it('adds user to tenant successfully', async () => {
      // POST does 2 queries: INSERT (ON CONFLICT) + SELECT tenants for user
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT
      mockQuery.mockResolvedValueOnce({                           // SELECT tenants
        rows: [{ tenant_id: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'Tenant A', plan: 'matrix', role: 'member' }],
      });
      const res = await request(app)
        .post('/api/admin/users/user-uuid-1/tenant-members')
        .set(authHeader())
        .send({ tenant_id: 'aaaaaaaa-1111-2222-3333-444444444444', role: 'member' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for invalid tenant_id format', async () => {
      const res = await request(app)
        .post('/api/admin/users/user-uuid-1/tenant-members')
        .set(authHeader())
        .send({ tenant_id: 'not-a-uuid', role: 'member' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid role', async () => {
      const res = await request(app)
        .post('/api/admin/users/user-uuid-1/tenant-members')
        .set(authHeader())
        .send({ tenant_id: 'aaaaaaaa-1111-2222-3333-444444444444', role: 'superstar' });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/admin/users/:userId/tenant-members/:tenantId', () => {
    it('removes user from tenant', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      const res = await request(app)
        .delete('/api/admin/users/user-uuid-1/tenant-members/aaaaaaaa-1111-2222-3333-444444444444')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 200 even when membership not found (idempotent DELETE)', async () => {
      // route does not check rowCount for tenant-member removal — always returns 200
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      const res = await request(app)
        .delete('/api/admin/users/user-uuid-1/tenant-members/aaaaaaaa-1111-2222-3333-444444444444')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('DELETE /api/admin/users/:userId', () => {
    it('deletes user and returns success', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      const res = await request(app)
        .delete('/api/admin/users/user-uuid-1')
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when user not found', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      const res = await request(app)
        .delete('/api/admin/users/nonexistent-user')
        .set(authHeader());
      expect(res.status).toBe(404);
    });
  });
});
