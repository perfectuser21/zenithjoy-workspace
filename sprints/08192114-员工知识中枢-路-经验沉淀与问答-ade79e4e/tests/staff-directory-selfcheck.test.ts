/**
 * A30 员工目录一致性自检 —— 四项 + 四条变异（proven-to-fire）
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：
 *   - 不 mock 员工目录解析，直接调真模块；
 *   - A30-3（STAFF_ORG_MAP uuid 在 tenants 中存在）需真 Postgres，不得 stub 查询结果。
 *
 * TDD Red：apps/api/src/staff-directory.ts 尚不存在，本文件全红。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
// @ts-expect-error 模块尚未实现（TDD Red 阶段），实现后删除本行
import { checkStaffDirectory } from '../../../apps/api/src/staff-directory';

const PGURL = process.env.E2E_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/cecelia';

const ORGA_OPENID = 'ou_unit_orga';
const ORGB_OPENID = 'ou_unit_orgb';
const ORGA_EMAIL = 'unit-orga@zenithjoy.local';

let client: Client;
let orgATenantId = '';
let orgBTenantId = '';

beforeAll(async () => {
  client = new Client({ connectionString: PGURL });
  await client.connect();
  const a = await client.query(
    "INSERT INTO zenithjoy.tenants (name, plan) VALUES ('UNIT-A-'||substr(md5(random()::text),1,8), 'free') RETURNING id"
  );
  const b = await client.query(
    "INSERT INTO zenithjoy.tenants (name, plan) VALUES ('UNIT-B-'||substr(md5(random()::text),1,8), 'free') RETURNING id"
  );
  orgATenantId = a.rows[0].id;
  orgBTenantId = b.rows[0].id;
});

afterAll(async () => {
  if (client) {
    await client.query('DELETE FROM zenithjoy.tenants WHERE id = ANY($1)', [[orgATenantId, orgBTenantId]]);
    await client.end();
  }
});

function baseEnv() {
  return {
    STAFF_EMAILS: ORGA_EMAIL,
    STAFF_FEISHU_OPENIDS: ORGA_OPENID,
    STAFF_EMAILS__ORGA: ORGA_EMAIL,
    STAFF_FEISHU_OPENIDS__ORGA: ORGA_OPENID,
    STAFF_FEISHU_OPENIDS__ORGB: ORGB_OPENID,
    STAFF_ORG_MAP: `ORGA:${orgATenantId},ORGB:${orgBTenantId}`,
  };
}

describe('员工目录一致性自检 A30 [BEHAVIOR]', () => {
  it('四项全部成立时自检通过', async () => {
    const result = await checkStaffDirectory(baseEnv(), client);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('A30-1a 扁平等于企业A分组 —— 分组里多一个不在扁平里的人即报红', async () => {
    const env = { ...baseEnv(), STAFF_FEISHU_OPENIDS__ORGA: `${ORGA_OPENID},ou_unit_ghost` };
    const result = await checkStaffDirectory(env, client);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('A30-1a');
  });

  it('A30-1b 分组并集包含扁平 —— 扁平里多一个不在任何分组里的人即报红', async () => {
    const env = { ...baseEnv(), STAFF_FEISHU_OPENIDS: `${ORGA_OPENID},ou_unit_orphan` };
    const result = await checkStaffDirectory(env, client);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('A30-1b');
  });

  it('A30-2 归属唯一 —— 同一人被声明在两家企业即报红', async () => {
    const env = { ...baseEnv(), STAFF_FEISHU_OPENIDS__ORGB: `${ORGB_OPENID},${ORGA_OPENID}` };
    const result = await checkStaffDirectory(env, client);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('A30-2');
  });

  it('A30-3 STAFF_ORG_MAP uuid 在 tenants 中存在 —— 指向库里不存在的 uuid 即报红', async () => {
    const env = {
      ...baseEnv(),
      STAFF_ORG_MAP: `ORGA:00000000-0000-4000-8000-000000000000,ORGB:${orgBTenantId}`,
    };
    const result = await checkStaffDirectory(env, client);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('A30-3');
  });
});
