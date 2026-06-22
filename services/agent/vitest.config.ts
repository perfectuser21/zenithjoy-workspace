import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/**/*.test.ts',
      // sprint 06081700 — 各 Line 独立模块测试
      'modules/**/__tests__/**/*.test.ts',
      'publishers/**/__tests__/**/*.test.ts',
      'publishers/**/__tests__/**/*.test.cjs',
      // Path 2 Sprint B-1 WS2b — douyin-comment-crawl.cjs 测试在 scripts/__tests__/
      'scripts/**/__tests__/**/*.test.cjs',
      // zj-douyin-article-agent-port sprint 路由覆盖测试
      '../../sprints/zj-douyin-article-agent-port/tests/**/*.test.ts',
      // agent-python-embedded sprint 合约测试
      '../../sprints/06031608-agent-python-embedded/tests/**/*.test.ts',
      // agent-module-e2e-verify sprint 合约测试
      '../../sprints/06081800-agent-module-e2e-verify/tests/**/*.test.ts',
      // Path 2 抖音私信主动触达 sprint 合约测试（douyin-dm-outreach handler）
      '../../sprints/06131229-path2-douyin-dm-outreach/tests/**/*.test.ts',
      // Agent 客户端封装（去黑窗 + 托盘静默通知）sprint 合约测试
      '../../sprints/06220836-agent-client-encapsulation/tests/**/*.test.ts',
    ],
    exclude: ['node_modules/**', 'dist/**', 'dist-pkg/**'],
  },
});
