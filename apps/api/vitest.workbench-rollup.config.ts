/**
 * 路③ Sprint E 合同测试的专用收集配置 —— 让本刀 rollup 测试文件真被 vitest 收集、真跑、红绿真机械可判
 *
 * 为什么不塞进 apps/api/vitest.config.ts 的 include：`ci-l4-runtime.yml` 的 api-test job
 * 跑默认 config 且**没有 Postgres service**，而这批文件是 supertest + 真 PG
 * （合同「禁 mock 边清单」明令代码 ↔ db_rows.data / db_fields / db_tables 不许 stub）。
 * 塞进去只会把一条现在绿的 required 车道打红 —— 同 Sprint D 的 workbench-relations.config 口径。
 *
 * 正确落点是「专用 config + 有库的 job」：e2e-knowledge-hub-path3.yml 的 linux job
 * 自带 postgres:16 service、E2E_DATABASE_URL 与 npm run migrate，正是这批测试要的环境。
 *
 * singleFork + 非并发：双企业种子共用一个库，多个 suite 并发跑会互相踩
 * （各自 beforeAll 里 INSERT tenants、afterAll 里按 org_id 批量 DELETE）。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.js', '.jsx', '.json'],
  },
  test: {
    globals: true,
    include: ['../../sprints/08222228-workbench-rollup-sprintE/tests/**/*.test.ts'],
    setupFiles: ['./vitest.workbench-rollup.setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
