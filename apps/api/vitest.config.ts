import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'tests/**/*.test.ts',
      'src/**/*.test.{ts,js}',
      'src/**/__tests__/**/*.test.{ts,js}',
    ],
    // ws1/ws5 走 vitest.integration.config.ts (需要真 DB / git diff origin)
    // ws2/ws3 是 mock 单测，进 unit
    exclude: ['node_modules/**', 'tests/integration/**', 'tests/ws1/**', 'tests/ws4/**', 'tests/ws5/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/test/**',
        'src/clients/**',
        'src/models/types.ts',
      ],
      thresholds: {
        statements: 65,
        branches: 65,
        functions: 65,
        lines: 65,
      },
      reporter: ['text', 'lcov'],
    },
  },
});
