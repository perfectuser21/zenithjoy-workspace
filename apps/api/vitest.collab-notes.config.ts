/**
 * 路② 协同笔记 合同测试专用收集配置 —— 让 5 个合同测试文件真被 vitest 收集、真跑、红绿机械可判
 *
 * 为什么不塞进 apps/api/vitest.config.ts 的 include：这些是 supertest + 真 collab-ws + 真 PG
 * （合同「禁 mock 边清单」明令代码 ↔ zenithjoy.documents / CRDT 落库不许 stub）。默认 config 的
 * api-test job 没有 Postgres service，塞进去会把现在绿的 required 车道打红。正确落点是「专用
 * config + 有库的 job」：e2e-knowledge-hub-path2.yml 的 linux job 自带 postgres:16 + migrate。
 *
 * singleFork + 非并发：双企业种子共用一个库，多 suite 并发会互相踩（各自 beforeAll INSERT tenants、
 * afterAll 按 org_id 批量 DELETE）。collab-ws suite 还真起 http server + 真 ws 客户端，串行更稳。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.js', '.jsx', '.json'],
  },
  test: {
    globals: true,
    include: ['../../sprints/08221200-line11-path2-collab-notes/tests/**/*.test.ts'],
    // 连接串 → apps/api 认的五个离散 DATABASE_* 变量。必须在测试文件 import app 之前跑。
    setupFiles: ['./vitest.collab-notes.setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
