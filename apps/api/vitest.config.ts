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
  },
});
