/**
 * Integration — Walking Skeleton #1（Agent ↔ 中台 Golden Path）
 *
 * 串：heartbeat → folder/bind → publish/task → publish/receipt → GET /publish/tasks/:id
 * 用真实 DB（zenithjoy_test）。
 *
 * 契约：/tmp/walking-skeleton-1-contract.md 第 2 节
 */
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import app from '../../src/app';
import { testPool, truncateTables, createTestTenant } from './helpers';

const HOSTNAME = 'integ-host-ws1.local';

async function createActiveLicense(tenantId: string): Promise<{ id: string; key: string }> {
  const key = `ZJ-B-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 365 * 86400_000).toISOString();
  const { rows } = await testPool.query<{ id: string }>(
    `INSERT INTO zenithjoy.licenses
       (license_key, tier, max_machines, status, expires_at, tenant_id)
     VALUES ($1, 'basic', 1, 'active', $2, $3)
     RETURNING id`,
    [key, expiresAt, tenantId]
  );
  return { id: rows[0].id, key };
}

describe('Walking Skeleton #1 — Agent ↔ 中台 — integration', () => {
  let tenantId: string;
  let licenseKey: string;
  let licenseId: string;
  let agentId: string;
  let publishTaskId: string;

  beforeAll(async () => {
    const tenant = await createTestTenant('WS1 Tenant');
    tenantId = tenant.id;
    const lic = await createActiveLicense(tenantId);
    licenseId = lic.id;
    licenseKey = lic.key;
  });

  afterAll(async () => {
    await truncateTables(
      'zenithjoy.publish_tasks',
      'zenithjoy.agent_platform_sessions',
      'zenithjoy.agents',
      'zenithjoy.licenses',
      'zenithjoy.tenants'
    );
  });

  // ---------- POST /api/agent/heartbeat ----------

  it('POST /api/agent/heartbeat — 401 缺 license', async () => {
    const res = await request(app)
      .post('/api/agent/heartbeat')
      .send({ version: '0.1.0', hostname: HOSTNAME });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_LICENSE');
  });

  it('POST /api/agent/heartbeat — 401 license 不存在', async () => {
    const res = await request(app)
      .post('/api/agent/heartbeat')
      .set('Authorization', 'Bearer ZJ-B-NOTREAL0')
      .send({ version: '0.1.0', hostname: HOSTNAME });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_LICENSE');
  });

  it('POST /api/agent/heartbeat — 首次握手创建 agent，返回 agent_id 和空 queued_tasks', async () => {
    const res = await request(app)
      .post('/api/agent/heartbeat')
      .set('Authorization', `Bearer ${licenseKey}`)
      .send({ version: '0.1.0', hostname: HOSTNAME });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.agent_id).toBe('string');
    expect(res.body.agent_id.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.queued_tasks)).toBe(true);
    expect(res.body.queued_tasks).toHaveLength(0);
    agentId = res.body.agent_id;

    // DB 校验
    const { rows } = await testPool.query(
      'SELECT id, license_id, hostname, version FROM zenithjoy.agents WHERE id = $1',
      [agentId]
    );
    expect(rows[0].license_id).toBe(licenseId);
    expect(rows[0].hostname).toBe(HOSTNAME);
    expect(rows[0].version).toBe('0.1.0');
  });

  it('POST /api/agent/heartbeat — 第二次握手复用同一 agent_id 并刷新心跳', async () => {
    const res = await request(app)
      .post('/api/agent/heartbeat')
      .set('Authorization', `Bearer ${licenseKey}`)
      .send({ version: '0.1.1', hostname: HOSTNAME });
    expect(res.status).toBe(200);
    expect(res.body.agent_id).toBe(agentId);

    const { rows } = await testPool.query(
      'SELECT version, last_heartbeat_at FROM zenithjoy.agents WHERE id = $1',
      [agentId]
    );
    expect(rows[0].version).toBe('0.1.1');
    expect(rows[0].last_heartbeat_at).not.toBeNull();
  });

  // ---------- POST /api/agent/folder/bind ----------

  it('POST /api/agent/folder/bind — 写 agent.bound_folder_path 并入队 folder_bind task', async () => {
    const res = await request(app)
      .post('/api/agent/folder/bind')
      .set('Authorization', `Bearer ${licenseKey}`)
      .send({ agent_id: agentId, local_path: '/Users/foo/my-videos' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const { rows: agentRows } = await testPool.query(
      'SELECT bound_folder_path FROM zenithjoy.agents WHERE id = $1',
      [agentId]
    );
    expect(agentRows[0].bound_folder_path).toBe('/Users/foo/my-videos');

    const { rows: taskRows } = await testPool.query(
      `SELECT platform, status, folder_path FROM zenithjoy.publish_tasks
        WHERE agent_id = $1 AND platform = 'folder_bind'`,
      [agentId]
    );
    expect(taskRows).toHaveLength(1);
    expect(taskRows[0].status).toBe('pending');
    expect(taskRows[0].folder_path).toBe('/Users/foo/my-videos');
  });

  it('POST /api/agent/folder/bind — 400 agent_id 非 UUID', async () => {
    const res = await request(app)
      .post('/api/agent/folder/bind')
      .set('Authorization', `Bearer ${licenseKey}`)
      .send({ agent_id: 'not-a-uuid', local_path: '/x' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  // ---------- 心跳应该看到 folder_bind queued_tasks ----------

  it('POST /api/agent/heartbeat — 现在 queued_tasks 应该返回 folder_bind 那条', async () => {
    const res = await request(app)
      .post('/api/agent/heartbeat')
      .set('Authorization', `Bearer ${licenseKey}`)
      .send({ version: '0.1.1', hostname: HOSTNAME });
    expect(res.status).toBe(200);
    expect(res.body.queued_tasks.length).toBeGreaterThanOrEqual(1);
    const folderBind = res.body.queued_tasks.find(
      (t: { platform: string }) => t.platform === 'folder_bind'
    );
    expect(folderBind).toBeDefined();
    expect(folderBind.folder_path).toBe('/Users/foo/my-videos');
  });

  // ---------- POST /api/publish/task ----------

  it('POST /api/publish/task — 创建 douyin pending 任务', async () => {
    const res = await request(app)
      .post('/api/publish/task')
      .set('Authorization', `Bearer ${licenseKey}`)
      .send({
        agent_id: agentId,
        platform: 'douyin',
        folder_path: '/Users/foo/my-videos',
      });
    expect(res.status).toBe(201);
    expect(res.body.task_id).toBeDefined();
    expect(res.body.status).toBe('pending');
    publishTaskId = res.body.task_id;

    const { rows } = await testPool.query(
      'SELECT platform, status FROM zenithjoy.publish_tasks WHERE id = $1',
      [publishTaskId]
    );
    expect(rows[0].platform).toBe('douyin');
    expect(rows[0].status).toBe('pending');
  });

  it('POST /api/publish/task — 403 当 agent 不属于该 license', async () => {
    // 建另一个 tenant + license + 它的 agent
    const otherTenant = await createTestTenant('WS1 Other Tenant');
    const otherLic = await createActiveLicense(otherTenant.id);
    const hb = await request(app)
      .post('/api/agent/heartbeat')
      .set('Authorization', `Bearer ${otherLic.key}`)
      .send({ version: '0.1.0', hostname: 'other-host.local' });
    expect(hb.status).toBe(200);
    const otherAgentId = hb.body.agent_id;

    // 用本 license 试图给 other-agent 派任务 → 403
    const res = await request(app)
      .post('/api/publish/task')
      .set('Authorization', `Bearer ${licenseKey}`)
      .send({ agent_id: otherAgentId, platform: 'douyin' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  // ---------- POST /api/publish/receipt ----------

  it('POST /api/publish/receipt — Agent 上报 success', async () => {
    const result = {
      url: 'https://www.douyin.com/draft/dryrun-fake',
      dryRun: true,
      dryrun_evidence: 'final button not clicked',
    };
    const res = await request(app)
      .post('/api/publish/receipt')
      .set('Authorization', `Bearer ${licenseKey}`)
      .send({ task_id: publishTaskId, status: 'success', result });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const { rows } = await testPool.query(
      `SELECT status, result, receipt_at FROM zenithjoy.publish_tasks WHERE id = $1`,
      [publishTaskId]
    );
    expect(rows[0].status).toBe('success');
    expect(rows[0].receipt_at).not.toBeNull();
    expect(rows[0].result).toMatchObject({ dryRun: true });
  });

  it('POST /api/publish/receipt — 400 status 必须是 success|failed', async () => {
    const res = await request(app)
      .post('/api/publish/receipt')
      .set('Authorization', `Bearer ${licenseKey}`)
      .send({ task_id: publishTaskId, status: 'pending' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  // ---------- GET /api/publish/tasks/:id ----------

  it('GET /api/publish/tasks/:id — 返回最新状态供 Dashboard 轮询', async () => {
    const res = await request(app)
      .get(`/api/publish/tasks/${publishTaskId}`)
      .set('Authorization', `Bearer ${licenseKey}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(publishTaskId);
    expect(res.body.status).toBe('success');
    expect(res.body.result).toMatchObject({ dryRun: true });
    expect(res.body.created_at).toBeDefined();
    expect(res.body.receipt_at).toBeDefined();
  });

  it('GET /api/publish/tasks/:id — 404 task 不存在', async () => {
    const fake = randomUUID();
    const res = await request(app)
      .get(`/api/publish/tasks/${fake}`)
      .set('Authorization', `Bearer ${licenseKey}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('TASK_NOT_FOUND');
  });
});
