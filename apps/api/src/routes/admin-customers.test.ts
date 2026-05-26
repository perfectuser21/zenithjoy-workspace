import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../db/connection', () => ({
  default: { query: mockQuery },
}));

vi.mock('../middleware/super-admin', () => ({
  superAdminGuard: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const feishuId = req.headers['x-feishu-user-id'];
    if (feishuId === 'not-an-admin') {
      res.status(403).json({ success: false, data: null, error: { code: 'FORBIDDEN', message: '需要 super-admin 权限' } });
      return;
    }
    next();
  },
}));

import { adminCustomersRouter } from './admin-customers';

const app = express();
app.use(express.json());
app.use('/api/admin/customers', adminCustomersRouter);
app.use((_req, res) => res.status(404).json({ error: 'not found' }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/admin/customers', () => {
  it('returns 200 with success:true, data:array, total:number', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 2 }] })
      .mockResolvedValueOnce({ rows: [
        { tenant_id: 'aaa', email: 'a@b.com', license_status: 'pro', platform_count: 1, last_publish_at: null },
        { tenant_id: 'bbb', email: 'b@b.com', license_status: 'none', platform_count: 0, last_publish_at: null },
      ] });
    const res = await request(app).get('/api/admin/customers');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('schema has exactly keys [data, success, total]', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/admin/customers');
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success', 'total']);
  });

  it('does not include forbidden keys (users/clients/members/result)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/admin/customers');
    expect(res.body).not.toHaveProperty('users');
    expect(res.body).not.toHaveProperty('clients');
    expect(res.body).not.toHaveProperty('members');
    expect(res.body).not.toHaveProperty('result');
  });

  it('data items include tenant_id, email, license_status, platform_count, last_publish_at', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [
        { tenant_id: 'aaa', email: 'a@b.com', license_status: 'pro', platform_count: 3, last_publish_at: '2026-01-01T00:00:00Z' },
      ] });
    const res = await request(app).get('/api/admin/customers');
    const item = res.body.data[0];
    expect(item).toHaveProperty('tenant_id');
    expect(item).toHaveProperty('email');
    expect(item).toHaveProperty('license_status');
    expect(item).toHaveProperty('platform_count');
    expect(item).toHaveProperty('last_publish_at');
  });

  it('non-super-admin (X-Feishu-User-Id: not-an-admin) returns 403', async () => {
    const res = await request(app)
      .get('/api/admin/customers')
      .set('X-Feishu-User-Id', 'not-an-admin');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/customers/platform-sessions', () => {
  it('returns 200 with success:true, data:array, total:number', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [
        { session_id: 's1', tenant_id: 'aaa', platform: 'douyin', status: 'active', expires_at: null },
      ] });
    const res = await request(app).get('/api/admin/customers/platform-sessions');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('schema has exactly keys [data, success, total]', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/admin/customers/platform-sessions');
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success', 'total']);
  });

  it('status values are only active or expired', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 2 }] })
      .mockResolvedValueOnce({ rows: [
        { session_id: 's1', tenant_id: 'aaa', platform: 'douyin', status: 'active', expires_at: null },
        { session_id: 's2', tenant_id: 'bbb', platform: 'kuaishou', status: 'expired', expires_at: '2026-01-01T00:00:00Z' },
      ] });
    const res = await request(app).get('/api/admin/customers/platform-sessions');
    for (const item of res.body.data) {
      expect(['active', 'expired']).toContain(item.status);
    }
  });

  it('data items include session_id and expires_at', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [
        { session_id: 's1', tenant_id: 'aaa', platform: 'douyin', status: 'active', expires_at: null },
      ] });
    const res = await request(app).get('/api/admin/customers/platform-sessions');
    expect(res.body.data[0]).toHaveProperty('session_id');
    expect(res.body.data[0]).toHaveProperty('expires_at');
  });
});

describe('GET /api/admin/customers/publish-logs', () => {
  it('returns 200 with success:true, data:array, total:number', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [
        { log_id: 'l1', tenant_id: 'aaa', work_id: 'w1', platform: 'douyin', status: 'success', created_at: '2026-01-01T00:00:00Z' },
      ] });
    const res = await request(app).get('/api/admin/customers/publish-logs');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('schema has exactly keys [data, success, total]', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/admin/customers/publish-logs');
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success', 'total']);
  });

  it('accepts tenant_id query filter and returns 200', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/admin/customers/publish-logs?tenant_id=00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('data items include log_id, work_id, created_at', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [
        { log_id: 'l1', tenant_id: 'aaa', work_id: 'w1', platform: 'douyin', status: 'success', created_at: '2026-01-01T00:00:00Z' },
      ] });
    const res = await request(app).get('/api/admin/customers/publish-logs');
    expect(res.body.data[0]).toHaveProperty('log_id');
    expect(res.body.data[0]).toHaveProperty('work_id');
    expect(res.body.data[0]).toHaveProperty('created_at');
  });
});
