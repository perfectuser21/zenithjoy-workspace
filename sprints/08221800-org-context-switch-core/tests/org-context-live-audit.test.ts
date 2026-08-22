/**
 * 多组织切换 · LIVE 成员实时重校（A7）+ org 审计留痕（A11）
 *
 * A7：active_org=A 会话有效期间删该成员的 A 归属行 → 下一请求当次挡（ORG_FORBIDDEN）并清 active_org。
 *     每请求对 LIVE 成员集合真查，不吃登录时的快照。
 * A11：org 解析越权 deny / 切换 各落一条审计行（中间件自动副作用，不靠端点各自记）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import {
  seedMultiOrg,
  cleanupMultiOrg,
  switchOrg,
  createSimpleTable,
  getTable,
  PGURL,
  DB_BASE,
  type MultiOrgSeed,
} from './_org-fixture';
import request from 'supertest';
import app from '../../../apps/api/src/app';

async function sessionActiveOrg(probe: Client, memberId: string): Promise<string | null> {
  const { rows } = await probe.query(
    'SELECT "activeOrg" FROM public.session WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1',
    [memberId]
  );
  return rows[0]?.activeOrg ?? null;
}

async function auditRows(probe: Client, memberId: string, event: string): Promise<number> {
  const { rows } = await probe.query(
    'SELECT count(*)::int AS n FROM zenithjoy.org_audit WHERE member_id = $1 AND event = $2',
    [memberId, event]
  );
  return rows[0].n as number;
}

describe('LIVE 成员实时重校 A7 + org 审计 A11 [BEHAVIOR]', () => {
  let s: MultiOrgSeed;
  let probe: Client;
  beforeAll(async () => {
    s = await seedMultiOrg('org-live');
    probe = new Client({ connectionString: PGURL });
    await probe.connect();
  });
  afterAll(async () => {
    await probe.end().catch(() => undefined);
    await cleanupMultiOrg(s);
  });

  it('A7：active_org=A 有效期间删 dave 的 A 归属行 → 下一请求当次挡 ORG_FORBIDDEN 并清 active_org（LIVE 重校，非登录快照）', async () => {
    // dave 选定 A，建表 T_A，能读到（切前 active_org=A 有效）
    await switchOrg(s.daveCookie, s.orgATenantId);
    const t = await createSimpleTable(s.daveCookie, `live-A-${s.sfx}`);
    const tA = t.body.data.table_id;
    expect((await getTable(s.daveCookie, tA)).status).toBe(200);
    expect(await sessionActiveOrg(probe, s.daveOpenId)).toBe(s.orgATenantId);

    // 库里删 dave 的 A 归属行（模拟被移出企业 A）
    await probe.query('DELETE FROM zenithjoy.tenant_members WHERE tenant_id = $1::uuid AND feishu_user_id = $2', [
      s.orgATenantId,
      s.daveOpenId,
    ]);

    // 下一请求：active_org=A 已 ∉ LIVE 成员集合 {B} → 当次挡 ORG_FORBIDDEN（登录快照实现会漏，A7 变异点）
    const blocked = await getTable(s.daveCookie, tA);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ORG_FORBIDDEN');

    // 并清 active_org（下次要求重选；此处 dave 只剩 B 一家 → 之后透明落 B）
    expect(await sessionActiveOrg(probe, s.daveOpenId)).toBeNull();

    // 恢复 dave 的 A 归属行，供后续用例
    await probe.query(
      "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ($1::uuid, $2, 'member') ON CONFLICT DO NOTHING",
      [s.orgATenantId, s.daveOpenId]
    );
  });

  it('A11 deny 审计：越权（switch-org 到不归属企业）必产 resolve_deny 审计行（中间件自动副作用）', async () => {
    const before = await auditRows(probe, s.daveOpenId, 'resolve_deny');
    // 造一个 dave 绝不归属的 org
    const third = await probe.query(
      "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ($1, $2, 'free') RETURNING id::text AS id",
      [`live-C-${s.sfx}`, `live-lk-c-${s.sfx}`]
    );
    const thirdOrgId = third.rows[0].id as string;
    const sw = await switchOrg(s.daveCookie, thirdOrgId);
    expect(sw.status).toBe(403);
    const after = await auditRows(probe, s.daveOpenId, 'resolve_deny');
    expect(after).toBeGreaterThan(before);
    await probe.query('DELETE FROM zenithjoy.tenants WHERE id = $1::uuid', [thirdOrgId]);
  });

  it('A11 switch 审计：成功切换必产 switch 审计行', async () => {
    const before = await auditRows(probe, s.daveOpenId, 'switch');
    const sw = await switchOrg(s.daveCookie, s.orgBTenantId);
    expect(sw.status).toBe(200);
    const after = await auditRows(probe, s.daveOpenId, 'switch');
    expect(after).toBeGreaterThan(before);
  });

  it('A11 deny 审计（伪造 active_org）：会话 active_org 被直改成不归属的 org → 下一请求挡且产 resolve_deny 行', async () => {
    // dave 选定 B，然后直改会话 active_org 成一个不归属的 org（伪造）
    await switchOrg(s.daveCookie, s.orgBTenantId);
    const fake = '00000000-0000-4000-8000-000000000000';
    await probe.query('UPDATE public.session SET "activeOrg" = $1 WHERE "userId" = $2', [fake, s.daveOpenId]);
    const before = await auditRows(probe, s.daveOpenId, 'resolve_deny');
    const r = await request(app).get(`${DB_BASE}/tables`).set('Cookie', s.daveCookie);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('ORG_FORBIDDEN');
    const after = await auditRows(probe, s.daveOpenId, 'resolve_deny');
    expect(after).toBeGreaterThan(before);
    // 伪造被挡后 active_org 也清空
    expect(await sessionActiveOrg(probe, s.daveOpenId)).toBeNull();
  });
});
