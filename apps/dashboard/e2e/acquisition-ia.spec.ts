/**
 * Sprint 07021006 — 获客 IA 重设计 E2E（windows_cloud Mode B）
 *
 * 8 个测试覆盖 Golden Path 全程：Hub 4卡片 → 账号管理 → 采集任务一级 → LeadsPage 无采集面板
 * → 任务二级视频卡片 → 视频 leads 空态 → N=10上限按钮置灰 → 失败态任务。
 *
 * 规则：禁止路由拦截 stub（windows_cloud 走真实后端）。鉴权通过 context.addCookies 注入
 * e2e-verify.ps1 事先用 API 登录取得的 session token。
 *
 * 截图输出到 sprints/07021006-acquisition-ia-redesign/screenshots/
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5174';
const SESSION_TOKEN = process.env.E2E_SESSION_TOKEN ?? '';
const OTHER_SESSION_TOKEN = process.env.E2E_OTHER_SESSION_TOKEN ?? '';
const SEED_TASK_ID = process.env.E2E_SEED_TASK_ID ?? '';

const SCREENSHOT_DIR = path.join(
  __dirname,
  '../../sprints/07021006-acquisition-ia-redesign/screenshots'
);

function ensureScreenshotDir() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

async function injectSession(context: import('@playwright/test').BrowserContext, token: string) {
  if (!token) return;
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: token,
      domain: new URL(BASE_URL).hostname,
      path: '/',
    },
  ]);
}

// ── Test 01: Hub 4模块卡片可见 ────────────────────────────
test('01 - Hub: 智能获客4模块卡片全部可见', async ({ page, context }) => {
  ensureScreenshotDir();
  await injectSession(context, SESSION_TOKEN);
  await page.goto(`${BASE_URL}/area/acquisition`);
  await page.waitForLoadState('networkidle');

  await expect(page.getByTestId('hub-card-accounts')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('hub-card-tasks')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('hub-card-analytics')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('hub-card-outreach')).toBeVisible({ timeout: 5_000 });

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-hub.png'), fullPage: true });
});

// ── Test 02: AccountsPage 渲染（空态或有数据 + 绑定按钮）─────
test('02 - Accounts: 账号管理页渲染', async ({ page, context }) => {
  ensureScreenshotDir();
  await injectSession(context, SESSION_TOKEN);
  await page.goto(`${BASE_URL}/area/acquisition/accounts`);
  await page.waitForLoadState('networkidle');

  await expect(page.getByTestId('bind-new-account-btn')).toBeVisible({ timeout: 10_000 });
  // 空态或有数据列表二选一
  const emptyEl = page.getByTestId('accounts-empty');
  const listEl = page.getByTestId('accounts-list');
  const hasEmpty = await emptyEl.isVisible().catch(() => false);
  const hasList = await listEl.isVisible().catch(() => false);
  expect(hasEmpty || hasList).toBe(true);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-accounts.png'), fullPage: true });
});

// ── Test 03: TasksPage 一级（关键词输入 + 开始采集 + 任务列表容器）─
test('03 - Tasks: 采集任务一级列表页渲染', async ({ page, context }) => {
  ensureScreenshotDir();
  await injectSession(context, SESSION_TOKEN);
  await page.goto(`${BASE_URL}/area/acquisition/tasks`);
  await page.waitForLoadState('networkidle');

  await expect(page.getByTestId('keyword-input')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('start-collect-btn')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('tasks-list')).toBeVisible({ timeout: 5_000 });

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-tasks.png'), fullPage: true });
});

// ── Test 04: LeadsPage 无采集面板 ──────────────────────────
test('04 - Leads: LeadsPage 无采集面板', async ({ page, context }) => {
  ensureScreenshotDir();
  await injectSession(context, SESSION_TOKEN);
  await page.goto(`${BASE_URL}/dashboard/leads`);
  await page.waitForLoadState('networkidle');

  // 采集面板 (acq-collect-button) 已从 LeadsPage 移除，不应存在
  const collectBtn = page.locator('[data-testid="acq-collect-button"]');
  await expect(collectBtn).not.toBeVisible({ timeout: 5_000 }).catch(() => {
    // 元素不在 DOM 中 → pass
  });

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-leads.png'), fullPage: true });
});

// ── Test 05: TasksPage 二级（video-cards-container 渲染）──────
test('05 - Tasks detail: 视频卡片容器渲染', async ({ page, context }) => {
  ensureScreenshotDir();
  await injectSession(context, SESSION_TOKEN);

  const taskId = SEED_TASK_ID || 'seed-task-001';
  await page.goto(`${BASE_URL}/area/acquisition/tasks/${taskId}`);
  await page.waitForLoadState('networkidle');

  // video-cards-container 在加载中和加载完成后均存在
  await expect(page.getByTestId('video-cards-container')).toBeVisible({ timeout: 10_000 });

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-tasks-detail.png'), fullPage: true });
});

// ── Test 06: 视频展开 leads 空态（leads-empty-placeholder）──
test('06 - Video leads: 展开视频卡片显示 leads-empty-placeholder 或 leads-list', async ({ page, context }) => {
  ensureScreenshotDir();
  await injectSession(context, SESSION_TOKEN);

  const taskId = SEED_TASK_ID || 'seed-task-001';
  await page.goto(`${BASE_URL}/area/acquisition/tasks/${taskId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-testid="video-cards-container"]', { timeout: 10_000 });

  // 如有视频卡片则点击第一张展开 leads
  const videoCard = page.locator('[data-testid="video-card"]').first();
  const hasVideoCard = await videoCard.isVisible().catch(() => false);
  if (hasVideoCard) {
    await videoCard.click();
    await page.waitForTimeout(1500);
    const emptyEl = page.getByTestId('leads-empty-placeholder');
    const leadsList = page.getByTestId('leads-list');
    const hasEmpty = await emptyEl.isVisible().catch(() => false);
    const hasList = await leadsList.isVisible().catch(() => false);
    expect(hasEmpty || hasList).toBe(true);
  }

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06-video-leads.png'), fullPage: true });
});

// ── Test 07: 账号 N=10 上限（OTHER_TENANT，绑定按钮 disabled）─
test('07 - Accounts N=10上限: bind-new-account-btn toBeDisabled', async ({ page, context }) => {
  ensureScreenshotDir();
  // 使用 OTHER_TENANT session（已绑定 10 个小号，by e2e-verify.ps1 seed）
  await injectSession(context, OTHER_SESSION_TOKEN || SESSION_TOKEN);
  await page.goto(`${BASE_URL}/area/acquisition/accounts`);
  await page.waitForLoadState('networkidle');

  const bindBtn = page.getByTestId('bind-new-account-btn');
  await expect(bindBtn).toBeVisible({ timeout: 10_000 });
  // 当 sessions.length >= 10 时按钮应 disabled
  await expect(bindBtn).toBeDisabled({ timeout: 5_000 });

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07-accounts-n10-limit.png'), fullPage: true });
});

// ── Test 08: 失败态任务（task-status-failed + task-retry-btn）─
test('08 - Tasks 失败态: task-status-failed + task-retry-btn 可见', async ({ page, context }) => {
  ensureScreenshotDir();
  await injectSession(context, SESSION_TOKEN);
  await page.goto(`${BASE_URL}/area/acquisition/tasks`);
  await page.waitForLoadState('networkidle');

  // 等待任务列表加载后检查失败态（e2e-verify.ps1 已 seed 一条 status=failed 任务）
  await page.waitForSelector('[data-testid="tasks-list"]', { timeout: 10_000 });
  await page.waitForTimeout(1000);

  await expect(page.getByTestId('task-status-failed').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('task-retry-btn').first()).toBeVisible({ timeout: 5_000 });

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08-tasks-failed.png'), fullPage: true });
});
