import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./test-utils/vitest-setup-url-patch.ts'],
    include: [
      '../../sprints/zj2-smart-acquisition-run1/tests/ws4/**/*.test.ts',
    ],
  },
});
