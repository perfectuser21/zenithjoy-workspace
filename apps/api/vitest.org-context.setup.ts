/**
 * 多组织切换第一刀合同测试的环境前置 —— 从连接串推导 apps/api 真正认的五个离散变量
 *
 * 与 Sprint B/C/D 的 setup 同口径：src/db/connection.ts 只读 DATABASE_HOST/PORT/NAME/USER/PASSWORD，
 * 不读 DATABASE_URL（缺省库名还是 cecelia）。合同判据 / CI linux job / smoke 夹具给的是 E2E_DATABASE_URL，
 * 少了这层推导会出现「测试的 pg Client 往 A 库种、被测 app 往缺省库写」的假失败。
 */
import { URL } from 'node:url';

const raw = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
if (!raw) {
  throw new Error('[org-context] 未设 E2E_DATABASE_URL / DATABASE_URL —— 拒绝落缺省库跑成假绿');
}

const u = new URL(raw);
process.env.DATABASE_URL = raw;
process.env.DATABASE_HOST = u.hostname || 'localhost';
process.env.DATABASE_PORT = u.port || '5432';
process.env.DATABASE_NAME = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres';
process.env.DATABASE_USER = decodeURIComponent(u.username) || 'postgres';
process.env.DATABASE_PASSWORD = decodeURIComponent(u.password);
