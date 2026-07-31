/**
 * TDD Red — 前台不可逆放弃 Android 获客任务。
 *
 * 这些测试使用真实 Express app + zenithjoy_test Postgres；禁止 mock
 * acquisition route、heartbeat service 或数据库。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
let runtimeAgentId = '';
let licenseKey = '';
let licenseId = '';
const stableMachineId = `cancel-machine-${run}`;

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
  licenseId = license.rows[0].id;

  const agent = await testPool.query<{ id: string }>(
    `INSERT INTO zenithjoy.agents
       (tenant_id, agent_id, hostname, status, os_type, capabilities, license_id, last_heartbeat_at)
     VALUES ($1, $2, $3, 'online', 'android', ARRAY['android'], $4, NOW())
     RETURNING id`,
    [tenantA, `cancel-agent-${run}`, `cancel-phone-${run}`, license.rows[0].id],
  );
  agentId = agent.rows[0].id;
  runtimeAgentId = `cancel-agent-${run}`;
  await testPool.query(
    `INSERT INTO zenithjoy.license_machines
       (license_id, machine_id, agent_id, hostname, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [licenseId, stableMachineId, runtimeAgentId, `cancel-phone-${run}`],
  );
});

beforeEach(async () => {
  const task = await testPool.query<{ id: string }>(
    `INSERT INTO zenithjoy.acquisition_collect_tasks
       (tenant_id, keywords, status, agent_id, started_at)
     VALUES ($1, '["装修"]'::jsonb, 'running', $2, NOW())
     RETURNING id`,
    [tenantA, agentId],
  );
  taskId = task.rows[0].id;
});

afterEach(async () => {
  await testPool.query('DELETE FROM zenithjoy.publish_tasks WHERE agent_id = $1', [agentId]);
  await testPool.query('DELETE FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
});

afterAll(async () => {
  await testPool.query('DELETE FROM zenithjoy.agents WHERE tenant_id = $1', [tenantA]);
  await testPool.query('DELETE FROM zenithjoy.license_machines WHERE license_id = $1', [licenseId]);
  await testPool.query('DELETE FROM zenithjoy.licenses WHERE license_key = $1', [licenseKey]);
  await testPool.query('DELETE FROM zenithjoy.tenant_members WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
  await testPool.query('DELETE FROM zenithjoy.tenants WHERE id IN ($1, $2)', [tenantA, tenantB]);
  await testPool.end();
});

async function requestCancel() {
  return request(app)
    .post('/api/acquisition/collect/cancel')
    .set('X-Feishu-User-Id', userA)
    .send({ task_id: taskId });
}

async function reportCancelled(headerAgentId = runtimeAgentId) {
  return request(app)
    .post('/api/acquisition/collect/report')
    .set('x-agent-id', headerAgentId)
    .send({
      task_id: taskId,
      video_id: `cancelled_${taskId.slice(0, 8)}`,
      commenters: [],
      checkpoint: { last_video_id: null, processed_video_ids: [] },
      terminal: true,
      partial_reason: 'user_cancelled',
    });
}

async function sendProductionHeartbeat() {
  return request(app)
    .post('/api/agent/heartbeat')
    .send({
      license: licenseKey,
      version: 'contract-red',
      hostname: `cancel-phone-${run}`,
      os_type: 'android',
      agent_id: runtimeAgentId,
      agent_uuid: agentId,
      machine_id: stableMachineId,
    });
}

describe('Android 获客任务不可逆取消真实接缝', () => {
  it('本人租户取消 running 任务返回 cancelling 且不接受 body tenant_id', async () => {
    const res = await requestCancel();

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
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
    for (const forbidden of ['tenant_id', 'device_machine_id', 'agent_id', 'paused', 'resumable']) {
      expect(res.body.data).not.toHaveProperty(forbidden);
    }
  });

  it('跨租户与不存在任务返回不可区分的 403 FORBIDDEN', async () => {
    const crossTenant = await request(app)
      .post('/api/acquisition/collect/cancel')
      .set('X-Feishu-User-Id', userB)
      .send({ task_id: taskId });
    const absent = await request(app)
      .post('/api/acquisition/collect/cancel')
      .set('X-Feishu-User-Id', userB)
      .send({ task_id: randomUUID() });

    expect(crossTenant.status).toBe(403);
    expect(absent.status).toBe(403);
    expect(crossTenant.body.error).toEqual({
      code: 'FORBIDDEN',
      message: '无权操作该采集任务',
    });
    expect(absent.body.error).toEqual(crossTenant.body.error);
    expect(Object.keys(absent.body).sort()).toEqual(Object.keys(crossTenant.body).sort());
    for (const body of [crossTenant.body, absent.body]) {
      expect(JSON.stringify(body)).not.toContain(agentId);
      expect(JSON.stringify(body)).not.toContain(tenantA);
      expect(JSON.stringify(body)).not.toContain(stableMachineId);
    }
  });

  it('heartbeat 下发唯一取消指令并快照稳定设备 machine_id', async () => {
    const cancelled = await requestCancel();
    expect(cancelled.status).toBe(200);

    const beforeHeartbeat = await testPool.query<{ device_machine_id: string | null; cancel_sent_at: Date | null }>(
      `SELECT device_machine_id, cancel_sent_at
         FROM zenithjoy.acquisition_collect_tasks
        WHERE id = $1`,
      [taskId],
    );
    expect(beforeHeartbeat.rows[0]).toEqual({ device_machine_id: null, cancel_sent_at: null });

    const cancelAcceptedAt = Date.now();
    const res = await sendProductionHeartbeat();
    const commandReceivedAt = Date.now();

    expect(res.status).toBe(200);
    const commands = res.body.queued_tasks.filter(
      (task: { type?: string; payload?: { collect_task_id?: string } }) =>
        task.type === 'acquisition_cancel' && task.payload?.collect_task_id === taskId,
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      platform: 'android',
      type: 'acquisition_cancel',
      payload: { collect_task_id: taskId },
    });
    expect(typeof commands[0].task_id).toBe('string');
    // 只锁生产 Android 真正消费的字段；服务端现有 legacy 兼容字段允许保留。
    expect(commands[0].payload.collect_task_id).toBe(taskId);
    expect(commandReceivedAt - cancelAcceptedAt).toBeLessThanOrEqual(30_000);
    const persisted = await testPool.query<{ device_machine_id: string; cancel_sent_at: Date }>(
      `SELECT device_machine_id, cancel_sent_at
         FROM zenithjoy.acquisition_collect_tasks
        WHERE id = $1`,
      [taskId],
    );
    expect(persisted.rows[0].device_machine_id).toBe(stableMachineId);
    expect(persisted.rows[0].cancel_sent_at).not.toBeNull();
  });

  it('取消接受到真实 heartbeat 响应的实测时延不超过 30 秒', async () => {
    const acceptedAt = Date.now();
    const cancelled = await requestCancel();
    expect(cancelled.status).toBe(200);

    const heartbeat = await sendProductionHeartbeat();
    const receivedAt = Date.now();
    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body.queued_tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'acquisition_cancel',
          payload: expect.objectContaining({ collect_task_id: taskId }),
        }),
      ]),
    );
    expect(receivedAt - acceptedAt).toBeLessThanOrEqual(30_000);
  });

  it('Agent 离线期间保留取消意图且恢复 heartbeat 后继续下发', async () => {
    const cancelled = await requestCancel();
    expect(cancelled.status).toBe(200);

    await testPool.query(
      `UPDATE zenithjoy.agents SET status = 'offline' WHERE id = $1`,
      [agentId],
    );
    const pending = await testPool.query(
      `SELECT status, cancel_requested_at, cancelled_at
         FROM zenithjoy.acquisition_collect_tasks
        WHERE id = $1`,
      [taskId],
    );
    expect(pending.rows[0].status).toBe('cancelling');
    expect(pending.rows[0].cancel_requested_at).not.toBeNull();
    expect(pending.rows[0].cancelled_at).toBeNull();

    await testPool.query(
      `UPDATE zenithjoy.agents SET status = 'online' WHERE id = $1`,
      [agentId],
    );
    const recovered = await request(app)
      .post('/api/agent/heartbeat')
      .send({
        license: licenseKey,
        version: 'contract-red',
        hostname: `cancel-phone-${run}`,
        os_type: 'android',
        agent_id: runtimeAgentId,
        agent_uuid: agentId,
        machine_id: stableMachineId,
      });
    expect(recovered.status).toBe(200);
    expect(recovered.body.queued_tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'acquisition_cancel',
          payload: expect.objectContaining({ collect_task_id: taskId }),
        }),
      ]),
    );
  });

  it('重复取消幂等且不生成第二条指令、不延长取消时间', async () => {
    const first = await requestCancel();
    expect(first.status).toBe(200);

    const before = await testPool.query(
      `SELECT cancel_requested_at FROM zenithjoy.acquisition_collect_tasks WHERE id = $1`,
      [taskId],
    );
    const res = await requestCancel();
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

  it('已结束任务返回 409 TASK_NOT_CANCELLABLE 且终态不变', async () => {
    const done = await testPool.query<{ id: string }>(
      `INSERT INTO zenithjoy.acquisition_collect_tasks
         (tenant_id, keywords, status, agent_id, started_at, ended_at)
       VALUES ($1, '["装修"]'::jsonb, 'done', $2, NOW(), NOW())
       RETURNING id`,
      [tenantA, agentId],
    );
    const res = await request(app)
      .post('/api/acquisition/collect/cancel')
      .set('X-Feishu-User-Id', userA)
      .send({ task_id: done.rows[0].id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TASK_NOT_CANCELLABLE');
    const row = await testPool.query(
      `SELECT status, cancel_requested_at
         FROM zenithjoy.acquisition_collect_tasks
        WHERE id = $1`,
      [done.rows[0].id],
    );
    expect(row.rows[0]).toEqual({ status: 'done', cancel_requested_at: null });
  });

  it('取消指令发出 121 秒无回执仍保持 cancelling sent', async () => {
    await testPool.query(
      `UPDATE zenithjoy.acquisition_collect_tasks
          SET status = 'cancelling',
              cancel_sent_at = NOW() - interval '121 seconds',
              cancelled_at = NULL
        WHERE id = $1`,
      [taskId],
    );
    const res = await request(app)
      .get('/api/acquisition/collect-tasks')
      .set('X-Feishu-User-Id', userA);
    expect(res.status).toBe(200);
    const task = res.body.data.tasks.find((item: { id: string }) => item.id === taskId);
    expect(task).toMatchObject({
      id: taskId,
      status: 'cancelling',
      cancel_phase: 'sent',
    });
    expect(task.cooldown_remaining_seconds).toBe(0);
    const row = await testPool.query(
      `SELECT cancelled_at
         FROM zenithjoy.acquisition_collect_tasks
        WHERE id = $1`,
      [taskId],
    );
    expect(row.rows[0].cancelled_at).toBeNull();
  });

  it('只有绑定 Android Agent 回执后才落 cancelled 并从该刻开始五分钟冷却', async () => {
    const requested = await requestCancel();
    expect(requested.status).toBe(200);

    const premature = await reportCancelled(runtimeAgentId);
    expect(premature.status).toBe(409);
    expect(premature.body.error.code).toBe('CANCEL_NOT_SENT');
    const beforeHeartbeat = await testPool.query(
      `SELECT status, cancel_sent_at, cancelled_at
         FROM zenithjoy.acquisition_collect_tasks
        WHERE id = $1`,
      [taskId],
    );
    expect(beforeHeartbeat.rows[0]).toEqual({
      status: 'cancelling',
      cancel_sent_at: null,
      cancelled_at: null,
    });

    const heartbeat = await sendProductionHeartbeat();
    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body.queued_tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'acquisition_cancel',
          payload: expect.objectContaining({ collect_task_id: taskId }),
        }),
      ]),
    );
    const reportStartedAt = Date.now();

    const rejected = await reportCancelled(randomUUID());
    expect(rejected.status).toBe(403);

    // 生产 CollectReporter 发送 agents.agent_id 文本 slug，不走 DB UUID 兼容旁路。
    const res = await reportCancelled(runtimeAgentId);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success', 'timestamp']);
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
    const row = await testPool.query(
      `SELECT status, cancelled_at, ended_at
         FROM zenithjoy.acquisition_collect_tasks
        WHERE id = $1`,
      [taskId],
    );
    expect(row.rows[0].status).toBe('cancelled');
    expect(row.rows[0].cancelled_at).not.toBeNull();
    expect(row.rows[0].ended_at).not.toBeNull();
    expect(new Date(row.rows[0].cancelled_at).getTime()).toBeGreaterThanOrEqual(reportStartedAt);
    expect(new Date(row.rows[0].ended_at).getTime()).toBeGreaterThanOrEqual(reportStartedAt);
  });

  it('重复 cancelled 回执幂等且不延长五分钟冷却起点', async () => {
    const requested = await requestCancel();
    expect(requested.status).toBe(200);
    const heartbeat = await sendProductionHeartbeat();
    expect(heartbeat.status).toBe(200);
    const confirmed = await reportCancelled(runtimeAgentId);
    expect(confirmed.status).toBe(200);

    const before = await testPool.query(
      `SELECT cancelled_at FROM zenithjoy.acquisition_collect_tasks WHERE id = $1`,
      [taskId],
    );
    const repeated = await reportCancelled(runtimeAgentId);
    expect(repeated.status).toBe(200);
    expect(repeated.body.data.status).toBe('cancelled');
    const after = await testPool.query(
      `SELECT cancelled_at FROM zenithjoy.acquisition_collect_tasks WHERE id = $1`,
      [taskId],
    );
    expect(after.rows[0].cancelled_at).toEqual(before.rows[0].cancelled_at);
  });

  it('稳定 machine_id 冷却不能被更换 agent_id 绕过且不误伤另一设备', async () => {
    const requested = await requestCancel();
    expect(requested.status).toBe(200);
    const heartbeat = await sendProductionHeartbeat();
    expect(heartbeat.status).toBe(200);
    const confirmed = await reportCancelled(runtimeAgentId);
    expect(confirmed.status).toBe(200);

    const replacementRuntimeId = `cancel-agent-reinstalled-${run}`;
    const replacement = await testPool.query<{ id: string }>(
      `INSERT INTO zenithjoy.agents
         (tenant_id, agent_id, hostname, status, os_type, capabilities, license_id, last_heartbeat_at)
       VALUES ($1, $2, $3, 'online', 'android', ARRAY['android'], $4, NOW())
       RETURNING id`,
      [tenantA, replacementRuntimeId, `cancel-phone-reinstalled-${run}`, licenseId],
    );
    await testPool.query(
      `UPDATE zenithjoy.license_machines SET agent_id = $1 WHERE license_id = $2 AND machine_id = $3`,
      [replacementRuntimeId, licenseId, stableMachineId],
    );

    const blocked = await request(app)
      .post('/api/acquisition/collect/start')
      .set('X-Feishu-User-Id', userA)
      .send({ keywords: ['装修'], agent_id: replacement.rows[0].id });

    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('DEVICE_CANCEL_COOLDOWN');
    expect(blocked.body.success).toBe(false);
    expect(blocked.body.error.message).toBe('设备冷却中');
    expect(Object.keys(blocked.body).sort()).toEqual(['error', 'success', 'timestamp']);
    expect(Object.keys(blocked.body.error).sort()).toEqual(['code', 'message', 'remaining_seconds']);
    expect(Number.isNaN(Date.parse(blocked.body.timestamp))).toBe(false);
    expect(blocked.body.error.remaining_seconds).toBeGreaterThan(0);
    expect(blocked.body.error.remaining_seconds).toBeLessThanOrEqual(300);

    const otherRuntimeId = `cancel-agent-other-${run}`;
    const other = await testPool.query<{ id: string }>(
      `INSERT INTO zenithjoy.agents
         (tenant_id, agent_id, hostname, status, os_type, capabilities, license_id, last_heartbeat_at)
       VALUES ($1, $2, $3, 'online', 'android', ARRAY['android'], $4, NOW())
       RETURNING id`,
      [tenantA, otherRuntimeId, `cancel-phone-other-${run}`, licenseId],
    );
    await testPool.query(
      `INSERT INTO zenithjoy.license_machines
         (license_id, machine_id, agent_id, hostname, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [licenseId, `${stableMachineId}-other`, otherRuntimeId, `cancel-phone-other-${run}`],
    );
    const otherAllowed = await request(app)
      .post('/api/acquisition/collect/start')
      .set('X-Feishu-User-Id', userA)
      .send({ keywords: ['装修'], agent_id: other.rows[0].id });
    expect(otherAllowed.status).toBe(200);
    expect(otherAllowed.body.data.status).toBe('pending');

    await testPool.query(
      `UPDATE zenithjoy.acquisition_collect_tasks
          SET cancelled_at = NOW() - interval '301 seconds'
        WHERE id = $1`,
      [taskId],
    );
    const allowed = await request(app)
      .post('/api/acquisition/collect/start')
      .set('X-Feishu-User-Id', userA)
      .send({ keywords: ['装修'], agent_id: replacement.rows[0].id });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.status).toBe('pending');
  });

  it('未登录取消返回 401 且不改变任务', async () => {
    const before = await testPool.query('SELECT status FROM zenithjoy.acquisition_collect_tasks WHERE id = $1', [taskId]);
    const res = await request(app).post('/api/acquisition/collect/cancel').send({ task_id: taskId });
    const after = await testPool.query('SELECT status FROM zenithjoy.acquisition_collect_tasks WHERE id = $1', [taskId]);
    expect(res.status).toBe(401);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('无效生产调用方认证均被拒绝且不落终态', async () => {
    const heartbeat = await request(app).post('/api/agent/heartbeat').send({
      license: 'invalid', hostname: 'x', os_type: 'android', machine_id: stableMachineId,
    });
    const report = await request(app).post('/api/acquisition/collect/report').send({
      task_id: taskId, terminal: true, partial_reason: 'user_cancelled', commenters: [], checkpoint: {},
    });
    expect(heartbeat.status).toBe(401);
    expect(report.status).toBe(401);
    const row = await testPool.query('SELECT status FROM zenithjoy.acquisition_collect_tasks WHERE id = $1', [taskId]);
    expect(row.rows[0].status).toBe('running');
  });

  it('新增取消状态后全状态枚举仍可真实读写，非法状态被约束拒绝', async () => {
    const validStatuses = [
      'pending',
      'running',
      'cancelling',
      'cancelled',
      'done',
      'stage_1_done',
      'partial',
      'failed',
    ];

    for (const status of validStatuses) {
      await testPool.query(
        `UPDATE zenithjoy.acquisition_collect_tasks SET status = $1 WHERE id = $2`,
        [status, taskId],
      );
      const row = await testPool.query<{ status: string }>(
        `SELECT status FROM zenithjoy.acquisition_collect_tasks WHERE id = $1`,
        [taskId],
      );
      expect(row.rows[0].status).toBe(status);
    }

    await expect(
      testPool.query(
        `UPDATE zenithjoy.acquisition_collect_tasks SET status = 'paused' WHERE id = $1`,
        [taskId],
      ),
    ).rejects.toThrow();
  });
});
