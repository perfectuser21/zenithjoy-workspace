/**
 * Playwright config — Staff Hub E2E（业务线健康看板 GP3 / line_health 起）
 *
 * 变体C（windows_cloud）死规则：spec 打真实后端，禁 page.route()。
 * 运行前提（见 sprints/07281207-staff-line-health-dashboard/e2e-verify.ps1）：
 *   1. apps/api 起在 3000 端口（STAFF_EMAILS=staff@test.com）
 *   2. staff-hub 起在 5175 端口（VITE_SKIP_AUTH=true，STAFF_HUB_API_TARGET 指向 apps/api）
 *
 * 结构参照 apps/dashboard/playwright.config.ts，baseURL 默认改 5175 对齐本 sprint。
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5175',
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
