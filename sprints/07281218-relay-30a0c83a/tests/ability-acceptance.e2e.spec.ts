/**
 * Ability Acceptance Playwright E2E 合同测试
 *
 * Sprint ID: 30a0c83a-47f4-4151-9636-a8cd2b6f1d7a
 * Sprint Dir: sprints/07281218-relay-30a0c83a
 * 合同对应: contract-draft.md Phase C（C1-C5）
 * 运行环境: windows_cloud（GitHub Actions windows-latest runner）
 *
 * 目标文件（实现时放到此路径）:
 *   apps/dashboard/e2e/ability-acceptance.spec.ts
 *
 * 场景覆盖：
 *   C1 — staff 登录后左侧导航出现「Ability 验收」入口
 *   C2 — 访问 /ability-acceptance，版本概览卡片可见
 *   C3 — 点击「新建验收 run」，验收项清单出现
 *   C4 — 选一条为 PASS → 点「提交验收」→ 出现「验收已提交」
 *   C5 — 访问历史页，已提交 run 列出且可展开明细
 *
 * 全部场景使用 page.route mock API，不依赖真实 DB。
 */
import { test, expect, Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';

// ── Mock 数据 ─────────────────────────────────────────────────────────────────
const MOCK_RUN_ID = 'aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb';

const MOCK_VERSIONS = {
  success: true,
  data: {
    staging: { version: '1.2.3-staging', source: 'env:STAGING_VERSION' },
    production: { version: '1.2.2', source: 'env:PRODUCTION_VERSION' },
    diff_count: 1,
    has_diff: true,
  },
};

const MOCK_TEMPLATES = {
  success: true,
  data: [
    { id: 'tpl-001', kind: 'FR', seq: 1, title: '用户可注册账号', description: '用户在 Android 客户端可完成注册流程' },
    { id: 'tpl-002', kind: 'NFR', seq: 2, title: '注册耗时 < 5s', description: '从点击注册到成功跳转首页耗时不超过 5 秒' },
  ],
};

const MOCK_CREATE_RUN = {
  success: true,
  data: { run_id: MOCK_RUN_ID, status: 'in_progress', created: true },
};

const MOCK_SUBMIT = {
  success: true,
  data: { run_id: MOCK_RUN_ID, status: 'submitted' },
};

const MOCK_RUNS_HISTORY = {
  success: true,
  data: [
    {
      run_id: MOCK_RUN_ID,
      status: 'submitted',
      app_id: 'customer_app',
      line_id: 'line02',
      surface: 'android',
      created_at: '2026-07-28T10:00:00Z',
      created_by: 'staff@test.com',
    },
  ],
};

const MOCK_RUN_DETAIL = {
  success: true,
  data: {
    run_id: MOCK_RUN_ID,
    status: 'submitted',
    devices: [
      {
        device_index: 1,
        checks: [
          { template_id: 'tpl-001', result: 'PASS', checked_by: 'staff@test.com' },
        ],
      },
    ],
  },
};

// ── Mock API 辅助 ─────────────────────────────────────────────────────────────
async function stubAbilityAcceptanceApi(page: Page) {
  await page.route('**/api/staff/ability-acceptance/versions', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_VERSIONS) });
  });

  await page.route('**/api/staff/ability-acceptance/templates**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TEMPLATES) });
  });

  await page.route('**/api/staff/ability-acceptance/runs', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CREATE_RUN) });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_RUNS_HISTORY) });
    }
  });

  await page.route(`**/api/staff/ability-acceptance/runs/${MOCK_RUN_ID}/submit`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SUBMIT) });
  });

  await page.route(`**/api/staff/ability-acceptance/runs/${MOCK_RUN_ID}/devices/**/checks`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { updated: true } }),
    });
  });

  await page.route(`**/api/staff/ability-acceptance/runs/${MOCK_RUN_ID}`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_RUN_DETAIL) });
  });
}

// ── 测试场景 ──────────────────────────────────────────────────────────────────

test.describe('Ability Acceptance E2E — Phase C 合同测试', () => {
  test.beforeEach(async ({ page }) => {
    await stubAbilityAcceptanceApi(page);
  });

  /**
   * C1: staff 登录后左侧导航出现「Ability 验收」入口
   * 合同断言: page.locator('text=Ability 验收') visible
   */
  test('C1: 导航出现「Ability 验收」入口', async ({ page }) => {
    await page.goto(`${BASE}/?VITE_SKIP_AUTH=true`);
    await expect(page.locator('text=Ability 验收')).toBeVisible({ timeout: 10_000 });
  });

  /**
   * C2: 访问 /ability-acceptance，版本概览卡片可见
   * 合同断言: data-testid="version-staging" + data-testid="version-production" visible
   */
  test('C2: 版本概览卡片展示 staging / production 版本', async ({ page }) => {
    await page.goto(`${BASE}/ability-acceptance?VITE_SKIP_AUTH=true`);
    await expect(page.locator('[data-testid="version-staging"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="version-production"]')).toBeVisible({ timeout: 10_000 });
    // 截图留证
    await page.screenshot({ path: 'playwright-report/c2-version-overview.png' });
  });

  /**
   * C3: 点击「新建验收 run」，验收项清单出现
   * 合同断言: data-testid="acceptance-checklist" visible
   */
  test('C3: 点击新建验收 run 后验收项清单出现', async ({ page }) => {
    await page.goto(`${BASE}/ability-acceptance?VITE_SKIP_AUTH=true`);
    await page.locator('button:has-text("新建验收 run"), button:has-text("新建验收run")').click();
    await expect(page.locator('[data-testid="acceptance-checklist"]')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'playwright-report/c3-checklist.png' });
  });

  /**
   * C4: 选一条为 PASS → 点「提交验收」→ 出现「验收已提交」
   * 合同断言: text=验收已提交 visible
   */
  test('C4: 录入 PASS → 提交验收 → 出现「验收已提交」', async ({ page }) => {
    await page.goto(`${BASE}/ability-acceptance?VITE_SKIP_AUTH=true`);
    await page.locator('button:has-text("新建验收 run"), button:has-text("新建验收run")').click();
    await expect(page.locator('[data-testid="acceptance-checklist"]')).toBeVisible({ timeout: 10_000 });

    // 选第一条验收项为 PASS
    const firstPass = page.locator('[data-testid^="check-result-"] [value="PASS"], [data-testid^="check-pass-"]').first();
    await firstPass.click();

    // 点提交
    await page.locator('button:has-text("提交验收")').click();

    // 断言提交成功文字出现
    await expect(page.locator('text=验收已提交')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'playwright-report/c4-submitted.png' });
  });

  /**
   * C5: 访问历史页，已提交 run 列出且可展开明细
   * 合同断言: run 行 visible，点击后 data-testid="run-detail" visible
   */
  test('C5: 历史页列出已提交 run，点击可展开明细', async ({ page }) => {
    await page.goto(`${BASE}/ability-acceptance/history?VITE_SKIP_AUTH=true`);
    // 历史 run 列表行可见
    const runRow = page.locator(`[data-run-id="${MOCK_RUN_ID}"], tr:has-text("${MOCK_RUN_ID.slice(0, 8)}")`).first();
    await expect(runRow).toBeVisible({ timeout: 10_000 });
    // 点击展开明细
    await runRow.click();
    await expect(page.locator('[data-testid="run-detail"]')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'playwright-report/c5-history-detail.png' });
  });
});
