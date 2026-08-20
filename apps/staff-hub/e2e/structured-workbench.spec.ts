/**
 * structured-workbench.spec.ts —— 路③ Golden Path 真浏览器全链（windows_cloud 变体C）
 *
 * 走完 PRD 的第一条路径：空工作台看到模板 → 建表带 8 类字段 + 选可见性 →
 * 表出现在列表且字段数 8 → 二次确认删表（名字没输对时删不了）→ 回收站还原 → 字段逐字回归。
 *
 * 变体C 死规则：**禁请求拦截/改写** —— 全部请求打真实 apps/api + 真 Postgres。
 * （守卫会机械 grep 本文件里有没有那个拦截 API 的名字，所以这里连提都不提它。）
 * 认证走真会话 cookie（由 e2e-verify.ps1 先调 /api/staff/feishu-login 拿到再注入），
 * 一个身份头都不拼——路③ 的服务端闸压根不读请求头，拼了也没用。
 *
 * 五张截图对应 DoD 的 BEHAVIOR:E2E 条目，逐张有明确期望，不是"跑完顺手截一张"。
 */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5175';
const SESSION_COOKIE = process.env.E2E_WORKBENCH_COOKIE || '';
const SHOT_DIR = resolve(
  process.cwd(),
  '..',
  '..',
  'sprints/08201151-员工知识中枢-路-结构化工作台-c86e37ff/screenshots'
);

const shot = (name: string) => resolve(SHOT_DIR, name);

test.describe('路③ 结构化工作台 Golden Path', () => {
  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ context }) => {
    expect(
      SESSION_COOKIE,
      'E2E_WORKBENCH_COOKIE 未注入：没有真会话，这条 E2E 只会拿到一片 401'
    ).not.toBe('');
    const url = new URL(BASE_URL);
    for (const pair of SESSION_COOKIE.split(';')) {
      const [name, ...rest] = pair.trim().split('=');
      if (!name || rest.length === 0) continue;
      await context.addCookies([
        { name, value: rest.join('='), domain: url.hostname, path: '/' },
      ]);
    }
  });

  test('建表 → 8 类字段 → 可见性 → 删表二次确认 → 回收站还原逐字回归', async ({ page }) => {
    await page.goto(`${BASE_URL}/workbench`);
    await expect(page.getByTestId('workbench-page')).toBeVisible({ timeout: 20_000 });

    // 01 空工作台：≥2 张开箱模板卡片
    const templates = page.getByTestId('template-list').locator('.template-card');
    await expect(templates).not.toHaveCount(0, { timeout: 15_000 });
    expect(await templates.count()).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: shot('01-empty-workbench.png'), fullPage: true });

    // 02 建表表单：8 类字段各一 + 可见性选择器
    const tableName = `E2E工作台-${Date.now()}`;
    await page.getByTestId('new-table-btn').click();
    await expect(page.getByTestId('create-table-form')).toBeVisible();
    await page.getByTestId('table-name-input').fill(tableName);
    await page.getByTestId('visibility-select').selectOption('org');
    const fieldRows = page.getByTestId('field-editor').locator('.field-row');
    await expect(fieldRows).toHaveCount(8);
    await page.screenshot({ path: shot('02-create-table.png'), fullPage: true });
    await page.getByTestId('submit-table-btn').click();

    // 03 新表出现在本组织列表，字段数 = 8
    const row = page.getByTestId('table-list').locator('tr', { hasText: tableName });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.locator('td').nth(2)).toHaveText('8');
    await row.getByRole('button', { name: tableName }).click();
    const detailFields = page.getByTestId('table-detail').locator('li');
    await expect(detailFields).toHaveCount(8);
    const fieldsBefore = await detailFields.allInnerTexts();
    await page.screenshot({ path: shot('03-table-in-list.png'), fullPage: true });

    // 04 删表二次确认：名字没输对时删除按钮禁用
    await row.getByRole('button', { name: '删除' }).click();
    const modal = page.getByTestId('delete-confirm-modal');
    await expect(modal).toBeVisible();
    await page.getByTestId('confirm-name-input').fill(`${tableName}-打错了`);
    await expect(page.getByTestId('confirm-delete-btn')).toBeDisabled();
    await page.screenshot({ path: shot('04-delete-confirm.png'), fullPage: true });

    await page.getByTestId('confirm-name-input').fill(tableName);
    await expect(page.getByTestId('confirm-delete-btn')).toBeEnabled();
    await page.getByTestId('confirm-delete-btn').click();
    await expect(page.getByTestId('table-list').locator('tr', { hasText: tableName })).toHaveCount(0, {
      timeout: 15_000,
    });

    // 05 回收站还原：表回到列表，字段定义逐字回归
    const trashRow = page.getByTestId('trash-list').locator('li', { hasText: tableName });
    await expect(trashRow).toBeVisible({ timeout: 15_000 });
    await trashRow.getByRole('button', { name: '还原' }).click();
    const back = page.getByTestId('table-list').locator('tr', { hasText: tableName });
    await expect(back).toBeVisible({ timeout: 15_000 });
    await back.getByRole('button', { name: tableName }).click();
    const fieldsAfter = await page.getByTestId('table-detail').locator('li').allInnerTexts();
    expect(fieldsAfter).toEqual(fieldsBefore);
    await page.screenshot({ path: shot('05-trash-restored.png'), fullPage: true });
  });
});
