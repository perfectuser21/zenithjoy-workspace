import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: 'skill-eval.spec.ts', timeout: 30_000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:15315', ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: 'node -r ts-node/register/transpile-only ../api/tests/fixtures/staff-skill-eval-server.ts',
      url: 'http://127.0.0.1:15311/health',
      env: { TS_NODE_COMPILER_OPTIONS: '{"module":"CommonJS"}', BETTER_AUTH_SECRET: 'ci-only-staff-eval-fixture-secret-32chars' },
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 15315 --strictPort',
      url: 'http://127.0.0.1:15315',
      env: { VITE_SKIP_AUTH: 'false', STAFF_HUB_API_TARGET: 'http://127.0.0.1:15311' },
    },
  ],
});
