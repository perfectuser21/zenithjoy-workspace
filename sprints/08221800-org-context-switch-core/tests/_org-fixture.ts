/**
 * 多组织切换第一刀测试夹具 —— 在路③ Sprint A 双企业种子之上加一个「跨两企业成员 dave」
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：
 *   - 真 Postgres：tenants / tenant_members / db_* / public.session 全真插真查，不 stub DB 层；
 *   - 真 better-auth 会话：走 /api/staff/feishu-login 真签发，active_org 真落 public.session；
 *   - resolveActiveOrg / 两闸 / switch-org 端点真调，不 vi.mock 顶替。
 * 唯一允许 mock 的边：飞书 OAuth 上游（FEISHU_API_BASE 指向本地假上游）——沿用路①③ 先例。
 *
 * dave 的两条归属行由「admin/手动供给」直插产生（J8：本刀多组织成员行限定 admin/手动供给，
 * 一般员工 feishu-login 自动多行供给不在本刀）；登录前就 ≥2 家 → 登录后 active_org=null 要求先选。
 */
import request from 'supertest';
import app from '../../../apps/api/src/app';

export {
  PGURL,
  seedTwoTenants,
  cleanupSeed,
  codeFor,
  createTable,
  type TwoTenantSeed,
} from '../../08201151-员工知识中枢-路-结构化工作台-c86e37ff/tests/_workbench-fixture';

import {
  seedTwoTenants,
  cleanupSeed,
  codeFor,
  type TwoTenantSeed,
} from '../../08201151-员工知识中枢-路-结构化工作台-c86e37ff/tests/_workbench-fixture';

/** 路③ 数据端点基址（建表/行/视图，挂 workbenchAuthGuard） */
export const DB_BASE = '/api/knowledge/db';
/** 组织上下文端点基址（列企业 / 切换，session-only，独立于 workbenchAuthGuard） */
export const ORG_BASE = '/api/knowledge/org';

export interface MultiOrgSeed extends TwoTenantSeed {
  /** 跨 A/B 两企业的成员（admin/手动供给两行归属），登录后 active_org=null 需先选 */
  daveOpenId: string;
  daveCookie: string;
}

/** 登录并取回 Set-Cookie（拿不到就地炸，别把 undefined 当 cookie 传下去） */
export async function loginAs(code: string): Promise<string> {
  const res = await request(app).post('/api/staff/feishu-login').send({ code });
  const raw = res.headers['set-cookie'];
  const cookie = Array.isArray(raw) ? raw.join('; ') : String(raw ?? '');
  if (!cookie || cookie === 'undefined') {
    throw new Error(
      `[org-fixture] 会话签发失败 code=${code} status=${res.status} body=${JSON.stringify(res.body)}`
    );
  }
  return cookie;
}

/** 登录并返回完整响应体（用于断言 orgs / active_org_id / needs_selection） */
export async function loginRaw(code: string) {
  return request(app).post('/api/staff/feishu-login').send({ code });
}

/**
 * 在双租户种子上加「跨两企业成员 dave」。
 * dave 声明在 ORGA 分组（登录据此 resolveStaffOrg→ORGA 而不 403），ORGB 行由 admin/手动直插供给。
 * 登录前就 ≥2 家 → 登录返回的会话 active_org=null（要求先选，不自动挑）。
 */
export async function seedMultiOrg(prefix: string): Promise<MultiOrgSeed> {
  const base = await seedTwoTenants(prefix);
  const daveOpenId = `ou_wb_dave_${base.sfx}`;

  // dave 进员工目录：扁平名单 + ORGA 分组（登录「是不是员工」看整本目录，归属看分组）。
  process.env.STAFF_FEISHU_OPENIDS = `${process.env.STAFF_FEISHU_OPENIDS},${daveOpenId}`;
  process.env.STAFF_FEISHU_OPENIDS__ORGA = `${process.env.STAFF_FEISHU_OPENIDS__ORGA},${daveOpenId}`;

  // admin/手动供给两条归属行（ORGA + ORGB），登录前就位 → 登录后 active_org=null。
  await base.client.query(
    `INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
     VALUES ($1::uuid, $3, 'member'), ($2::uuid, $3, 'member') ON CONFLICT DO NOTHING`,
    [base.orgATenantId, base.orgBTenantId, daveOpenId]
  );

  const daveCookie = await loginAs(codeFor(daveOpenId));
  return { ...base, daveOpenId, daveCookie };
}

/** 清理：base cleanup + dave 的 public.session/user + org_audit（session 在 public schema，与 base 不同 key） */
export async function cleanupMultiOrg(s: MultiOrgSeed): Promise<void> {
  const swallow = () => undefined;
  const allIds = [s.aliceOpenId, s.bobOpenId, s.carolOpenId, s.daveOpenId];
  await s.client.query('DELETE FROM zenithjoy.org_audit WHERE member_id = ANY($1)', [allIds]).catch(swallow);
  await s.client.query('DELETE FROM public.session WHERE "userId" = ANY($1)', [allIds]).catch(swallow);
  await s.client.query('DELETE FROM public."user" WHERE id = ANY($1)', [[s.daveOpenId]]).catch(swallow);
  await s.client
    .query('DELETE FROM zenithjoy.tenant_members WHERE feishu_user_id = ANY($1)', [[s.daveOpenId]])
    .catch(swallow);
  await cleanupSeed(s);
}

/** GET /api/knowledge/org —— active_org_id / needs_selection / orgs */
export async function getOrgs(cookie: string) {
  return request(app).get(ORG_BASE).set('Cookie', cookie);
}

/** POST /api/knowledge/org/switch */
export async function switchOrg(cookie: string, orgId: string) {
  return request(app).post(`${ORG_BASE}/switch`).set('Cookie', cookie).send({ org_id: orgId });
}

/** 建一张只含一个 text 主字段的极简表（返回完整响应，含 data.table_id） */
export async function createSimpleTable(cookie: string, name: string) {
  return request(app)
    .post(`${DB_BASE}/tables`)
    .set('Cookie', cookie)
    .send({ name, visibility: 'org', fields: [{ name: '标题', field_type: 'text', options: [], display_order: 0 }] });
}

/** GET 某张表（用于跨企业 404 同形断言） */
export async function getTable(cookie: string, tableId: string) {
  return request(app).get(`${DB_BASE}/tables/${tableId}`).set('Cookie', cookie);
}

/** 一个语法合法但库里绝不存在的 uuid（反枚举对照组） */
export function randomUuid(): string {
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-8${h().slice(1)}-${h()}${h()}${h()}`;
}
