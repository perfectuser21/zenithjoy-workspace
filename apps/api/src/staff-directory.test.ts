/**
 * staff-directory A30-2 归属唯一退役 + resolveStaffOrg 的单元测试（fake db，无 PG，跑在 L3）。
 * 多组织切换第一刀·Gate 0：一人多企业从非法反转为合法，同一身份出现在多个分组不再报红。
 */
import { describe, it, expect } from 'vitest';
import {
  A30_CHECKS,
  checkStaffDirectory,
  resolveStaffOrg,
  type StaffDirectoryQueryable,
} from './staff-directory';

const ORGA = 'aaaaaaaa-0000-4000-8000-000000000001';
const ORGB = 'bbbbbbbb-0000-4000-8000-000000000002';

/** fake db：STAFF_ORG_MAP 的 uuid 一律当作 tenants 中真实存在（A30-3 通过） */
const okDb: StaffDirectoryQueryable = {
  async query(_sql: string, params?: unknown[]) {
    const ids = (params?.[0] as string[]) ?? [];
    return { rows: ids.map((id) => ({ id })) };
  },
};

describe('A30-2 归属唯一退役', () => {
  it('A30_CHECKS 不再含 A30-2（只剩 A30-1a / A30-1b / A30-3）', () => {
    expect(A30_CHECKS as readonly string[]).toEqual(['A30-1a', 'A30-1b', 'A30-3']);
    expect((A30_CHECKS as readonly string[]).includes('A30-2')).toBe(false);
  });

  it('同一身份出现在两个分组（多组织归属）→ 不再报 A30-2 违规，自检通过', async () => {
    const dave = 'ou_dave';
    const env = {
      STAFF_FEISHU_OPENIDS: dave, // 扁平名单=主企业那一组（A30-1a）
      STAFF_FEISHU_OPENIDS__ORGA: dave,
      STAFF_FEISHU_OPENIDS__ORGB: dave, // dave 同时在 ORGA + ORGB（旧口径会触 A30-2）
      STAFF_ORG_MAP: `ORGA:${ORGA},ORGB:${ORGB}`,
      STAFF_PRIMARY_ORG: 'ORGA',
    };
    const { ok, violations } = await checkStaffDirectory(env, okDb);
    expect(violations).not.toContain('A30-2');
    expect(ok).toBe(true);
  });
});

describe('resolveStaffOrg', () => {
  it('命中分组 → 返回该企业 orgKey + tenantId', () => {
    const env = {
      STAFF_FEISHU_OPENIDS__ORGA: 'ou_dave',
      STAFF_ORG_MAP: `ORGA:${ORGA}`,
    };
    expect(resolveStaffOrg(env, 'ou_dave', '')).toEqual({ orgKey: 'ORGA', tenantId: ORGA });
  });

  it('无归属声明 → null（调用方须 403 NO_ORG_ASSIGNMENT，禁默认组织兜底）', () => {
    expect(resolveStaffOrg({}, 'ou_nobody', '')).toBeNull();
  });
});
