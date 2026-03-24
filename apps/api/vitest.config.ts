import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'tests/**/*.test.ts',
      'src/**/*.test.{ts,js}',
      'src/**/__tests__/**/*.test.{ts,js}',
    ],
    exclude: ['node_modules/**'],
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
