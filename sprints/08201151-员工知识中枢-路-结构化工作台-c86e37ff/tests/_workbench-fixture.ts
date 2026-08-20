/**
 * 路③ Sprint A 测试夹具 —— 双企业种子 + 真会话签发
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：
 *   - 真 Postgres：tenants / tenant_members / db_* 五表全部真插真查，不 stub DB 层；
 *   - 真 better-auth 会话：走 /api/staff/feishu-login 真签发，不伪造 cookie 字符串。
 * 唯一允许 mock 的边：飞书 OAuth 上游（走 FEISHU_API_BASE 指向本地假上游，
 * 属环境端点重定向，被测代码路径一行不变）——沿用路① 先例。
 *
 * INV-3 [测试默认多租户]：本夹具**恒定种两家企业**，单企业种子会让跨企业漏洞永远看不见。
 */
import request from 'supertest';
import { Client } from 'pg';
import app from '../../../apps/api/src/app';

export const PGURL =
  process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:5432/cecelia';

/** 八类字段各一 —— PRD 逐字要求的类型集合，下标即 display_order */
export const EIGHT_FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'single_select',
  'multi_select',
  'person',
  'url',
] as const;

export function eightFields() {
  return EIGHT_FIELD_TYPES.map((t, i) => ({
    name: `字段-${t}`,
    field_type: t,
    options: t === 'single_select' || t === 'multi_select' ? ['甲', '乙'] : [],
    display_order: i,
  }));
}

export interface TwoTenantSeed {
  client: Client;
  sfx: string;
  orgATenantId: string;
  orgBTenantId: string;
  /** A 企业员工甲（表主） */
  aliceOpenId: string;
  aliceCookie: string;
  /** A 企业员工乙（同组织他人，用于可见性反向断言） */
  bobOpenId: string;
  bobCookie: string;
  /** B 企业员工（他企业，用于跨企业断言） */
  carolOpenId: string;
  carolCookie: string;
}

/**
 * 假上游 code 的**确切字面形态**（合同「假上游按成员寻址扩展」定死）：`wb-code-<open_id>`。
 *
 * 为什么不能写 `wb-code-alice-<sfx>`：`_smoke-fake-feishu.ts:68` 的正则是
 * `/code-([A-Za-z0-9_]+)$/`——KEY 内不许有 `-`，中间夹了 `-` 的 code 一律解析为 NULL，
 * 假上游回 20021 invalid code，登录拿不到 set-cookie，实现写得再对全部用例也以 401 收场。
 * open_id 形如 `ou_wb_alice_<数字>`，全串只含 [A-Za-z0-9_]，正则可整段捕获。
 *
 * 为什么不能三个人都用 `wb-code-ORGA`：`pickGroupMembers` 只返回分组里第一个非邮箱成员，
 * 甲乙会解析成同一个人，A8「同组织他人 404 / 表主本人 200」就没有第二个身份可用。
 * 本刀扩展 `resolveFakeFeishuIdentity` 在分组名未命中时按 open_id 精确寻址（纯 fallback，
 * `code-<ORGKEY>` 既有语义一字不改），路① smoke 会话签发段仍绿。
 */
export function codeFor(openId: string): string {
  return `wb-code-${openId}`;
}

async function loginAs(code: string): Promise<string> {
  const res = await request(app).post('/api/staff/feishu-login').send({ code });
  const raw = res.headers['set-cookie'];
  const cookie = Array.isArray(raw) ? raw.join('; ') : String(raw ?? '');
  // 拿不到会话就地炸，别把 "undefined" 当 cookie 传下去：那样每个用例都以 401 收场，
  // 看着像"实现没写"，实际是夹具签发失败（假上游没认出 code / 缺 FEISHU_APP_ID）。
  if (!cookie || cookie === 'undefined') {
    throw new Error(
      `[fixture] 会话签发失败 code=${code} status=${res.status} body=${JSON.stringify(res.body)} —— ` +
        '假上游未按成员寻址（见合同「假上游按成员寻址扩展」）或缺 FEISHU_APP_ID/SECRET'
    );
  }
  return cookie;
}

export async function seedTwoTenants(prefix: string): Promise<TwoTenantSeed> {
  const client = new Client({ connectionString: PGURL });
  await client.connect();
  const sfx = `${Date.now()}${Math.floor(Math.random() * 10000)}`;

  const a = await client.query(
    "INSERT INTO zenithjoy.tenants (name, plan) VALUES ($1, 'free') RETURNING id",
    [`${prefix}-A-${sfx}`]
  );
  const b = await client.query(
    "INSERT INTO zenithjoy.tenants (name, plan) VALUES ($1, 'free') RETURNING id",
    [`${prefix}-B-${sfx}`]
  );
  const orgATenantId = a.rows[0].id as string;
  const orgBTenantId = b.rows[0].id as string;

  const aliceOpenId = `ou_wb_alice_${sfx}`;
  const bobOpenId = `ou_wb_bob_${sfx}`;
  const carolOpenId = `ou_wb_carol_${sfx}`;

  // 员工目录：甲乙在 A 企业，丙在 B 企业。每人恰属一组织（A11 自检的正常态前提）。
  process.env.FEISHU_API_BASE = 'http://127.0.0.1:0/api/_smoke/fake-feishu';
  process.env.STAFF_FEISHU_OPENIDS = [aliceOpenId, bobOpenId, carolOpenId].join(',');
  process.env.STAFF_FEISHU_OPENIDS__ORGA = [aliceOpenId, bobOpenId].join(',');
  process.env.STAFF_FEISHU_OPENIDS__ORGB = carolOpenId;
  process.env.STAFF_ORG_MAP = `ORGA:${orgATenantId},ORGB:${orgBTenantId}`;
  // routes/staff.ts:139-142 两者缺一即 500，登录连假上游都走不到。
  process.env.FEISHU_APP_ID ??= 'fake-feishu-app-id';
  process.env.FEISHU_APP_SECRET ??= 'fake-feishu-app-secret';

  return {
    client,
    sfx,
    orgATenantId,
    orgBTenantId,
    aliceOpenId,
    aliceCookie: await loginAs(codeFor(aliceOpenId)),
    bobOpenId,
    bobCookie: await loginAs(codeFor(bobOpenId)),
    carolOpenId,
    carolCookie: await loginAs(codeFor(carolOpenId)),
  };
}

export async function cleanupSeed(s: TwoTenantSeed): Promise<void> {
  if (!s?.client) return;
  const ids = [s.aliceOpenId, s.bobOpenId, s.carolOpenId];
  const orgs = [s.orgATenantId, s.orgBTenantId];
  const swallow = () => undefined;
  await s.client.query('DELETE FROM zenithjoy.db_fields WHERE org_id = ANY($1::uuid[])', [orgs]).catch(swallow);
  await s.client.query('DELETE FROM zenithjoy.db_rows WHERE org_id = ANY($1::uuid[])', [orgs]).catch(swallow);
  await s.client.query('DELETE FROM zenithjoy.db_audit WHERE org_id = ANY($1::uuid[])', [orgs]).catch(swallow);
  await s.client.query('DELETE FROM zenithjoy.db_view_prefs WHERE org_id = ANY($1::uuid[])', [orgs]).catch(swallow);
  await s.client.query('DELETE FROM zenithjoy.db_tables WHERE org_id = ANY($1::uuid[])', [orgs]).catch(swallow);
  await s.client.query('DELETE FROM zenithjoy.session WHERE "userId" = ANY($1)', [ids]).catch(swallow);
  await s.client.query('DELETE FROM zenithjoy."user" WHERE id = ANY($1)', [ids]).catch(swallow);
  await s.client
    .query('DELETE FROM zenithjoy.tenant_members WHERE tenant_id = ANY($1::uuid[])', [orgs])
    .catch(swallow);
  await s.client.query('DELETE FROM zenithjoy.tenants WHERE id = ANY($1::uuid[])', [orgs]).catch(swallow);
  await s.client.end();
}

/** 建一张表；forgedOrgId 非空时把它塞进请求体，服务端必须忽略（A1 判据） */
export async function createTable(
  cookie: string,
  name: string,
  visibility: 'org' | 'private',
  forgedOrgId?: string
) {
  return request(app)
    .post('/api/knowledge/db/tables')
    .set('Cookie', cookie)
    .send({ name, visibility, fields: eightFields(), ...(forgedOrgId ? { org_id: forgedOrgId } : {}) });
}
