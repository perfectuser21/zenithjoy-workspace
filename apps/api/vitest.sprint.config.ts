import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['../../sprints/**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
});
