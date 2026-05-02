import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 配置
 *
 * 策略：
 *  - VITE_SKIP_AUTH=true 跳过登录（直接使用 mock 用户）
 *  - page.route() 拦截所有 API 调用（不需要真实 backend）
 *  - webServer 启动 vite dev（仅 CI），本地可先手动 npm run dev
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3001';
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  workers: 1,
  reporter: IS_CI ? 'github' : 'list',
  timeout: 30000,
  expect: { timeout: 10000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: IS_CI
    ? {
        command: 'npm run preview -- --port 3001 --host',
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 30000,
      }
    : undefined,
});
