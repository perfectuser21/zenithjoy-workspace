/**
 * Playwright config — Walking Skeleton #1 dashboard E2E
 *
 * 运行：
 *   1. 另开终端 VITE_SKIP_AUTH=true npm run dev:dashboard
 *   2. npx playwright install chromium  (首次)
 *   3. npx playwright test
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
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
