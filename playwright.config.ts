import path from 'path';
import os from 'os';
import { defineConfig, devices } from '@playwright/test';

const CHROMIUM_DIR = path.join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1217/chrome-linux');
const USER_LIB = path.join(os.homedir(), '.local/lib/aarch64-linux-gnu');
const BROWSER_LD_PATH = [CHROMIUM_DIR, USER_LIB, process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':');

export default defineConfig({
  testDir: './apps/dashboard/e2e',
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
    launchOptions: {
      env: {
        LD_LIBRARY_PATH: BROWSER_LD_PATH,
      },
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
