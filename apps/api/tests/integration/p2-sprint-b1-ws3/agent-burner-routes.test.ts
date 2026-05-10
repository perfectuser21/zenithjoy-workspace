/**
 * WS3a — 中台 burner 路由: agent-burner.ts (6 endpoints + 6 错码) (CI 实跑落点)
 *
 * Path: apps/api/tests/integration/p2-sprint-b1-ws3/ (4 deep) → ../../../src/app
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import app from '../../../src/app';

let pool: Pool;
let tenantId: string;
let agentId: string;

beforeAll(async () => {
  pool = new Pool({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME || 'cecelia',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD,
  });

  const t = await pool.query(
    `INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ($1, $2, 'free') RETURNING id`,
    [`smoke-b1-test-${Date.now()}`, `smoke-b1-key-${Date.now()}`]
  );
  tenantId = t.rows[0].id;

  await pool.query(
    `INSERT INTO zenithjoy.tenant_feishu_bindings (tenant_id, tenant_access_token, expires_at, app_token, table_id_lead_profile, table_id_target_videos, table_id_leads, bound_at)
     VALUES ($1, 'fake_t', NOW()+interval'1 hour', 'bascn_b1', 'tbl_p', 'tbl_v', 'tbl_l', NOW())`,
    [tenantId]
  );

  const a = await pool.query(
    `INSERT INTO zenithjoy.agents (tenant_id, machine_id, hostname, status) VALUES ($1, $2, 'rog-test', 'online') RETURNING id`,
    [tenantId, `mac-b1-${Date.now()}`]
  );
  agentId = a.rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id=$1`, [agentId]);
  await pool.query(`DELETE FROM zenithjoy.publish_tasks WHERE payload->>'agent_id'=$1`, [agentId]);
  await pool.query(`DELETE FROM zenithjoy.agents WHERE id=$1`, [agentId]);
  await pool.query(`DELETE FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id=$1`, [tenantId]);
  await pool.query(`DELETE FROM zenithjoy.tenants WHERE id=$1`, [tenantId]);
  await pool.end();
});

describe('Workstream 3a — agent-burner routes [BEHAVIOR]', () => {
  it('POST /api/agent/burner/qr-bind 正常 200 + task_id', async () => {
    const r = await request(app)
      .post('/api/agent/burner/qr-bind')
      .send({ tenant_id: tenantId, agent_id: agentId, account_label: '装修小号1' });
    expect(r.status).toBe(200);
    expect(r.body.data.task_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('POST /api/agent/burner/qr-bind 缺 account_label → 400 MISSING_ACCOUNT_LABEL', async () => {
    const r = await request(app)
      .post('/api/agent/burner/qr-bind')
      .send({ tenant_id: tenantId, agent_id: agentId });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('MISSING_ACCOUNT_LABEL');
  });

  it('POST /api/agent/burner/qr-bind account_label=default → 400 RESERVED_ACCOUNT_LABEL', async () => {
    const r = await request(app)
      .post('/api/agent/burner/qr-bind')
      .send({ tenant_id: tenantId, agent_id: agentId, account_label: 'default' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('RESERVED_ACCOUNT_LABEL');
  });

  it('POST /api/agent/burner/qr-bind-result 写 agent_platform_sessions role=burner', async () => {
    const t = await request(app)
      .post('/api/agent/burner/qr-bind')
      .send({ tenant_id: tenantId, agent_id: agentId, account_label: '装修小号A' });
    const taskId = t.body.data.task_id;

    const r = await request(app)
      .post('/api/agent/burner/qr-bind-result')
      .set('X-Smoke-Token', process.env.SMOKE_TOKEN || 'test-token')
      .send({
        task_id: taskId,
        agent_id: agentId,
        qr_login: 'success',
        cookie_local_path: '/tmp/burner/装修小号A.json',
        account_nickname: '小号A',
      });
    expect(r.status).toBe(200);

    const { rows } = await pool.query(
      `SELECT role, status FROM zenithjoy.agent_platform_sessions WHERE agent_id=$1 AND account_label='装修小号A'`,
      [agentId]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].role).toBe('burner');
    expect(rows[0].status).toBe('active');
  });

  it('GET /api/agent/burner/sessions 返 burner 列表', async () => {
    const r = await request(app).get(`/api/agent/burner/sessions?tenant_id=${tenantId}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data.sessions)).toBe(true);
    expect(r.body.data.sessions.every((s: any) => s.role === 'burner')).toBe(true);
  });

  it('POST /api/agent/burner/crawl-comments 缺 video_url → 400 MISSING_VIDEO_URL', async () => {
    const r = await request(app)
      .post('/api/agent/burner/crawl-comments')
      .send({ tenant_id: tenantId, agent_id: agentId, account_label: '装修小号A' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('MISSING_VIDEO_URL');
  });

  it('POST /api/agent/burner/crawl-comments 无 burner session → 400 NO_BURNER_SESSION', async () => {
    const r = await request(app)
      .post('/api/agent/burner/crawl-comments')
      .send({
        tenant_id: tenantId,
        agent_id: agentId,
        account_label: '不存在小号_xyz',
        video_url: 'https://www.douyin.com/video/123',
      });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('NO_BURNER_SESSION');
  });

  it('POST /api/agent/burner/crawl-comments-result 触发 lead-writer + 更新 task', async () => {
    const c = await request(app)
      .post('/api/agent/burner/crawl-comments')
      .send({
        tenant_id: tenantId,
        agent_id: agentId,
        account_label: '装修小号A',
        video_url: 'https://www.douyin.com/video/7000000000000000001',
      });
    const crawlTaskId = c.body.data.task_id;

    const r = await request(app)
      .post('/api/agent/burner/crawl-comments-result')
      .set('X-Smoke-Token', process.env.SMOKE_TOKEN || 'test-token')
      .send({
        task_id: crawlTaskId,
        agent_id: agentId,
        video_url: 'https://www.douyin.com/video/7000000000000000001',
        comments: Array.from({ length: 5 }, (_, i) => ({
          commenter_id: `@u_${i}`,
          text: `求联系 ${i}`,
          publish_time: '2026-05-10T10:00:00Z',
        })),
      });
    expect(r.status).toBe(200);

    const { rows } = await pool.query(
      `SELECT status, response FROM zenithjoy.publish_tasks WHERE id=$1`,
      [crawlTaskId]
    );
    expect(rows[0].status).toBe('done');
    expect(rows[0].response.comment_count).toBe(5);
  });
});
