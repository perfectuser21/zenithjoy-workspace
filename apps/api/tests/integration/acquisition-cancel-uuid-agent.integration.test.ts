import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import app from '../../src/app';
import { addTenantMember, createTestTenant, testPool } from './helpers';

/**
 * Regression for the production Android identity transition:
 * register starts with agents.agent_id (readable slug), then heartbeat returns
 * agents.id (UUID) and the app persists that UUID for every subsequent
 * x-agent-id request. A cancellation receipt must accept both representations
 * of the same bound agent.
 */
describe('Android cancel receipt accepts heartbeat UUID identity', () => {
  const run = randomUUID().replace(/-/g, '').slice(0, 8);
  const userId = `cancel-uuid-${run}`;
  const runtimeAgentId = `agent-cancel-uuid-${run}`;
  const licenseKey = `ZJ-B-${run.toUpperCase()}`;
  const machineId = `cancel-uuid-machine-${run}`;
  let tenantId = '';
  let licenseId = '';
  let agentUuid = '';
  let taskId = '';

  beforeAll(async () => {
    tenantId = (await createTestTenant(`cancel-uuid-${run}`)).id;
    await addTenantMember(tenantId, userId, 'owner');

    const license = await testPool.query<{ id: string }>(
      `INSERT INTO zenithjoy.licenses
         (license_key, tier, max_machines, status, expires_at, tenant_id, is_test)
       VALUES ($1, 'basic', 1, 'active', NOW() + interval '1 day', $2, true)
       RETURNING id`,
      [licenseKey, tenantId],
    );
    licenseId = license.rows[0].id;

    const agent = await testPool.query<{ id: string }>(
      `INSERT INTO zenithjoy.agents
         (tenant_id, agent_id, hostname, status, os_type, capabilities,
          license_id, last_heartbeat_at)
       VALUES ($1, $2, $3, 'online', 'android', ARRAY['android'], $4, NOW())
       RETURNING id`,
      [tenantId, runtimeAgentId, `cancel-uuid-phone-${run}`, licenseId],
    );
    agentUuid = agent.rows[0].id;

    const task = await testPool.query<{ id: string }>(
      `INSERT INTO zenithjoy.acquisition_collect_tasks
         (tenant_id, keywords, status, agent_id, started_at)
       VALUES ($1, '["装修"]'::jsonb, 'running', $2, NOW())
       RETURNING id`,
      [tenantId, agentUuid],
    );
    taskId = task.rows[0].id;
  });

  afterAll(async () => {
    if (agentUuid) await testPool.query('DELETE FROM zenithjoy.publish_tasks WHERE agent_id = $1', [agentUuid]);
    if (tenantId) await testPool.query('DELETE FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id = $1', [tenantId]);
    if (licenseId) await testPool.query('DELETE FROM zenithjoy.license_machines WHERE license_id = $1', [licenseId]);
    if (agentUuid) await testPool.query('DELETE FROM zenithjoy.agents WHERE id = $1', [agentUuid]);
    if (licenseId) await testPool.query('DELETE FROM zenithjoy.licenses WHERE id = $1', [licenseId]);
    if (tenantId) {
      await testPool.query('DELETE FROM zenithjoy.tenant_members WHERE tenant_id = $1', [tenantId]);
      await testPool.query('DELETE FROM zenithjoy.tenants WHERE id = $1', [tenantId]);
    }
    await testPool.end();
  });

  it('reports cancelled with the UUID persisted from heartbeat', async () => {
    const cancel = await request(app)
      .post('/api/acquisition/collect/cancel')
      .set('X-Feishu-User-Id', userId)
      .send({ task_id: taskId });
    expect(cancel.status).toBe(200);

    const heartbeat = await request(app)
      .post('/api/agent/heartbeat')
      .send({
        license: licenseKey,
        version: '2.1.17-e2e',
        hostname: `cancel-uuid-phone-${run}`,
        os_type: 'android',
        agent_id: runtimeAgentId,
        agent_uuid: agentUuid,
        machine_id: machineId,
      });
    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body.agent_id).toBe(agentUuid);

    const report = await request(app)
      .post('/api/acquisition/collect/report')
      .set('x-agent-id', agentUuid)
      .send({
        task_id: taskId,
        video_id: `cancelled_${taskId.slice(0, 8)}`,
        commenters: [],
        checkpoint: { last_video_id: null, processed_video_ids: [] },
        terminal: true,
        partial_reason: 'user_cancelled',
      });

    expect(report.status).toBe(200);
    expect(report.body.data).toMatchObject({ task_id: taskId, status: 'cancelled' });

    const command = await testPool.query<{ status: string; receipt_at: Date | null }>(
      `SELECT status, receipt_at
         FROM zenithjoy.publish_tasks
        WHERE agent_id = $1
          AND task_type = 'acquisition_cancel'
          AND payload->>'collect_task_id' = $2`,
      [agentUuid, taskId],
    );
    expect(command.rows).toHaveLength(1);
    expect(command.rows[0].status).toBe('completed');
    expect(command.rows[0].receipt_at).not.toBeNull();

    // The route deliberately enables its real-DB branch in Vitest only when
    // DATABASE_URL is present. CI supplies split DATABASE_* settings, so set
    // the same opt-in signal while still using testPool's real PostgreSQL.
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = previousDatabaseUrl || 'postgresql://integration-test';
    const cooldownStart = await request(app)
      .post('/api/acquisition/collect/start')
      .set('X-Feishu-User-Id', userId)
      .send({ keywords: ['装修'], agent_id: agentUuid });
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    expect(cooldownStart.status).toBe(409);
    expect(cooldownStart.body.error.code).toBe('DEVICE_CANCEL_COOLDOWN');
    expect(cooldownStart.body.error.remaining_seconds).toBeGreaterThan(0);
    expect(cooldownStart.body.error.remaining_seconds).toBeLessThanOrEqual(300);

    const persisted = await testPool.query<{
      status: string;
      device_machine_id: string;
      cancelled_at: Date | null;
    }>(
      `SELECT status, device_machine_id, cancelled_at
         FROM zenithjoy.acquisition_collect_tasks
        WHERE id = $1`,
      [taskId],
    );
    expect(persisted.rows[0]).toMatchObject({
      status: 'cancelled',
      device_machine_id: machineId,
    });
    expect(persisted.rows[0].cancelled_at).not.toBeNull();

    const nextHeartbeat = await request(app)
      .post('/api/agent/heartbeat')
      .send({
        license: licenseKey,
        version: '2.1.17-e2e',
        hostname: `cancel-uuid-phone-${run}`,
        os_type: 'android',
        agent_id: runtimeAgentId,
        agent_uuid: agentUuid,
        machine_id: machineId,
      });
    expect(nextHeartbeat.status).toBe(200);
    expect(nextHeartbeat.body.queued_tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'acquisition_cancel',
          payload: expect.objectContaining({ collect_task_id: taskId }),
        }),
      ]),
    );
  });

  it('rejects an unassigned pending task without creating an invalid command', async () => {
    const pending = await testPool.query<{ id: string }>(
      `INSERT INTO zenithjoy.acquisition_collect_tasks
         (tenant_id, keywords, status, agent_id)
       VALUES ($1, '["装修"]'::jsonb, 'pending', NULL)
       RETURNING id`,
      [tenantId],
    );

    const response = await request(app)
      .post('/api/acquisition/collect/cancel')
      .set('X-Feishu-User-Id', userId)
      .send({ task_id: pending.rows[0].id });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('TASK_NOT_CANCELLABLE');
    const commandCount = await testPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM zenithjoy.publish_tasks
        WHERE payload->>'collect_task_id' = $1`,
      [pending.rows[0].id],
    );
    expect(commandCount.rows[0].count).toBe('0');
  });
});
