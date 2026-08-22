/**
 * 多组织切换第一刀合同测试的专用收集配置 —— 让本刀 org 测试文件真被 vitest 收集、真跑、红绿机械可判
 *
 * 与 Sprint D 同理：这批文件是 supertest + 真 PG（合同禁 mock 边：代码 ↔ tenant_members /
 * public.session / db_* / org_audit 不许 stub），默认 config 的 api-test job 没有 Postgres service，
 * 塞进去会把绿的 required 车道打红。正确落点是「专用 config + 有库的 job」（e2e-knowledge-hub-path3
 * 的 linux job 自带 postgres:16 + E2E_DATABASE_URL + migrate）。
 *
 * singleFork + 非并发：双企业 + dave 种子共用一个库，多 suite 并发跑会互相踩。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.js', '.jsx', '.json'],
  },
  test: {
    globals: true,
    include: ['../../sprints/08221800-org-context-switch-core/tests/**/*.test.ts'],
    setupFiles: ['./vitest.org-context.setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
