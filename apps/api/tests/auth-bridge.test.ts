/**
 * auth-bridge 单元测试（PR-2 + PR-B）
 *
 * 验证：注册成功后 hook 内逻辑
 *
 * PR-2 行为：根据 license_key 把用户写入 tenant_members
 *  - 有效 license（status='active', tenant_id 非空） → 插入 tenant_members 一行（role='member'）
 *  - license status='revoked'/'expired'/缺 tenant → 走 free fallback（PR-B 新行为）
 *
 * PR-B 行为（2026-04-29）：注册即试用 — 无 license_key 或 license 无效 → 自动创建 free
 *  - 无 license_key → 创建 free license（tier='free', max_machines=0, customer_id=userId）
 *    + free tenant（plan='free', license_key 同上） + tenant_members(role='owner')
 *  - 无效 license_key（DB 无匹配） → 同上 fallback
 *  - license inactive / 无 tenant → 同上 fallback
 *  - 事务包裹（pool.connect → BEGIN/COMMIT），任意一步失败回滚
 *  - DB 异常 → 不抛（注册流程不应被阻塞），返回 reason='DB_ERROR'
 *
 * 完整 BEHAVIOR：
 *   .github/workflows/scripts/smoke/auth-tenant-bridge-smoke.sh（PR-2）
 *   .github/workflows/scripts/smoke/free-tier-onboarding-smoke.sh（PR-B）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bridgeNewUserToTenant } from '../src/auth-bridge';
import pool from '../src/db/connection';

const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();

vi.mock('../src/db/connection', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn(),
    end: vi.fn(),
  },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;
const mockConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockClientQuery.mockReset();
  mockClientRelease.mockReset();
  // 默认 connect 返回伪 client（free fallback 路径会用到）
  mockConnect.mockResolvedValue({
    query: mockClientQuery,
    release: mockClientRelease,
  });
});

describe('auth-bridge / bridgeNewUserToTenant — PR-2 paid path', () => {
  it('导出 bridgeNewUserToTenant 函数', () => {
    expect(typeof bridgeNewUserToTenant).toBe('function');
  });

  it('有效 license_key + active license + 有 tenant_id → 插入 tenant_members + 回填 licenses.customer_id', async () => {
    // 1. 查 license：返回 1 行
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: 'tenant-uuid-pr2', status: 'active' }],
    });
    // 2. 插入 tenant_members
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // 3. 回填 licenses.customer_id（Gap2 修复：付费注册必须把 license 绑到该 user，
    //    否则 install-pack/download 与 /account/me 按 customer_id 查不到 → 503 NO_ACTIVE_LICENSE）
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-uuid-1',
      licenseKey: 'ZJ-VALID-001',
    });

    expect(result.linked).toBe(true);
    expect(result.tenantId).toBe('tenant-uuid-pr2');
    expect(result.reason).toBe('PAID_TENANT_LINKED');
    expect(mockQuery).toHaveBeenCalledTimes(3);
    // 验证 INSERT 用了 user.id 作 feishu_user_id 列
    const insertCall = mockQuery.mock.calls[1];
    const insertParams = insertCall[1] as unknown[];
    expect(insertParams).toContain('auth-user-uuid-1');
    expect(insertParams).toContain('tenant-uuid-pr2');
    // Gap4：带 license 注册自己租户的人 = 租户主人 → role 必须是 owner（否则配不了自己客服机：
    //   cs/setup 要 owner/admin，member 过不了 requireCsWriteAccess/requireCsAdmin）。与 free 路径一致。
    expect(insertParams).toContain('owner');
    expect(insertParams).not.toContain('member');
    // Gap2：第 3 条 UPDATE licenses SET customer_id=userId WHERE license_key=...
    const updateCall = mockQuery.mock.calls[2];
    const updateSql = updateCall[0] as string;
    const updateParams = updateCall[1] as unknown[];
    expect(updateSql).toMatch(/UPDATE\s+zenithjoy\.licenses/i);
    expect(updateSql).toMatch(/customer_id/i);
    expect(updateParams).toContain('auth-user-uuid-1');
    expect(updateParams).toContain('ZJ-VALID-001');
    // paid 路径不开事务
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('Gap4：不传 role 时付费路径默认 owner（调用方 auth.ts 未传 role，必须默认 owner 而非 member）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: 'tenant-gap4', status: 'active' }],
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // tenant_members
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // customer_id 回填
    // 模拟真实调用方 auth.ts:97 —— 只传 userId/email/licenseKey，不传 role
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-gap4',
      email: 'gap4@test',
      licenseKey: 'ZJ-VALID-004',
    });
    expect(result.linked).toBe(true);
    expect(result.reason).toBe('PAID_TENANT_LINKED');
    const insertParams = mockQuery.mock.calls[1][1] as unknown[];
    expect(insertParams).toContain('owner');
    expect(insertParams).not.toContain('member');
  });

  it('Gap4：显式传 role=admin 时尊重该 role（管理员也能配客服机；不强制覆盖成 owner）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: 'tenant-gap4b', status: 'active' }],
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-gap4b',
      licenseKey: 'ZJ-VALID-005',
      role: 'admin',
    });
    expect(result.linked).toBe(true);
    const insertParams = mockQuery.mock.calls[1][1] as unknown[];
    expect(insertParams).toContain('admin');
  });

  it('Gap2：customer_id 回填 DB 异常时不翻车（member 已写成功仍 linked=true）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: 'tenant-uuid-idem', status: 'active' }],
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // tenant_members
    mockQuery.mockRejectedValueOnce(new Error('update failed')); // customer_id 回填失败
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-idem',
      licenseKey: 'ZJ-VALID-IDEM',
    });
    expect(result.linked).toBe(true);
    expect(result.tenantId).toBe('tenant-uuid-idem');
    expect(result.reason).toBe('PAID_TENANT_LINKED');
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('license_key 用 trim 处理后查询', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: 'tenant-uuid-trim', status: 'active' }],
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-uuid-8',
      licenseKey: '  ZJ-VALID-001  ',
    });
    expect(result.linked).toBe(true);
    const selectParams = mockQuery.mock.calls[0][1] as unknown[];
    expect(selectParams[0]).toBe('ZJ-VALID-001');
  });
});

describe('auth-bridge / bridgeNewUserToTenant — PR-B free fallback', () => {
  /**
   * 共享设置：mock client.query 按事务序列响应
   *   1. BEGIN
   *   2. INSERT licenses (tenant_id NULL) → returning id
   *   3. INSERT tenants → returning id
   *   4. UPDATE licenses SET tenant_id
   *   5. INSERT tenant_members owner
   *   6. COMMIT
   */
  function setupFreeTxMocks(opts: {
    licenseId?: string;
    tenantId?: string;
  } = {}) {
    const licenseId = opts.licenseId ?? 'free-lic-uuid-A';
    const tenantId = opts.tenantId ?? 'free-tenant-uuid-A';
    mockClientQuery.mockReset();
    // 顺序匹配实现里的 query 序列
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: licenseId, license_key: 'ZJ-F-XXXXXXXX' }] }) // INSERT licenses
      .mockResolvedValueOnce({ rows: [{ id: tenantId }] }) // INSERT tenants
      .mockResolvedValueOnce({}) // UPDATE licenses tenant_id
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT tenant_members owner
      .mockResolvedValueOnce({}); // COMMIT
    return { licenseId, tenantId };
  }

  it('缺 license_key → 走 free fallback（事务创建 license + tenant + owner member）', async () => {
    const { licenseId, tenantId } = setupFreeTxMocks();
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-free-1',
      licenseKey: undefined,
    });
    expect(result.linked).toBe(true);
    expect(result.tenantId).toBe(tenantId);
    expect(result.reason).toBe('FREE_TENANT_CREATED');
    // 校验事务序列
    expect(mockConnect).toHaveBeenCalledTimes(1);
    const calls = mockClientQuery.mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatch(/BEGIN/i);
    expect(calls[5]).toMatch(/COMMIT/i);
    // INSERT licenses 必须传 tier='free' max_machines=1 customer_id=userId
    // 2026-05-07 walking-skeleton-1：free 从 0 → 1（注册即试用 1 台 Agent）
    const licInsertParams = mockClientQuery.mock.calls[1][1] as unknown[];
    expect(licInsertParams).toContain('free'); // tier
    expect(licInsertParams).toContain(1); // max_machines
    expect(licInsertParams).toContain('auth-user-free-1'); // customer_id
    // UPDATE licenses 把 tenant_id 写回到 license_id
    const updateParams = mockClientQuery.mock.calls[3][1] as unknown[];
    expect(updateParams).toContain(tenantId);
    expect(updateParams).toContain(licenseId);
    // INSERT tenant_members role='owner'
    const memberParams = mockClientQuery.mock.calls[4][1] as unknown[];
    expect(memberParams).toContain('owner');
    expect(memberParams).toContain('auth-user-free-1');
    expect(memberParams).toContain(tenantId);
    expect(mockClientRelease).toHaveBeenCalled();
  });

  it('空字符串 license_key → 走 free fallback', async () => {
    setupFreeTxMocks();
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-free-2',
      licenseKey: '   ',
    });
    expect(result.linked).toBe(true);
    expect(result.reason).toBe('FREE_TENANT_CREATED');
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('license_key 无匹配（DB 返回 0 行） → fallback 创建 free', async () => {
    // SELECT licenses → 0 行
    mockQuery.mockResolvedValueOnce({ rows: [] });
    setupFreeTxMocks();
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-free-3',
      licenseKey: 'ZJ-FAKE-XXX',
    });
    expect(result.linked).toBe(true);
    expect(result.reason).toBe('FREE_TENANT_CREATED');
  });

  it('license status=revoked → fallback 创建 free', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: 'tenant-uuid-x', status: 'revoked' }],
    });
    setupFreeTxMocks();
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-free-4',
      licenseKey: 'ZJ-REVOKED-001',
    });
    expect(result.linked).toBe(true);
    expect(result.reason).toBe('FREE_TENANT_CREATED');
  });

  it('license tenant_id null（孤儿） → fallback 创建 free', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: null, status: 'active' }],
    });
    setupFreeTxMocks();
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-free-5',
      licenseKey: 'ZJ-ORPHAN-001',
    });
    expect(result.linked).toBe(true);
    expect(result.reason).toBe('FREE_TENANT_CREATED');
  });

  it('事务中段失败 → ROLLBACK 释放 client，返回 DB_ERROR（不抛）', async () => {
    mockClientQuery.mockReset();
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'lic-x', license_key: 'ZJ-F-AAAAAAAA' }] }) // INSERT licenses
      .mockRejectedValueOnce(new Error('connection lost')) // INSERT tenants 失败
      .mockResolvedValueOnce({}); // ROLLBACK

    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-free-err',
      licenseKey: undefined,
    });
    expect(result.linked).toBe(false);
    expect(result.reason).toBe('DB_ERROR');
    // 必须执行 ROLLBACK + release
    const calls = mockClientQuery.mock.calls.map((c) => c[0]);
    expect(calls.some((q: string) => /ROLLBACK/i.test(q))).toBe(true);
    expect(mockClientRelease).toHaveBeenCalled();
  });

  it('paid 查 license DB 异常 → 不走 fallback，返回 DB_ERROR（保守）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection lost'));
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-paid-err',
      licenseKey: 'ZJ-VALID-001',
    });
    expect(result.linked).toBe(false);
    expect(result.reason).toBe('DB_ERROR');
    // 不应触发 fallback 事务
    expect(mockConnect).not.toHaveBeenCalled();
  });
});
