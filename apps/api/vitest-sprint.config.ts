import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'supertest': resolve('../../node_modules/supertest'),
    },
  },
  test: {
    globals: true,
    include: [
      '../../sprints/zj1-smart-acquisition/tests/**/*.test.ts',
      '../../sprints/zj2-smart-acquisition-run1/tests/ws2/**/*.test.ts',
    ],
  },
});
