/**
 * E2E spec — Line02 Dashboard IA 重做
 *
 * 验收 Golden Path：
 *   Step 1: Hub 页 4 张 GP 顺序卡片，无"即将上线"，无旧标签
 *   Step 2: 账号管理页无"抖音昵称"列头，machine-hostname-cell 保留
 *   Step 3/4: 采集/看线索卡片导航到正确路由（不 404）
 *   Step 5: 触达记录页渲染（URL 含 /outreach），显示列表或空状态提示
 *   Step 6: 设置入口存在；AcquisitionConfigPage 无"指派计划"区块
 *
 * target_environment: windows_cloud
 * 禁止 page.route() — 所有 API 请求打真实后端（VITE_API_BASE_URL=E2E_API_URL）
 * VITE_SKIP_AUTH=true 跳过前端路由鉴权（测试 UI 结构，不测数据）
 *
 * 运行:
 *   VITE_SKIP_AUTH=true npx vite build && npx vite preview --port 5174
 *   E2E_BASE_URL=http://localhost:5174 npx playwright test e2e/acquisition-ia-redesign.spec.ts
 */
import { test, expect } from '@playwright/test';

const HUB_PATH = '/area/acquisition';

test.describe('Line02 Dashboard IA 重做 — Hub + 路由导航', () => {
  test('Hub 页显示 4 张 GP 顺序卡片，无"即将上线"标签', async ({ page }) => {
    await page.goto(HUB_PATH);
    await page.waitForLoadState('networkidle');

    await page.screenshot({ path: 'screenshots/01-hub-page.png' });

    // 4 张 GP 卡片可见（按顺序）
    await expect(page.locator('text=绑抖音小号').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=采集').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=看线索').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=触达记录').first()).toBeVisible({ timeout: 5000 });

    // 无"即将上线"文字（当前版本含此标签 → FAIL 是预期）
    await expect(page.locator('text=即将上线')).toHaveCount(0);

    // 无旧卡片标签
    await expect(page.locator('text=客户分析')).toHaveCount(0);
    await expect(page.locator('text=触达中心')).toHaveCount(0);
  });

  test('账号管理页无"抖音昵称"列头，保留"绑定机器"列', async ({ page }) => {
    await page.goto('/area/acquisition/accounts');
    await page.waitForLoadState('networkidle');

    await page.screenshot({ path: 'screenshots/02-accounts-page.png' });

    // "抖音昵称"列头不存在（当前版本含此列头 → FAIL 是预期）
    const nicknameHeader = page.locator('th', { hasText: '抖音昵称' });
    await expect(nicknameHeader).toHaveCount(0);

    // "绑定机器"列头保留（已验收回归约束）
    await expect(page.locator('th', { hasText: '绑定机器' }).first()).toBeVisible({ timeout: 10000 });
  });

  test('点「看线索」卡片 — 导航到 /area/acquisition/leads（不 404）', async ({ page }) => {
    await page.goto(HUB_PATH);
    await page.waitForLoadState('networkidle');

    // 点「看线索」卡片
    const leadsCard = page.locator('text=看线索').first();
    await leadsCard.click();
    await page.waitForLoadState('networkidle');

    await page.screenshot({ path: 'screenshots/03-leads-page.png' });

    // URL 含 /leads（当前路由未注册 → 404 → FAIL 是预期）
    await expect(page).toHaveURL(/\/leads/, { timeout: 8000 });

    // 页面有内容（非 404 错误页）
    await expect(page.locator('body')).not.toContainText('404');
  });

  test('点「触达记录」卡片 — 导航到 /area/acquisition/outreach，显示列表或空状态', async ({ page }) => {
    await page.goto(HUB_PATH);
    await page.waitForLoadState('networkidle');

    // 点「触达记录」卡片
    const outreachCard = page.locator('text=触达记录').first();
    await outreachCard.click();
    await page.waitForLoadState('networkidle');

    await page.screenshot({ path: 'screenshots/04-outreach-page.png' });

    // URL 含 /outreach（当前路由未注册 → FAIL 是预期）
    await expect(page).toHaveURL(/\/outreach/, { timeout: 8000 });

    // 显示触达历史列表或空状态提示（不是 500/404 错误页）
    const hasContent = await page.locator('text=暂无触达记录').count()
      + await page.locator('table').count()
      + await page.locator('text=Lead 昵称').count();
    expect(hasContent).toBeGreaterThan(0);
  });

  test('设置入口存在，ConfigPage 无"指派计划"区块', async ({ page }) => {
    await page.goto(HUB_PATH);
    await page.waitForLoadState('networkidle');

    // 找设置入口（含"设置"文字的 link）
    const settingsLink = page.locator('a', { hasText: '设置' }).first();
    await expect(settingsLink).toBeVisible({ timeout: 8000 });

    // 点击进入设置页
    await settingsLink.click();
    await page.waitForLoadState('networkidle');

    await page.screenshot({ path: 'screenshots/05-config-page.png' });

    // 设置页不含"指派计划"文字（当前版本含此文字 → FAIL 是预期）
    await expect(page.locator('text=指派计划')).toHaveCount(0);
  });
});
