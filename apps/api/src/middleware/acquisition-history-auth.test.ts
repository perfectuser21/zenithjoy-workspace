import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { acquisitionHistoryAuth } from './acquisition-history-auth';
import { simpleRateLimit, ipKeyFn } from './simple-rate-limit';
import pool from '../db/connection';
import { auth } from '../auth';

vi.mock('../db/connection', () => ({ default: { query: vi.fn() } }));
vi.mock('../auth', () => ({ auth: { api: { getSession: vi.fn() } } }));

const app = express();
app.get('/history', simpleRateLimit({ windowMs: 60_000, max: 120, keyFn: ipKeyFn }), acquisitionHistoryAuth, (req, res) => {
  res.json({ tenant: req.tenantId });
});

describe('acquisition history session guard', () => {
  beforeEach(() => vi.resetAllMocks());

  it('rejects an unauthenticated caller even with forged tenant and user headers', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const response = await request(app).get('/history').set('X-Tenant-Id', 'forged').set('X-Feishu-User-Id', 'forged');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('SESSION_REQUIRED');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('uses the session membership, ignoring a conflicting tenant header', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: 'member-a' } } as never);
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ tenant_id: 'tenant-a' }] } as never);
    const response = await request(app).get('/history').set('Cookie', 'session=fixture').set('X-Tenant-Id', 'tenant-b');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ tenant: 'tenant-a' });
    expect(vi.mocked(pool.query).mock.calls[0][1]).toEqual(['member-a']);
  });

  it.each([
    { rows: [], status: 403, code: 'NO_TENANT' },
    { rows: [{ tenant_id: 'a' }, { tenant_id: 'b' }], status: 409, code: 'MULTI_ORG_MEMBER' },
  ])('rejects ambiguous or absent memberships: $code', async ({ rows, status, code }) => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: 'member-a' } } as never);
    vi.mocked(pool.query).mockResolvedValue({ rows } as never);
    const response = await request(app).get('/history');
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect(response.body.tenant).toBeUndefined();
  });

  it('fails closed when membership lookup fails', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: 'member-a' } } as never);
    vi.mocked(pool.query).mockRejectedValue(new Error('fixture database unavailable'));
    const response = await request(app).get('/history');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('LEDGER_UNREACHABLE');
    expect(response.body.tenant).toBeUndefined();
  });

  it('fails closed when session resolution fails', async () => {
    vi.mocked(auth.api.getSession).mockRejectedValue(new Error('fixture session unavailable'));
    const response = await request(app).get('/history');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('SESSION_REQUIRED');
    expect(pool.query).not.toHaveBeenCalled();
  });
});
