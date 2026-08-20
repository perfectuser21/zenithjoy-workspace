/**
 * 路③ Sprint B 合同测试的专用收集配置 —— 让那 4 个文件真被 vitest 收集、真跑、红绿真机械可判
 *
 * 为什么不塞进 `apps/api/vitest.config.ts` 的 include：`ci-l4-runtime.yml` 的 `api-test` job
 * 跑的是默认 config 且**没有 Postgres service**，而这 4 个文件是 supertest + 真 PG
 * （合同「禁 mock 边清单」明令代码 ↔ db_rows / db_fields / db_audit 不许 stub）。
 * 塞进去只会把一条现在绿的 required 车道打红 —— `vitest.config.ts` 自己第 27 行就有同一坑的前例
 * （07212317 那批 supertest 集成测试被注释掉，理由逐字为「需要真实 DB…不进 L3 CI」）。
 *
 * 正确落点是「专用 config + 有库的 job」：`e2e-knowledge-hub-path3.yml` 的 linux job
 * 自带 postgres:16 service、`E2E_DATABASE_URL` 与 `npm run migrate`，正是这批测试要的环境。
 *
 * singleFork + 非并发：双企业种子共用一个库，四个 suite 并发跑会互相踩
 * （各自 beforeAll 里 INSERT tenants、afterAll 里按 org_id 批量 DELETE）。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // 与 vitest.config.ts 同口径：优先 .ts，别让 src/ 里的 ESM wrapper 遮住 TypeScript 源码
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.js', '.jsx', '.json'],
  },
  test: {
    globals: true,
    include: ['../../sprints/08201850-workbench-sprintB-rows/tests/**/*.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    sequence: { concurrent: false },
    // 真库 + 真会话签发，30s 给足；超时太短会红在"登录还没回来"而不是业务上
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
