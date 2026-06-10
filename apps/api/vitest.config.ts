import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Prefer .ts over .js so ESM wrappers in src/ don't shadow TypeScript sources
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.js', '.jsx', '.json'],
  },
  test: {
    globals: true,
    include: [
      'tests/**/*.test.ts',
      'src/**/*.test.{ts,js}',
      'src/**/__tests__/**/*.test.{ts,js}',
    ],
    exclude: ['node_modules/**', 'tests/integration/**', 'tests/ws1/**', 'tests/ws2/**', 'tests/ws3/**', 'tests/ws4/**', 'tests/ws5/**', 'tests/ws6/**'],
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
