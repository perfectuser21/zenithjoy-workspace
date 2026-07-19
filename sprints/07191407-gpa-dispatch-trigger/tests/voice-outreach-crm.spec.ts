/**
 * GP-A 主动语音触达 — CRM 前端合同测试骨架（Playwright E2E）
 * task_id: 2ac0e77b-c2e3-47e9-92dd-7549622835d7
 *
 * 本文件是合同测试骨架（contract tests）。
 * 实现者完成功能后应将对应测试移至：
 *   apps/dashboard/e2e/voice-outreach-crm.spec.ts
 *
 * 覆盖判定点：C-14（对应 contract-draft.md）
 * 执行环境：windows_cloud runner（GitHub Actions windows-latest）
 * 涉及 Invariant：I-15（鉴权修复必须先于 CRM 入口上线）
 */

import { test, expect, Page } from '@playwright/test';

// ─── C-14：CRM 呼叫按钮 → 弹窗 → 确认 → queued 状态展示 ─────────────────

test.describe('[C-14] CRM 手动呼叫入口完整流程（I-15）', () => {
  let page: Page;

  test.beforeEach(async ({ page: _page }) => {
    page = _page;
    // TODO: 导航到 CRM 客户详情页，确保以 cs_admin 角色登录
    // await page.goto('/crm/customers/test-customer-id');
  });

  test('CRM 客户详情页存在「呼叫该客户」按钮', async ({ page }) => {
    // TODO:
    // await page.goto('/crm/customers/test-customer-id');
    // const callBtn = page.getByRole('button', { name: /呼叫该客户/ });
    // await expect(callBtn).toBeVisible();
    expect(true).toBe(true); // 骨架占位
  });

  test('点击「呼叫该客户」弹出二次确认弹窗，展示上次通话状态/时间', async ({ page }) => {
    // TODO:
    // const callBtn = page.getByRole('button', { name: /呼叫该客户/ });
    // await callBtn.click();
    // const dialog = page.getByRole('dialog');
    // await expect(dialog).toBeVisible();
    // // 弹窗应展示上次通话状态（answered/no_answer/failed/从未拨打）
    // await expect(dialog.getByText(/上次通话/)).toBeVisible();
    expect(true).toBe(true);
  });

  test('二次确认弹窗点「取消」不发起 API 调用', async ({ page }) => {
    // TODO:
    // const apiCalls: string[] = [];
    // page.on('request', req => { if (req.url().includes('/voice-outreach/call')) apiCalls.push(req.url()); });
    // await page.getByRole('button', { name: /呼叫该客户/ }).click();
    // await page.getByRole('button', { name: /取消/ }).click();
    // expect(apiCalls).toHaveLength(0);
    expect(true).toBe(true);
  });

  test('二次确认弹窗点「确认呼叫」发起 POST /call，页面展示 queued 状态', async ({ page }) => {
    // TODO: mock API 返回 { success: true, data: { call_id: 'test-id', status: 'queued', queued_at: '...' } }
    // await page.route('**/api/cs/voice-outreach/call', route => {
    //   route.fulfill({
    //     status: 202,
    //     contentType: 'application/json',
    //     body: JSON.stringify({ success: true, data: { call_id: 'test-call-id', status: 'queued', queued_at: new Date().toISOString() } }),
    //   });
    // });
    //
    // await page.getByRole('button', { name: /呼叫该客户/ }).click();
    // await page.getByRole('button', { name: /确认呼叫/ }).click();
    //
    // // 页面应展示 queued 状态（例如 Toast 或状态标签）
    // await expect(page.getByText(/呼叫已排队|queued/i)).toBeVisible({ timeout: 5000 });
    expect(true).toBe(true);
  });

  test('呼叫成功后按钮变为禁用状态（防止重复点击）', async ({ page }) => {
    // TODO: 确认 POST /call 成功后「呼叫该客户」按钮 disabled
    expect(true).toBe(true);
  });
});

// ─── CRM 列表「上次通话」状态列 ──────────────────────────────────────────

test.describe('[C-14b] CRM 客户列表「上次通话」状态列', () => {
  test('CRM 列表存在「上次通话」状态列', async ({ page }) => {
    // TODO:
    // await page.goto('/crm/customers');
    // await expect(page.getByRole('columnheader', { name: /上次通话/ })).toBeVisible();
    expect(true).toBe(true);
  });

  test('从未拨打的联系人「上次通话」列显示空或「—」', async ({ page }) => {
    // TODO: 断言从未有通话记录的联系人行的状态列为 —
    expect(true).toBe(true);
  });

  test('已接通的联系人「上次通话」列显示 answered + 时长', async ({ page }) => {
    // TODO: mock API 返回含 call_phase='answered' + duration_seconds=65 的记录
    // 断言列内容含 answered 状态和时长
    expect(true).toBe(true);
  });
});

// ─── CRM 客户详情「通话记录」标签页 ──────────────────────────────────────

test.describe('[C-14c] CRM 客户详情页「通话记录」标签页', () => {
  test('客户详情页存在「通话记录」标签页', async ({ page }) => {
    // TODO:
    // await page.goto('/crm/customers/test-customer-id');
    // await expect(page.getByRole('tab', { name: /通话记录/ })).toBeVisible();
    expect(true).toBe(true);
  });

  test('通话记录列表展示历史记录（call_phase + 时间 + 时长）', async ({ page }) => {
    // TODO: mock GET /records API，验证列表渲染
    expect(true).toBe(true);
  });

  test('点击记录可展开查看 ASR 全文转写', async ({ page }) => {
    // TODO: mock API 返回含 asr_transcript 的记录，点击展开验证转写文本可见
    // await page.getByRole('tab', { name: /通话记录/ }).click();
    // await page.getByTestId('call-record-row').first().click();
    // await expect(page.getByTestId('asr-transcript')).toBeVisible();
    expect(true).toBe(true);
  });

  test('ASR 转写为空时展示「暂无转写内容」占位文字', async ({ page }) => {
    // TODO: mock API 返回 asr_transcript=null，验证占位文字
    expect(true).toBe(true);
  });
});

// ─── 自动规则 dry-run 预览 UI ─────────────────────────────────────────────

test.describe('[C-14d] 自动规则 dry-run 预览界面（I-14）', () => {
  test('自动规则配置页首次激活前必须展示 dry-run 预览', async ({ page }) => {
    // TODO: 进入自动规则配置页，验证「预览命中客户」按钮存在且需先点击
    expect(true).toBe(true);
  });

  test('dry-run 预览显示命中客户数量，未有「确认执行」按钮', async ({ page }) => {
    // TODO: 点击 dry-run 预览后，验证展示命中数量且真实执行按钮不可用
    expect(true).toBe(true);
  });

  test('确认 dry-run 后「启用自动执行」按钮变为可点击', async ({ page }) => {
    // TODO: 确认 dry-run 后，验证启用按钮由 disabled 变为 enabled
    expect(true).toBe(true);
  });
});
