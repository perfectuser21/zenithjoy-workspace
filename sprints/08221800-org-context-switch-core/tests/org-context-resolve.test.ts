/**
 * 多组织切换 · 组织解析与选定（A4 缺失+伪造全挡 / A8 单企业零回归 / orgs 列表 / switch-org）
 *
 * 骨干 Step 1（登录看到全部归属企业主动选定）+ 前置门（active_org 缺失/伪造 → 全挡）。
 * 真 Postgres + 真会话 + 真 supertest，禁 mock（合同 ## 禁 mock 边清单）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../apps/api/src/app';
import {
  seedMultiOrg,
  cleanupMultiOrg,
  getOrgs,
  switchOrg,
  DB_BASE,
  type MultiOrgSeed,
} from './_org-fixture';

describe('多组织解析与选定 [BEHAVIOR]', () => {
  let s: MultiOrgSeed;
  beforeAll(async () => {
    s = await seedMultiOrg('org-resolve');
  });
  afterAll(async () => {
    await cleanupMultiOrg(s);
  });

  it('Step1：dave 登录后 GET /orgs 看到全部两家归属企业，未选前 active_org_id=null、needs_selection=true（绝不自动挑）', async () => {
    // dave 已由 seedMultiOrg 登录（active_org 不在登录设，单企业透明/多企业经 switch 设）。
    // GET /orgs：两家、未选、needs_selection=true（这是切换器渲染阻断选择的依据）
    const orgs = await getOrgs(s.daveCookie);
    expect(orgs.status).toBe(200);
    expect(orgs.body.data.orgs).toHaveLength(2);
    expect(orgs.body.data.active_org_id).toBeNull();
    expect(orgs.body.data.needs_selection).toBe(true);
    const orgIds = orgs.body.data.orgs.map((o: { org_id: string }) => o.org_id).sort();
    expect(orgIds).toEqual([s.orgATenantId, s.orgBTenantId].sort());
    // 带企业名（切换器要渲染）
    for (const o of orgs.body.data.orgs) {
      expect(typeof o.name).toBe('string');
      expect(o.name.length).toBeGreaterThan(0);
    }
  });

  it('A4 缺失：≥2 家未选 active_org → 调数据端点全挡 409 ORG_SELECTION_REQUIRED（要求先选，非静默取一个）', async () => {
    const r = await request(app).get(`${DB_BASE}/tables`).set('Cookie', s.daveCookie);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ORG_SELECTION_REQUIRED');
    expect(r.body.data).toBeNull();
  });

  it('选定 A 后：GET /orgs active_org_id=A、needs_selection=false；数据端点放行 200', async () => {
    const sw = await switchOrg(s.daveCookie, s.orgATenantId);
    expect(sw.status).toBe(200);
    expect(sw.body.data.active_org_id).toBe(s.orgATenantId);

    const orgs = await getOrgs(s.daveCookie);
    expect(orgs.body.data.active_org_id).toBe(s.orgATenantId);
    expect(orgs.body.data.needs_selection).toBe(false);

    const tables = await request(app).get(`${DB_BASE}/tables`).set('Cookie', s.daveCookie);
    expect(tables.status).toBe(200);
    expect(tables.body.success).toBe(true);
  });

  it('A4 伪造：switch-org 到不归属的企业 → 403 ORG_FORBIDDEN，绝不切换（切换被拒后当前企业不变）', async () => {
    // 先把 dave 选定到 A（本用例自足，不依赖前面用例的执行顺序）
    await switchOrg(s.daveCookie, s.orgATenantId);
    // dave 归属 A/B 两家；构造一个 dave 绝不归属的 org = 新建的第三家企业
    const third = await s.client.query(
      "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ($1, $2, 'free') RETURNING id::text AS id",
      [`org-resolve-C-${s.sfx}`, `org-lk-c-${s.sfx}`]
    );
    const thirdOrgId = third.rows[0].id as string;

    const sw = await switchOrg(s.daveCookie, thirdOrgId);
    expect(sw.status).toBe(403);
    expect(sw.body.error.code).toBe('ORG_FORBIDDEN');

    // 切换被拒后当前企业仍是 A（切换非原子失败/越权都不得改变 active_org）
    const orgs = await getOrgs(s.daveCookie);
    expect(orgs.body.data.active_org_id).toBe(s.orgATenantId);

    await s.client.query('DELETE FROM zenithjoy.tenants WHERE id = $1::uuid', [thirdOrgId]);
  });

  it('A8 单企业零回归：alice 单企业账号 → active_org_id 直接=那一家、needs_selection=false、数据端点无需选择即放行', async () => {
    const orgs = await getOrgs(s.aliceCookie);
    expect(orgs.status).toBe(200);
    expect(orgs.body.data.orgs).toHaveLength(1);
    expect(orgs.body.data.active_org_id).toBe(s.orgATenantId);
    expect(orgs.body.data.needs_selection).toBe(false);

    // 全链读写无 active_org 强制选择步骤（透明进入）
    const tables = await request(app).get(`${DB_BASE}/tables`).set('Cookie', s.aliceCookie);
    expect(tables.status).toBe(200);
    expect(tables.body.success).toBe(true);
  });
});
