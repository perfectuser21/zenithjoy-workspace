import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.js', '.jsx', '.json'],
  },
  test: {
    globals: true,
    include: [
      'tests/integration/**/*.integration.test.ts',
      'tests/integration/ws1/**/*.test.ts',
      'tests/integration/ws5/**/*.test.ts',
    ],
    // This contract needs real better-auth sessions and the disposable business PG setup.
    exclude: ['tests/integration/acquisition-cancel-uuid-agent.integration.test.ts', 'node_modules/**'],
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
