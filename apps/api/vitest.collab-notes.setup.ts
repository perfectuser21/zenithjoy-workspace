/**
 * 路② 协同笔记 合同测试的环境前置 —— 从连接串推导 apps/api 真正认的那五个离散变量
 *
 * src/db/connection.ts 只读 DATABASE_HOST/PORT/NAME/USER/PASSWORD 五个离散变量，不读 DATABASE_URL。
 * 而合同判据、CI linux job、本地自验给的都是 E2E_DATABASE_URL 一条连接串。少了这层推导，测试里的
 * pg Client 往一个库种双企业，被测 app 却往缺省库写 —— 报出来的是外键冲突，看着像业务写错，其实是
 * 两边连的根本不是同一个库（路③ workbench-rows.setup 同款坑，沿用其解法）。
 */
import { vi } from 'vitest';
import { URL } from 'node:url';

/**
 * 测试进程内把 express-rate-limit 变成 passthrough（不改任何生产源码）。
 *
 * 为什么必须在这层做：合同 collab-ws.test.ts（不可改）在**同一文件模块实例**里连做 6 次真登录
 * （beforeAll 3 + A10 再 seedTwoTenants 3），而 /api/staff/feishu-login 的限流是 5 次/300 秒/IP。
 * supertest 全走 127.0.0.1 同 IP，第 6 次必被 429 误伤成"登录失败"。真实 smoke/dev/prod 跑的是 node
 * 构建产物、不加载本 setup，限流照常生效。限流不在合同 `## 禁 mock 边` 清单内（那 4 条是会话/
 * tenant_members/documents/CRDT 业务边），把这个横切基建库在测试进程里放行不违反禁 mock 边。
 */
vi.mock('express-rate-limit', () => {
  const passthrough =
    () => (_req: unknown, _res: unknown, next: () => void) =>
      next();
  return {
    default: passthrough,
    rateLimit: passthrough,
    ipKeyGenerator: (ip: string) => ip,
  };
});

const raw = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
if (!raw) {
  throw new Error('[collab-notes] 未设 E2E_DATABASE_URL / DATABASE_URL —— 拒绝落缺省库跑成假绿');
}

const u = new URL(raw);
process.env.DATABASE_URL = raw;
process.env.DATABASE_HOST = u.hostname || 'localhost';
process.env.DATABASE_PORT = u.port || '5432';
process.env.DATABASE_NAME = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres';
process.env.DATABASE_USER = decodeURIComponent(u.username) || 'postgres';
process.env.DATABASE_PASSWORD = decodeURIComponent(u.password);
