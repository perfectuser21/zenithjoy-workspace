import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/integration/**/*.integration.test.ts'],
    setupFiles: ['tests/integration/setup-env.ts'],
    globalSetup: 'tests/integration/global-setup.ts',
    testTimeout: 30000,
    hookTimeout: 30000,
    // Sequential to avoid DB state conflicts between suites
    sequence: { concurrent: false },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
