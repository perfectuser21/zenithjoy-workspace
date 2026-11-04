import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: [
      'tests/pg-contracts/disposable-db.test.ts',
      'src/routes/company-profile-scratch.test.ts',
      'tests/integration/p2-sprint-b1-ws3/agent-burner-routes.test.ts',
      'tests/ws1/publish-task-type.test.ts',
    ],
    globalSetup: 'tests/pg-contracts/global-setup.ts',
    setupFiles: ['tests/pg-contracts/setup-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    sequence: { concurrent: false },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
