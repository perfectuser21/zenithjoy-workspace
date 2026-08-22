/**
 * 多组织切换 · A12 active_org 维度启动自检（真库双向）
 *
 * 反转后的启动闸：多组织成员合法（不再拒启动），但前提是 active_org 维度已部署（session.activeOrg 列）。
 *   - 多组织成员 + 维度齐备（真 session 表有 activeOrg 列）→ 正常通过；
 *   - 多组织成员 + 维度缺失（指向一张没有 activeOrg 列的临时表）→ 拒绝启动（抛 ActiveOrgDimensionError）。
 *
 * 真 Postgres（禁 mock，合同禁 mock 边：不 stub 成员表 / information_schema）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import {
  assertActiveOrgDimensionReady,
  ActiveOrgDimensionError,
} from '../../../apps/api/src/startup/single-org-selfcheck';
import { seedMultiOrg, cleanupMultiOrg, PGURL, type MultiOrgSeed } from './_org-fixture';

describe('A12 active_org 维度启动自检（真库双向）[BEHAVIOR]', () => {
  let s: MultiOrgSeed;
  let pool: Pool;
  beforeAll(async () => {
    s = await seedMultiOrg('org-dim');
    pool = new Pool({ connectionString: PGURL });
    // 无 activeOrg 列的临时 session 表，用于验证"维度缺失 → 拒绝启动"
    await pool.query(
      'CREATE TABLE IF NOT EXISTS public.session_nodim_test (id text primary key, "userId" text, token text)'
    );
  });
  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS public.session_nodim_test').catch(() => undefined);
    await pool.end().catch(() => undefined);
    await cleanupMultiOrg(s);
  });

  it('多组织成员存在 + 维度齐备（真 session 表有 activeOrg 列）→ 正常通过，不抛', async () => {
    // dave 是多组织成员（seedMultiOrg 保证），真 session 表已由 20260823 migration 加了 activeOrg 列
    await expect(assertActiveOrgDimensionReady(pool)).resolves.toBeUndefined();
  });

  it('多组织成员存在 + 维度缺失（指向无 activeOrg 列的表）→ 拒绝启动，抛 ActiveOrgDimensionError 且点名标签', async () => {
    await expect(
      assertActiveOrgDimensionReady(pool, { sessionTable: 'session_nodim_test' })
    ).rejects.toThrow(ActiveOrgDimensionError);
    await expect(
      assertActiveOrgDimensionReady(pool, { sessionTable: 'session_nodim_test' })
    ).rejects.toThrow(/A12-DIMENSION-MISSING/);
  });
});
