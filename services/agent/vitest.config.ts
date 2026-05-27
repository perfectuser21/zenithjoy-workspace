import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/**/*.test.ts',
      'publishers/**/__tests__/**/*.test.ts',
      'publishers/**/__tests__/**/*.test.cjs',
      // Path 2 Sprint B-1 WS2b — douyin-comment-crawl.cjs 测试在 scripts/__tests__/
      'scripts/**/__tests__/**/*.test.cjs',
      // zj-douyin-article-agent-port sprint 路由覆盖测试
      '../../sprints/zj-douyin-article-agent-port/tests/**/*.test.ts',
      // kuaishou-trimode sprint TDD tests
      '../../sprints/tests/**/*.test.ts',
    ],
    exclude: ['node_modules/**', 'dist/**', 'dist-pkg/**'],
  },
});
