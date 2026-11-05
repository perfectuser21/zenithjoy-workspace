/** Browser + real API + disposable PostgreSQL: retained historical lead reads. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import pg from 'pg';

test('authenticated historical leads render and stay tenant scoped', async ({ page, browser }) => {
  const api = new URL(process.env.E2E_API_URL || 'http://localhost:5200');
  const dbHost = process.env.DATABASE_HOST;
  // This test creates accounts and rows: only run against an explicitly disposable local DB.
  if (process.env.E2E_DISPOSABLE_DB !== '1' || !['localhost', '127.0.0.1'].includes(dbHost || '') || api.hostname !== 'localhost' || process.env.DATABASE_NAME !== 'cecelia') {
    throw new Error('Requires explicit E2E_DISPOSABLE_DB=1 and the local disposable cecelia database/API');
  }
  const db = new pg.Client({ host: dbHost, port: Number(process.env.DATABASE_PORT || 5432), user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME });
  const other = await browser.newContext();
  await db.connect();
  try {
    const anonymous = await page.request.get(`${api.origin}/api/acquisition/leads`, { headers: { 'X-Tenant-Id': randomUUID() } });
    expect(anonymous.status()).toBe(401);
    async function signup(request: typeof page.request) {
      const response = await request.post(`${api.origin}/api/auth/sign-up/email`, { data: { email: `history-${randomUUID()}@example.test`, password: 'Local-test-password-123', name: 'History fixture' } });
      expect(response.status()).toBe(200);
      const user = (await response.json()).user;
      const membership = await db.query('SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id=$1', [user.id]);
      expect(membership.rowCount).toBe(1);
      return membership.rows[0].tenant_id as string;
    }
    const tenant = await signup(page.request);
    const otherTenant = await signup(other.request);
    const ownName = `历史线索-${randomUUID()}`;
    const otherName = `其他租户-${randomUUID()}`;
    await db.query('INSERT INTO zenithjoy.acquisition_leads(tenant_id,nickname,latest_reply,assignee) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)', [tenant, ownName, '历史回复', '客服A', otherTenant, otherName, '其他回复', '客服B']);
    const response = await page.request.get(`${api.origin}/api/acquisition/leads`, { headers: { 'X-Tenant-Id': otherTenant } });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(1);
    expect(body.leads).toHaveLength(1);
    expect(body.leads[0]).toMatchObject({ commenter_id: ownName, latest_reply: '历史回复', assignee: '客服A', latest_reply_at: null });
    expect(body.leads[0]).not.toHaveProperty('reply_text');
    expect(body.leads[0]).not.toHaveProperty('last_reply');
    expect(JSON.stringify(body)).not.toContain(otherName);

    const [browserResponse] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/acquisition/leads')),
      page.goto('/dashboard/leads'),
    ]);
    expect(browserResponse.status()).toBe(200);
    for (const title of ['最新回复', '负责人']) await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByText('触达状态', { exact: true })).toHaveCount(1);
    await expect(page.getByText(ownName, { exact: true })).toBeVisible();
    await expect(page.getByText(otherName, { exact: true })).toHaveCount(0);
    await page.goto('/area/acquisition/tasks');
    await expect(page.getByText('旧版获客已停用，可继续查看历史任务的视频和评论明细。')).toBeVisible();
  } finally {
    await other.close();
    await db.end();
  }
});
