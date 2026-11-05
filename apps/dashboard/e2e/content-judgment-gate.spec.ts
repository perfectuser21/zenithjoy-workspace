/**
 * content-judgment-gate.spec.ts — Playwright E2E
 * commit-1 Red: 在 UI 实现（commit-6）之前会 FAIL
 *
 * 验收条件：
 *   1. AcquisitionConfigPage 渲染 target_profile_desc textarea
 *   2. LeadsPage 渲染 outreach_eligible 状态列（显示「可触达」/「不触达」）
 */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

test.describe('content-judgment-gate UI', () => {
  /**
   * AcquisitionConfigPage 应渲染 target_profile_desc textarea
   * 让用户填写目标客户画像描述（供 Gemini 判断视频内容是否匹配）
   */
  test('AcquisitionConfigPage renders target_profile_desc textarea', async ({ page }) => {
    await page.goto('/dashboard/acquisition-config');

    // 等待页面加载完成
    await page.waitForLoadState('networkidle');

    // 查找 target_profile_desc textarea
    // 可能以 label 文本「目标客户画像」或 aria-label / placeholder 形式出现
    const profileDescArea = page.locator(
      'textarea[name="target_profile_desc"], ' +
      'textarea[aria-label*="目标客户画像"], ' +
      'textarea[placeholder*="目标客户"], ' +
      '[data-testid="target-profile-desc"]'
    );

    await expect(profileDescArea).toBeVisible({
      timeout: 10_000,
    });

    // 验证可以输入内容
    await profileDescArea.fill('中小企业主，关注降本增效，有数字化转型需求');
    const value = await profileDescArea.inputValue();
    expect(value).toContain('中小企业主');
  });

  /**
   * LeadsPage 应渲染 outreach_eligible 状态列
   * 显示「可触达」（outreach_eligible=true）或「不触达」（outreach_eligible=false）
   */
  test('LeadsListPage renders outreach_eligible status column showing 「可触达」/「不触达」', async ({ page }) => {
    const dbUrl = new URL(process.env.DATABASE_URL ?? '');
    const api = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000');
    const base = new URL(process.env.BASE_URL ?? 'http://localhost:5174');
    if (process.env.E2E_ORPHAN_DISPOSABLE_DB !== '1' || !['localhost', '127.0.0.1'].includes(dbUrl.hostname) || !['/zenithjoy_test', '/cecelia'].includes(dbUrl.pathname) || api.hostname !== 'localhost' || base.hostname !== 'localhost') {
      throw new Error('Requires explicitly disposable local PostgreSQL and localhost services');
    }
    const db = new Pool({ connectionString: process.env.DATABASE_URL });
    let userId: string | undefined;
    let tenantId: string | undefined;
    try {
      expect((await page.request.get(`${api.origin}/api/acquisition/leads`)).status()).toBe(401);
      const signup = await page.request.post(`${api.origin}/api/auth/sign-up/email`, { data: {
        email: `judgment-${randomUUID()}@example.test`, password: 'Local-test-password-123', name: 'Judgment E2E',
      } });
      expect(signup.status()).toBe(200);
      userId = (await signup.json()).user.id;
      const membership = await db.query('SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id=$1', [userId]);
      expect(membership.rowCount).toBe(1);
      tenantId = membership.rows[0].tenant_id;
      await db.query('INSERT INTO zenithjoy.acquisition_leads(tenant_id,nickname,outreach_eligible) VALUES ($1,$2,true),($1,$3,false)', [tenantId, `eligible-${randomUUID()}`, `ineligible-${randomUUID()}`]);
      const [response] = await Promise.all([
        page.waitForResponse(r => r.url().includes('/api/acquisition/leads')),
        page.goto('/dashboard/leads'),
      ]);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.total).toBe(2);
      expect(body.leads.map((lead: { outreach_eligible: boolean }) => lead.outreach_eligible).sort()).toEqual([false, true]);
      // The last column is horizontally virtualized at normal viewport widths.
      await page.locator('.ag-body-horizontal-scroll-viewport').evaluate((element) => { element.scrollLeft = element.scrollWidth; });
      await expect(page.getByRole('columnheader', { name: /触达状态/ })).toBeVisible();
      await expect(page.getByText('可触达', { exact: true })).toBeVisible();
      await expect(page.getByText('不触达', { exact: true })).toBeVisible();
    } finally {
      if (tenantId) {
        await db.query('DELETE FROM zenithjoy.licenses WHERE tenant_id=$1', [tenantId]);
        await db.query('DELETE FROM zenithjoy.tenants WHERE id=$1', [tenantId]);
      }
      if (userId) await db.query('DELETE FROM "user" WHERE id=$1', [userId]);
      await db.end();
    }
  });
});
