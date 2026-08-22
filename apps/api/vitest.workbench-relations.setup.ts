/**
 * 路③ Sprint D 合同测试的环境前置 —— 从连接串推导 apps/api 真正认的那五个变量
 *
 * 与 Sprint B/C 的 vitest.workbench-{rows,views}.setup.ts 同口径（连的库必须与判据一致）：
 * `src/db/connection.ts` 只读 DATABASE_HOST / PORT / NAME / USER / PASSWORD 五个离散变量，
 * 不读 DATABASE_URL（缺省库名还是 cecelia）。而合同判据、CI 的 linux job、smoke 夹具给的
 * 都是 E2E_DATABASE_URL 这条连接串。少了这层推导，测试里的 pg Client 往 zenithjoy_e2e 种双企业，
 * 被测的 app 却往缺省库写 tenant_members —— 报出来是外键冲突，看着像业务写错了，
 * 其实是两边连的根本不是同一个库。
 *
 * setupFiles 在每个测试文件 import 之前执行，所以 import app 触发建池时这五个变量已就位。
 */
import { URL } from 'node:url';

const raw = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
if (!raw) {
  throw new Error('[workbench-relations] 未设 E2E_DATABASE_URL / DATABASE_URL —— 拒绝落缺省库跑成假绿');
}

const u = new URL(raw);
process.env.DATABASE_URL = raw;
process.env.DATABASE_HOST = u.hostname || 'localhost';
process.env.DATABASE_PORT = u.port || '5432';
process.env.DATABASE_NAME = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres';
process.env.DATABASE_USER = decodeURIComponent(u.username) || 'postgres';
process.env.DATABASE_PASSWORD = decodeURIComponent(u.password);
