import './setup-env';
import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import app from '../../../src/app';
import pool from '../../../src/db/connection';

afterAll(() => pool.end());

async function member() {
  const signup = await request(app).post('/api/auth/sign-up/email').send({
    email: `history-${randomUUID()}@example.test`, password: 'Local-test-password-123', name: 'History fixture',
  });
  expect(signup.status).toBe(200);
  const tenant = (await pool.query('SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id=$1', [signup.body.user.id])).rows[0].tenant_id as string;
  return { tenant, cookie: signup.headers['set-cookie'] as string[] };
}

async function seed(tenant: string, nickname: string) {
  const lead = (await pool.query('INSERT INTO zenithjoy.acquisition_leads(tenant_id,nickname) VALUES($1,$2) RETURNING id', [tenant, nickname])).rows[0].id;
  return (await pool.query("INSERT INTO zenithjoy.dm_assignments(tenant_id,lead_id,account_label,status) VALUES($1,$2,'history-fixture','sent') RETURNING id", [tenant, lead])).rows[0].id as string;
}

describe('retained outreach history — actual HTTP and PostgreSQL', () => {
  it('both paths return only the authenticated tenant and the items/total contract', async () => {
    const a = await member(), b = await member();
    const aId = await seed(a.tenant, 'tenant-a-history');
    const bId = await seed(b.tenant, 'tenant-b-history');
    for (const path of ['/api/acquisition/outreach-history', '/api/acquisition/dispatch/outreach-history']) {
      const anonymous = await request(app).get(path);
      expect(anonymous.status).toBe(401);
      const forgedAnonymous = await request(app).get(path).set('X-Tenant-Id', b.tenant);
      expect(forgedAnonymous.status).toBe(401);
      const own = await request(app).get(path).query({ tenant_id: b.tenant }).set('Cookie', a.cookie).set('X-Tenant-Id', b.tenant);
      expect(own.status).toBe(200);
      expect(own.body).toMatchObject({ success: true, data: { total: 1, items: [{ id: aId, lead_nickname: 'tenant-a-history' }] } });
      expect(JSON.stringify(own.body)).not.toContain(bId);
      expect(JSON.stringify(own.body)).not.toContain('tenant-b-history');
      const other = await request(app).get(path).set('Cookie', b.cookie);
      expect(other.body).toMatchObject({ success: true, data: { total: 1, items: [{ id: bId, lead_nickname: 'tenant-b-history' }] } });
    }
  });

  it('database failure is an explicit error, never an empty successful history', async () => {
    const a = await member();
    const query = pool.query.bind(pool);
    const fault = vi.spyOn(pool, 'query').mockImplementation(((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('FROM zenithjoy.dm_assignments')) return Promise.reject(new Error('fixture database failure'));
      return (query as (...items: unknown[]) => unknown)(...args);
    }) as typeof pool.query);
    try {
      const response = await request(app).get('/api/acquisition/outreach-history').set('Cookie', a.cookie);
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ success: false, error: { code: 'HISTORY_UNAVAILABLE' } });
      expect(JSON.stringify(response.body)).not.toContain('fixture database failure');
    } finally { fault.mockRestore(); }
  });
});
