import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { extensions: ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.js', '.jsx', '.json'] },
  test: {
    include: ['tests/integration/consolidated-ci/**/*.test.ts'],
    globalSetup: 'tests/integration/consolidated-ci/global-setup.ts',
    setupFiles: ['tests/integration/consolidated-ci/setup-env.ts', 'tests/setup-http.ts'],
    testTimeout: 15000, hookTimeout: 30000,
    pool: 'forks', poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
  },
});
