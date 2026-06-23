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
      // Line04 无审批自动回复闭环 sprint oracle（合同 BEHAVIOR 用
      // `cd apps/api && npx vitest run ../../sprints/.../tests/...` 跑，须在 include 内才收集）
      '../../sprints/06220821-line04-cs-no-approval-auto-reply/tests/**/*.test.ts',
      // Line04 客服工作汇总 stats sprint：computeCsStats 口径纯函数单测
      '../../sprints/06232241-line04-cs-work-stats/tests/**/*.test.ts',
      // Line04 中台 CRM 客户列表页 sprint oracle（buildCustomerRoster 名册聚合 + 租户隔离）
      '../../sprints/06242057-line04-crm-customer-list/tests/**/*.test.ts',
      // Line02 公司信息页 + 采集任务 Table + 主号全链
      '../../sprints/06282255-line02-company-profile-collect/tests/**/*.test.ts',
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
