/**
 * TDD Red — 前台不可逆放弃 Android 获客任务。
 *
 * 这些测试使用真实 Express app + zenithjoy_test Postgres；禁止 mock
 * acquisition route、heartbeat service 或数据库。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import app from '../../../apps/api/src/app';
import {
  addTenantMember,
  createTestTenant,
  testPool,
} from '../../../apps/api/tests/integration/helpers';

const run = randomUUID().slice(0, 8);
const userA = `cancel-owner-a-${run}`;
const userB = `cancel-owner-b-${run}`;
let tenantA = '';
let tenantB = '';
let taskId = '';
let agentId = '';
let licenseKey = '';

beforeAll(async () => {
  const a = await createTestTenant(`cancel-tenant-a-${run}`);
  const b = await createTestTenant(`cancel-tenant-b-${run}`);
  tenantA = a.id;
  tenantB = b.id;
  await addTenantMember(tenantA, userA, 'owner');
  await addTenantMember(tenantB, userB, 'owner');

  const license = await testPool.query<{ id: string }>(
    `INSERT INTO zenithjoy.licenses
       (license_key, tier, max_machines, status, expires_at, tenant_id)
     VALUES ($1, 'basic', 1, 'active', NOW() + interval '1 day', $2)
     RETURNING id`,
    [`ZJ-B-CANCEL-${run.toUpperCase()}`, tenantA],
  );
  licenseKey = `ZJ-B-CANCEL-${run.toUpperCase()}`;

  const agent = await testPool.query<{ id: string }>(
    `INSERT INTO zenithjoy.agents
       (tenant_id, agent_id, hostname, status, os_type, capabilities, license_id, last_heartbeat_at)
     VALUES ($1, $2, $3, 'online', 'android', ARRAY['android'], $4, NOW())
     RETURNING id`,
    [tenantA, `cancel-agent-${run}`, `cancel-phone-${run}`, license.rows[0].id],
  );
  agentId = agent.rows[0].id;

  const task = await testPool.query<{ id: string }>(
    `INSERT INTO zenithjoy.acquisition_collect_tasks
       (tenant_id, keywords, status, agent_id, started_at)
     VALUES ($1, '["装修"]'::jsonb, 'running', $2, NOW())
     RETURNING id`,
    [tenantA, agentId],
  );
  taskId = task.rows[0].id;
});

afterAll(async () => {
  await testPool.query('DELETE FROM zenithjoy.publish_tasks WHERE agent_id = $1', [agentId]);
  await testPool.query('DELETE FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
  await testPool.query('DELETE FROM zenithjoy.agents WHERE id = $1', [agentId]);
  await testPool.query('DELETE FROM zenithjoy.licenses WHERE license_key = $1', [licenseKey]);
  await testPool.query('DELETE FROM zenithjoy.tenant_members WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
  await testPool.query('DELETE FROM zenithjoy.tenants WHERE id IN ($1, $2)', [tenantA, tenantB]);
  await testPool.end();
});

describe('Android 获客任务不可逆取消真实接缝', () => {
  it('本人租户取消 running 任务返回 cancelling 且不接受 body tenant_id', async () => {
    const res = await request(app)
      .post('/api/acquisition/collect/cancel')
      .set('X-Feishu-User-Id', userA)
      .send({ task_id: taskId });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        task_id: taskId,
        status: 'cancelling',
        cancel_phase: 'requested',
      },
    });
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success', 'timestamp']);
    expect(Object.keys(res.body.data).sort()).toEqual(['cancel_phase', 'status', 'task_id']);
    for (const forbidden of ['tenant_id', 'device_id', 'paused', 'resumable']) {
      expect(res.body.data).not.toHaveProperty(forbidden);
    }
  });

  it('跨租户取消返回 TASK_NOT_FOUND 且不泄露设备或任务数据', async () => {
    const res = await request(app)
      .post('/api/acquisition/collect/cancel')
      .set('X-Feishu-User-Id', userB)
      .send({ task_id: taskId });

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({
      code: 'TASK_NOT_FOUND',
      message: '采集任务不存在',
    });
    expect(JSON.stringify(res.body)).not.toContain(agentId);
    expect(JSON.stringify(res.body)).not.toContain(tenantA);
  });

  it('下一次生产形状 heartbeat 只下发一条 acquisition_cancel 指令', async () => {
    const res = await request(app)
      .post('/api/agent/heartbeat')
      .send({
        license: licenseKey,
        version: 'contract-red',
        hostname: `cancel-phone-${run}`,
        os_type: 'android',
        agent_uuid: agentId,
        machine_id: `cancel-machine-${run}`,
      });

    expect(res.status).toBe(200);
    const commands = res.body.queued_tasks.filter(
      (task: { type?: string; payload?: { collect_task_id?: string } }) =>
        task.type === 'acquisition_cancel' && task.payload?.collect_task_id === taskId,
    );
    expect(commands).toHaveLength(1);
  });

  it('重复取消幂等且不生成第二条指令、不延长取消时间', async () => {
    const before = await testPool.query(
      `SELECT cancel_requested_at FROM zenithjoy.acquisition_collect_tasks WHERE id = $1`,
      [taskId],
    );
    const res = await request(app)
      .post('/api/acquisition/collect/cancel')
      .set('X-Feishu-User-Id', userA)
      .send({ task_id: taskId });
    const after = await testPool.query(
      `SELECT cancel_requested_at FROM zenithjoy.acquisition_collect_tasks WHERE id = $1`,
      [taskId],
    );
    const commandCount = await testPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM zenithjoy.publish_tasks
        WHERE agent_id = $1
          AND task_type = 'acquisition_cancel'
          AND payload->>'collect_task_id' = $2`,
      [agentId, taskId],
    );

    expect(res.status).toBe(200);
    expect(res.body.data.cancel_phase).toMatch(/requested|sent/);
    expect(commandCount.rows[0].count).toBe('1');
    expect(after.rows[0].cancel_requested_at).toEqual(before.rows[0].cancel_requested_at);
  });

  it('只有绑定 Android Agent 回执后才落 cancelled 并从该刻开始五分钟冷却', async () => {
    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .set('x-agent-id', agentId)
      .send({
        task_id: taskId,
        video_id: `cancelled_${taskId.slice(0, 8)}`,
        commenters: [],
        terminal: true,
        partial_reason: 'user_cancelled',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
    const row = await testPool.query(
      `SELECT status, cancelled_at, ended_at
         FROM zenithjoy.acquisition_collect_tasks
        WHERE id = $1`,
      [taskId],
    );
    expect(row.rows[0].status).toBe('cancelled');
    expect(row.rows[0].cancelled_at).not.toBeNull();
    expect(row.rows[0].ended_at).not.toBeNull();
  });

  it('冷却期内同设备新任务返回 DEVICE_CANCEL_COOLDOWN 和剩余秒数', async () => {
    const blocked = await request(app)
      .post('/api/acquisition/collect/start')
      .set('X-Feishu-User-Id', userA)
      .send({ keywords: ['装修'], agent_id: agentId });

    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('DEVICE_CANCEL_COOLDOWN');
    expect(blocked.body.error.remaining_seconds).toBeGreaterThan(0);
    expect(blocked.body.error.remaining_seconds).toBeLessThanOrEqual(300);

    await testPool.query(
      `UPDATE zenithjoy.acquisition_collect_tasks
          SET cancelled_at = NOW() - interval '301 seconds'
        WHERE id = $1`,
      [taskId],
    );
    const allowed = await request(app)
      .post('/api/acquisition/collect/start')
      .set('X-Feishu-User-Id', userA)
      .send({ keywords: ['装修'], agent_id: agentId });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.status).toBe('pending');
  });
});
