import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:5174';
const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
const screenshots = resolve(process.cwd(), '../../sprints/07310943-kernel-0e82adad/screenshots');
mkdirSync(screenshots, { recursive: true });

test('真实后端显示 requested、sent、confirmed 与 cooldown', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const dbUrl = new URL(process.env.DATABASE_URL ?? '');
  if (process.env.E2E_CANCEL_DISPOSABLE_DB !== '1' || !['localhost', '127.0.0.1'].includes(dbUrl.hostname) || !['/zenithjoy_test', '/cecelia'].includes(dbUrl.pathname) || new URL(apiUrl).hostname !== 'localhost' || new URL(baseUrl).hostname !== 'localhost') {
    throw new Error('Cancellation E2E requires an explicitly disposable local test database and localhost services');
  }
  let userId: string | undefined;
  const machineId = `cancel-machine-${suffix}`;
  const runtimeAgentId = `cancel-agent-${suffix}`;
  const licenseKey = `ZJ-B-CANCEL-E2E-${suffix.toUpperCase()}`;
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const tenant = await db.query<{ id: string }>(
    `INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES($1,$2,'free') RETURNING id`,
    [`cancel-e2e-${suffix}`, licenseKey],
  );
  const tenantId = tenant.rows[0].id;
  const license = await db.query<{ id: string }>(
    `INSERT INTO zenithjoy.licenses(license_key,tier,max_machines,status,expires_at,tenant_id)
     VALUES($1,'basic',1,'active',NOW()+interval '1 day',$2) RETURNING id`, [licenseKey, tenantId],
  );
  const agent = await db.query<{ id: string }>(
    `INSERT INTO zenithjoy.agents(tenant_id,agent_id,hostname,status,os_type,capabilities,license_id,last_heartbeat_at)
     VALUES($1,$2,$3,'online','android',ARRAY['android'],$4,NOW()) RETURNING id`,
    [tenantId, runtimeAgentId, `cancel-phone-${suffix}`, license.rows[0].id],
  );
  await db.query(
    `INSERT INTO zenithjoy.license_machines(license_id,machine_id,agent_id,hostname,status)
     VALUES($1,$2,$3,$4,'active')`,
    [license.rows[0].id, machineId, runtimeAgentId, `cancel-phone-${suffix}`],
  );
  const task = await db.query<{ id: string }>(
    `INSERT INTO zenithjoy.acquisition_collect_tasks(tenant_id,keywords,status,agent_id,started_at)
     VALUES($1,'["装修"]','running',$2,NOW()) RETURNING id`, [tenantId, agent.rows[0].id],
  );

  try {
    const anonymous = await page.request.get(`${apiUrl}/api/acquisition/collect-tasks`);
    expect(anonymous.status()).toBe(401);
    const signup = await page.request.post(`${apiUrl}/api/auth/sign-up/email`, { data: {
      email: `cancel-e2e-${suffix}@example.test`, password: 'Local-test-password-123', name: 'Cancel E2E', license_key: licenseKey,
    } });
    expect(signup.status()).toBe(200);
    userId = (await signup.json()).user.id;
    const membership = await db.query('SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id=$1', [userId]);
    expect(membership.rows.map(row => row.tenant_id)).toEqual([tenantId]);
    await page.goto(`${baseUrl}/area/acquisition/tasks`);
    const [cancelResponse] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/acquisition/collect/cancel') && r.request().method() === 'POST'),
      page.getByRole('button', { name: '放弃' }).first().click(),
    ]);
    expect(cancelResponse.status()).toBe(200);
    await page.reload();
    const requested = page.getByTestId('cancel-requested').first();
    await expect(requested).toBeDisabled();
    await expect(requested).toContainText('取消中');
    await page.screenshot({ path: `${screenshots}/cancel-requested.png` });

    const heartbeat = await page.request.post(`${apiUrl}/api/agent/heartbeat`, { data: {
      license: licenseKey, version: 'e2e', hostname: `cancel-phone-${suffix}`, os_type: 'android',
      agent_id: runtimeAgentId, agent_uuid: agent.rows[0].id, machine_id: machineId,
    } });
    expect(heartbeat.ok()).toBeTruthy();
    await page.reload();
    const sent = page.getByTestId('cancel-sent').first();
    await expect(sent).toBeDisabled();
    await expect(sent).toContainText('取消指令已发送，等待设备响应');
    await page.screenshot({ path: `${screenshots}/cancel-sent.png` });

    const report = await page.request.post(`${apiUrl}/api/acquisition/collect/report`, {
      headers: { 'x-agent-id': runtimeAgentId },
      data: { task_id: task.rows[0].id, video_id: `cancelled_${suffix}`, commenters: [],
        checkpoint: { last_video_id: null, processed_video_ids: [] }, terminal: true, partial_reason: 'user_cancelled' },
    });
    expect(report.ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByTestId('cancel-confirmed').first()).toHaveText('已取消');
    await page.screenshot({ path: `${screenshots}/cancel-confirmed.png` });
    await expect(page.getByText(/设备冷却中，还需等待/).first()).toBeVisible();
    await page.screenshot({ path: `${screenshots}/cancel-cooldown.png` });
  } finally {
    await db.query('DELETE FROM zenithjoy.publish_tasks WHERE agent_id=$1', [agent.rows[0].id]);
    await db.query('DELETE FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id=$1', [tenantId]);
    await db.query('DELETE FROM zenithjoy.license_machines WHERE license_id=$1', [license.rows[0].id]);
    await db.query('DELETE FROM zenithjoy.agents WHERE tenant_id=$1', [tenantId]);
    await db.query('DELETE FROM zenithjoy.licenses WHERE id=$1', [license.rows[0].id]);
    await db.query('DELETE FROM zenithjoy.tenant_members WHERE tenant_id=$1', [tenantId]);
    await db.query('DELETE FROM zenithjoy.tenants WHERE id=$1', [tenantId]);
    if (userId) await db.query('DELETE FROM "user" WHERE id=$1', [userId]);
    await db.end();
  }
});
