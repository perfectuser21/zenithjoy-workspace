import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/**/*.test.ts',
      'publishers/**/__tests__/**/*.test.ts',
      'publishers/**/__tests__/**/*.test.cjs',
    ],
    exclude: ['node_modules/**', 'dist/**', 'dist-pkg/**'],
  },
});
