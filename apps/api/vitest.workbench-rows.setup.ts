/**
 * 路③ Sprint B 合同测试的环境前置 —— 从连接串推导 apps/api 真正认的那五个变量
 *
 * 为什么非有这一步不可：`src/db/connection.ts` **只读 DATABASE_HOST / PORT / NAME / USER /
 * PASSWORD 五个离散变量，不读 DATABASE_URL**（缺省库名还是 `cecelia`）。而合同的判据、
 * CI 的 linux job、smoke 的夹具给的都是 `E2E_DATABASE_URL` 这一条连接串。
 * 少了这层推导，测试里的 pg Client 往 zenithjoy_e2e 种双企业，被测的 app 却往缺省库写
 * tenant_members —— 报出来的是 `tenant_members_tenant_id_fkey` 外键冲突，看着像业务写错了，
 * 其实是两边连的根本不是同一个库。（本刀自验实测到的，不是理论上的。）
 *
 * setupFiles 在每个测试文件的 import 之前执行，所以 `import app from '../../apps/api/src/app'`
 * 触发 connection.ts 建池时，这五个变量已经就位。
 */
import { URL } from 'node:url';

const raw = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
if (!raw) {
  throw new Error(
    '[workbench-rows] 未设 E2E_DATABASE_URL / DATABASE_URL —— 拒绝落缺省库跑成假绿'
  );
}

const u = new URL(raw);
process.env.DATABASE_URL = raw;
process.env.DATABASE_HOST = u.hostname || 'localhost';
process.env.DATABASE_PORT = u.port || '5432';
process.env.DATABASE_NAME = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres';
process.env.DATABASE_USER = decodeURIComponent(u.username) || 'postgres';
process.env.DATABASE_PASSWORD = decodeURIComponent(u.password);
