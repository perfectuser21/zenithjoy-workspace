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
      // ⚠️ 以下三个 sprint 合约测试已从常青跑集摘除（巡检 2026-07-12 收编 triage）：
      // 时点断言腐烂（/workspace 容器绝对路径、版本钉死 ===1.1.26/===1.1.79、Narrator 已换 SPI 机制、
      // preflight version-only 合同已被 4.1.10 事故后硬拦决策推翻），而 lint-contract-test-immutability
      // 机械闸禁止修改已落盘合同测试——不可维护的时点合同不进常青 CI。其持久不变量已由
      // publishers/douyin-publisher/__tests__/ 与 modules/line04/__tests__/ 的常青测试覆盖。
      // - '../../sprints/zj-douyin-article-agent-port/tests/**/*.test.ts'
      // - '../../sprints/06031608-agent-python-embedded/tests/**/*.test.ts'
      // - '../../sprints/06081800-agent-module-e2e-verify/tests/**/*.test.ts'
      // Path 2 抖音私信主动触达 sprint 合约测试（douyin-dm-outreach handler）
      '../../sprints/06131229-path2-douyin-dm-outreach/tests/**/*.test.ts',
      // Agent 客户端封装（去黑窗 + 托盘静默通知）sprint 合约测试
      '../../sprints/06220836-agent-client-encapsulation/tests/**/*.test.ts',
      // Line04 DesktopLeaseBroker 状态机 sprint 合约测试
      '../../sprints/0703-line04-desktop-lease-broker/tests/**/*.test.ts',
      // install-pack __tests__（setup-reset-ps1 合约静态断言）
      'install-pack/**/__tests__/**/*.test.ts',
    ],
    // 巡检 2026-07-12 收编债已清偿：4 个 publisher 的 node:test CJS 测试已迁移到 vitest globals，
    // 不再需要排除，随 publishers/**/__tests__/**/*.test.cjs 的 include 正常跑。
    exclude: ['node_modules/**', 'dist/**', 'dist-pkg/**'],
  },
});
