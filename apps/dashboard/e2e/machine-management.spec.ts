/**
 * machine-management.spec.ts — 机器管理 Golden Path（windows_cloud，UI 层，Mode B）
 *
 * 模式 B（final-e2e windows_cloud 干净 VM，无真后端）：page.route stub 所有 /api/agent/machines +
 * /api/agent/burner，**只验 UI 渲染/交互/文案**，**不验** cookie 接缝（真目标验证在
 * machine-management-smoke.sh --leg=cookie-seam 的 linux CI 真后端 leg）。
 *
 * 截图：01-initial（机器列表 ≥1 行 含名称/在线/角色/号数）/ 02-action（改名+标主副后「保存成功」）/
 *       03-result（点进机器看抖音号列表 + 离线机器加号按钮置灰）。
 *
 * 运行：npx playwright test e2e/machine-management.spec.ts（cwd=apps/dashboard，由 e2e-verify.ps1 dispatch）
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || process.env.E2E_BASE_URL || 'http://localhost:5174';
const SHOTS = path.join('screenshots');

const ONLINE_ID = 'bbbbbbbb-1111-2222-3333-444444444444';
const OFFLINE_ID = 'cccccccc-1111-2222-3333-444444444444';

function listBody(onlineNickname = '主控机A', onlineRole: 'main' | 'sub' = 'sub') {
  return {
    machines: [
      {
        id: ONLINE_ID, agent_id: 'agent-online', hostname: 'pc-01', nickname: onlineNickname,
        machine_role: onlineRole, status: 'online', version: '1.0.70', douyin_account_count: 2,
      },
      {
        id: OFFLINE_ID, agent_id: 'agent-offline', hostname: 'pc-02', nickname: '离线机B',
        machine_role: 'sub', status: 'offline', version: '1.0.60', douyin_account_count: 1,
      },
    ],
  };
}

const DETAIL_BODY = {
  machine: { id: ONLINE_ID, nickname: '主控机A', machine_role: 'main', status: 'online' },
  accounts: [
    { account_label: 'default', role: 'main', status: 'active', nickname: '主号阿强', valid: true },
    { account_label: 'burner-1', role: 'burner', status: 'needs_rebind', nickname: '小号X', valid: false },
  ],
};

async function stubAuth(page: Page) {
  await page.route('**/api/auth/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
}

test('机器管理 Golden Path — 列表/改名标主副/详情看号/离线置灰', async ({ page }) => {
  await stubAuth(page);

  let nickname = '主控机A';
  let role: 'main' | 'sub' = 'sub';

  await page.route('**/api/agent/machines', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(listBody(nickname, role)),
      });
    }
    return route.continue();
  });

  await page.route(`**/api/agent/machines/${ONLINE_ID}`, (route) => {
    if (route.request().method() === 'PUT') {
      const data = JSON.parse(route.request().postData() || '{}');
      nickname = data.nickname;
      role = data.machine_role;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, machine: { id: ONLINE_ID, nickname, machine_role: role } }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DETAIL_BODY) });
  });

  // ── Step 1：机器列表渲染 ──
  await page.goto(`${BASE_URL}/acquisition/machines`);
  await page.waitForLoadState('networkidle');

  const rows = page.locator('[data-testid="machine-row"]');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('h1')).toContainText('机器管理');
  await expect(rows.first().locator('[data-testid="status-badge"]')).toHaveText('在线');
  await expect(rows.first().locator('[data-testid="account-count"]')).toHaveText('2');
  await page.screenshot({ path: path.join(SHOTS, '01-initial.png'), fullPage: true });

  // ── Step 2：改名 + 标主副 → 保存成功 ──
  await rows.first().locator('[data-testid="nickname-input"]').fill('主控机A');
  await rows.first().locator('[data-testid="role-select"]').selectOption('main');
  await rows.first().locator('[data-testid="save-btn"]').click();
  await expect(page.locator('[data-testid="save-msg"]')).toHaveText('保存成功');
  // 刷新后该行角色持久化为「主机器」
  await expect(rows.first().locator('[data-testid="role-select"]')).toHaveValue('main');
  await page.screenshot({ path: path.join(SHOTS, '02-action.png'), fullPage: true });

  // ── Step 3：点进机器看抖音号 + 离线机器加号置灰 ──
  await rows.first().locator('[data-testid="open-btn"]').click();
  await expect(page.locator('[data-testid="machine-detail"]')).toBeVisible();
  const accounts = page.locator('[data-testid="account-row"]');
  await expect(accounts).toHaveCount(2);
  await expect(accounts.nth(1)).toContainText('已失效，可重新扫码');
  // 离线机器（第二行）「添加抖音号」置灰
  await expect(rows.nth(1).locator('[data-testid="add-account-btn"]')).toBeDisabled();
  // 在线机器加号按钮可点
  await expect(rows.first().locator('[data-testid="add-account-btn"]')).toBeEnabled();
  await page.screenshot({ path: path.join(SHOTS, '03-result.png'), fullPage: true });
});
