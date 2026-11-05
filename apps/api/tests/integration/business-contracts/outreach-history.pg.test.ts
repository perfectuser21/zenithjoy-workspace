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
  return { tenant, userId: signup.body.user.id as string, cookie: signup.headers['set-cookie'] as string[] };
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
    // A corrupt legacy record must not let another tenant's receipt leak into A's history.
    await pool.query("INSERT INTO zenithjoy.dm_outreach_log(tenant_id,account_label,assignment_id,sent_at) VALUES($1,'foreign-receipt',$2,'2026-01-01T00:00:00Z')", [b.tenant, aId]);
    for (const path of ['/api/acquisition/outreach-history', '/api/acquisition/dispatch/outreach-history']) {
      const anonymous = await request(app).get(path);
      expect(anonymous.status).toBe(401);
      const forgedAnonymous = await request(app).get(path).set('X-Tenant-Id', b.tenant);
      expect(forgedAnonymous.status).toBe(401);
      const own = await request(app).get(path).query({ tenant_id: b.tenant }).set('Cookie', a.cookie).set('X-Tenant-Id', b.tenant);
      expect(own.status).toBe(200);
      expect(own.body).toMatchObject({ success: true, data: { total: 1, items: [{ id: aId, lead_nickname: 'tenant-a-history', sent_at: null }] } });
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

describe('retained acquisition history and cancellation — session-only real SQL', () => {
  async function fixtures() {
    const a = await member(), b = await member();
    const agentA = (await pool.query('INSERT INTO zenithjoy.agents(tenant_id,agent_id,hostname,status) VALUES($1,$2,$3,\'online\') RETURNING id', [a.tenant, `agent-${randomUUID()}`, 'history-a'])).rows[0].id as string;
    const agentB = (await pool.query('INSERT INTO zenithjoy.agents(tenant_id,agent_id,hostname,status) VALUES($1,$2,$3,\'online\') RETURNING id', [b.tenant, `agent-${randomUUID()}`, 'history-b'])).rows[0].id as string;
    const taskA = (await pool.query("INSERT INTO zenithjoy.acquisition_collect_tasks(tenant_id,agent_id,keywords,status) VALUES($1,$2,'[\"tenant-a-keyword\"]','running') RETURNING id", [a.tenant, agentA])).rows[0].id as string;
    const taskB = (await pool.query("INSERT INTO zenithjoy.acquisition_collect_tasks(tenant_id,agent_id,keywords,status) VALUES($1,$2,'[\"secret-foreign-keyword\"]','running') RETURNING id", [b.tenant, agentB])).rows[0].id as string;
    const videoA = `video-a-${randomUUID()}`;
    const videoB = `video-b-${randomUUID()}`;
    await pool.query('INSERT INTO zenithjoy.acquisition_collect_videos(video_id,task_id,tenant_id,title) VALUES($1,$2,$3,$4),($5,$6,$7,$8)', [videoA, taskA, a.tenant, 'tenant-a-video', videoB, taskB, b.tenant, 'tenant-b-video']);
    // Corrupt historic task linkage must not expose another tenant's keywords.
    await pool.query('INSERT INTO zenithjoy.acquisition_leads(tenant_id,nickname,collect_task_id,source_video_ids) VALUES($1,$2,$3,$4::jsonb),($5,$6,$7,$8::jsonb)', [a.tenant, 'tenant-a-lead', taskB, JSON.stringify([videoA]), b.tenant, 'tenant-b-lead', taskB, JSON.stringify([videoB])]);
    await pool.query('INSERT INTO zenithjoy.agent_warmup_liveness(agent_id,nickname,alive) VALUES($1,$2,true),($3,$4,true)', [agentA, 'tenant-a-warm', agentB, 'tenant-b-warm']);
    return { a, b, taskA, taskB, videoA, videoB, agentA, agentB };
  }

  it('rejects forged member/tenant headers and keeps cookie-scoped historical reads', async () => {
    const f = await fixtures();
    const paths = ['/api/acquisition/collect-tasks', `/api/acquisition/collect-tasks/${f.taskA}/videos`, `/api/acquisition/videos/${f.videoA}/leads`, '/api/acquisition/leads', `/api/agent/burner/warmup-liveness?agent_id=${f.agentA}`, '/api/acquisition/outreach-history', '/api/acquisition/dispatch/outreach-history'];
    for (const path of paths) {
      const spoof = await request(app).get(path).set('X-Feishu-User-Id', f.a.userId).set('X-Tenant-Id', f.a.tenant);
      expect(spoof.status, path).toBe(401);
      const own = await request(app).get(path).set('Cookie', f.a.cookie).set('X-Feishu-User-Id', f.b.userId).set('X-Tenant-Id', f.b.tenant);
      expect(own.status, path).toBe(200);
      expect(JSON.stringify(own.body), path).not.toContain('tenant-b-');
      expect(JSON.stringify(own.body), path).not.toContain('secret-foreign-keyword');
    }
    const list = await request(app).get('/api/acquisition/collect-tasks').set('Cookie', f.a.cookie);
    expect(list.body.data.tasks.map((task: {id: string}) => task.id)).toContain(f.taskA);
    expect(list.body.data.tasks.map((task: {id: string}) => task.id)).not.toContain(f.taskB);
    expect((await request(app).get(`/api/acquisition/collect-tasks/${f.taskB}/videos`).set('Cookie', f.a.cookie)).status).toBe(404);
    expect((await request(app).get(`/api/acquisition/videos/${f.videoB}/leads`).set('Cookie', f.a.cookie)).status).toBe(404);
    const foreignWarmup = await request(app).get(`/api/agent/burner/warmup-liveness?agent_id=${f.agentB}`).set('Cookie', f.a.cookie);
    expect(foreignWarmup.body.data.liveness).toEqual([]);
  });

  it('preserves authorized cancellation without letting forged identities or another tenant cancel', async () => {
    const f = await fixtures();
    const path = '/api/acquisition/collect/cancel';
    const forged = await request(app).post(path).set('X-Feishu-User-Id', f.a.userId).send({task_id:f.taskA});
    expect(forged.status).toBe(401);
    const cross = await request(app).post(path).set('Cookie', f.b.cookie).send({task_id:f.taskA});
    expect(cross.status).toBe(403);
    expect((await pool.query('SELECT status FROM zenithjoy.acquisition_collect_tasks WHERE id=$1', [f.taskA])).rows[0].status).toBe('running');
    const own = await request(app).post(path).set('Cookie', f.a.cookie).set('X-Feishu-User-Id', f.b.userId).set('X-Tenant-Id', f.b.tenant).send({task_id:f.taskA});
    expect(own.status).toBe(200);
    expect(own.body.data).toMatchObject({task_id:f.taskA,status:'cancelling'});
    expect((await pool.query('SELECT status FROM zenithjoy.acquisition_collect_tasks WHERE id=$1', [f.taskA])).rows[0].status).toBe('cancelling');
  });

  it('multi-organization membership and ledger failure are rejected instead of selecting a tenant', async () => {
    const f = await fixtures();
    await pool.query("INSERT INTO zenithjoy.tenant_members(tenant_id,feishu_user_id,role) VALUES($1,$2,'member')", [f.b.tenant, f.a.userId]);
    const multiple = await request(app).get('/api/acquisition/leads').set('Cookie', f.a.cookie);
    expect(multiple.status).toBe(409);
    const query = pool.query.bind(pool);
    const fault = vi.spyOn(pool, 'query').mockImplementation(((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('SELECT DISTINCT tenant_id::text AS tenant_id FROM zenithjoy.tenant_members')) return Promise.reject(new Error('fixture membership database secret'));
      return (query as (...items: unknown[]) => unknown)(...args);
    }) as typeof pool.query);
    try {
      const unavailable = await request(app).get('/api/acquisition/leads').set('Cookie', f.b.cookie);
      expect(unavailable.status).toBe(503);
      expect(JSON.stringify(unavailable.body)).not.toContain('fixture membership database secret');
    } finally { fault.mockRestore(); }
  });

  it('all retained history endpoints surface query failure without leaking database details', async () => {
    const f = await fixtures();
    const paths: Array<[string,string]> = [
      ['/api/acquisition/collect-tasks','FROM zenithjoy.acquisition_collect_tasks'],
      [`/api/acquisition/collect-tasks/${f.taskA}/videos`,'FROM zenithjoy.acquisition_collect_tasks'],
      [`/api/acquisition/videos/${f.videoA}/leads`,'FROM zenithjoy.acquisition_collect_videos'],
      ['/api/acquisition/leads','FROM zenithjoy.acquisition_leads'],
      [`/api/agent/burner/warmup-liveness?agent_id=${f.agentA}`,'FROM zenithjoy.agent_warmup_liveness'],
    ];
    for (const [path, sql] of paths) {
      const query = pool.query.bind(pool);
      const fault = vi.spyOn(pool, 'query').mockImplementation(((...args: unknown[]) => {
        if (typeof args[0] === 'string' && args[0].includes(sql)) return Promise.reject(new Error('database secret fixture'));
        return (query as (...items: unknown[]) => unknown)(...args);
      }) as typeof pool.query);
      try {
        const response = await request(app).get(path).set('Cookie', f.a.cookie);
        expect(response.status, path).toBe(503);
        expect(JSON.stringify(response.body), path).not.toContain('database secret fixture');
      } finally { fault.mockRestore(); }
    }
  });
});
