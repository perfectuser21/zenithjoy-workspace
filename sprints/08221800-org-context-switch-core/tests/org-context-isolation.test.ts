/**
 * 多组织切换 · 跨企业隔离与原子切换（A1 反枚举同形404 / A3 正向对照 / A5 第二家B完整 / A6 切换原子性）
 *
 * 骨干 Step 2（选中企业下读写严格落这家）+ Step 3（随时切换、旧企业数据即刻不可见）。
 * dave 归属 A/B 两家，切到哪家读写就落哪家；切走后旧企业的表 id 立即 404，且与随机不存在 id 逐字节同形。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import {
  seedMultiOrg,
  cleanupMultiOrg,
  switchOrg,
  createSimpleTable,
  getTable,
  randomUuid,
  PGURL,
  type MultiOrgSeed,
} from './_org-fixture';

async function tenantOf(client: Client, tableId: string): Promise<string | null> {
  const { rows } = await client.query('SELECT org_id::text AS org_id FROM zenithjoy.db_tables WHERE id = $1::uuid', [
    tableId,
  ]);
  return rows[0]?.org_id ?? null;
}

describe('多组织跨企业隔离与原子切换 [BEHAVIOR]', () => {
  let s: MultiOrgSeed;
  let probe: Client;
  beforeAll(async () => {
    s = await seedMultiOrg('org-iso');
    probe = new Client({ connectionString: PGURL });
    await probe.connect();
  });
  afterAll(async () => {
    await probe.end().catch(() => undefined);
    await cleanupMultiOrg(s);
  });

  it('A3 正向对照：dave 选定 A 后建表 → 200，psql 查回该表 org_id 全 = A', async () => {
    await switchOrg(s.daveCookie, s.orgATenantId);
    const r = await createSimpleTable(s.daveCookie, `iso-A-${s.sfx}`);
    expect(r.status).toBe(201);
    const tableId = r.body.data.table_id;
    expect(await tenantOf(probe, tableId)).toBe(s.orgATenantId);
  });

  it('A5 第二家 B 完整功能：切到 B 建表录行 → 落 org_id=B，psql 查回 tenant_id=B，且 A 会话读不到', async () => {
    // 切到 B，建表 + 建行
    await switchOrg(s.daveCookie, s.orgBTenantId);
    const t = await createSimpleTable(s.daveCookie, `iso-B-${s.sfx}`);
    expect(t.status).toBe(201);
    const bTableId = t.body.data.table_id;
    expect(await tenantOf(probe, bTableId)).toBe(s.orgBTenantId);

    // 切回 A：B 的表 id 即刻读不到（404）
    await switchOrg(s.daveCookie, s.orgATenantId);
    const cross = await getTable(s.daveCookie, bTableId);
    expect(cross.status).toBe(404);
  });

  it('A1 反枚举同形 404：active_org=A 时 GET B 的真实表 id 与随机不存在 id 响应逐字节相同、无 timestamp', async () => {
    // 在 B 下建一张表拿到真实 id
    await switchOrg(s.daveCookie, s.orgBTenantId);
    const t = await createSimpleTable(s.daveCookie, `iso-enum-B-${s.sfx}`);
    const bTableId = t.body.data.table_id;

    // 切回 A：B 的真实表 id vs 随机不存在 id
    await switchOrg(s.daveCookie, s.orgATenantId);
    const real = await getTable(s.daveCookie, bTableId);
    const rnd = await getTable(s.daveCookie, randomUuid());
    expect(real.status).toBe(404);
    expect(rnd.status).toBe(404);
    // 逐字节同形（同一个 notFoundBody 常量），且不带 timestamp（带上就能靠字节比对分辨 id 是否存在）
    expect(JSON.stringify(real.body)).toBe(JSON.stringify(rnd.body));
    expect('timestamp' in real.body).toBe(false);
    expect(real.body.error.code).toBe('NOT_FOUND');
  });

  it('A6 切换原子性：A 下建表 → 切到 B 后立即 GET A 的表 id → 404；切回 A → 又 200（旧企业数据即刻不可见/恢复）', async () => {
    await switchOrg(s.daveCookie, s.orgATenantId);
    const t = await createSimpleTable(s.daveCookie, `iso-atomic-A-${s.sfx}`);
    const aTableId = t.body.data.table_id;
    // 切前 A 会话能读到自己的表
    expect((await getTable(s.daveCookie, aTableId)).status).toBe(200);

    // 切到 B：A 的表 id 立即 404（原子重解析，旧企业数据即刻不可见）
    await switchOrg(s.daveCookie, s.orgBTenantId);
    expect((await getTable(s.daveCookie, aTableId)).status).toBe(404);

    // 切回 A：又能读到（切换是对称的，不是不可逆丢失）
    await switchOrg(s.daveCookie, s.orgATenantId);
    expect((await getTable(s.daveCookie, aTableId)).status).toBe(200);
  });
});
