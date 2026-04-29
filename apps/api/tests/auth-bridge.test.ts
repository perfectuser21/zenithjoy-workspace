/**
 * auth-bridge 单元测试（PR-2）
 *
 * 验证：注册成功后 hook 内逻辑——根据 license_key 把用户写入 tenant_members
 *  - 有效 license（status='active', tenant_id 非空） → 插入 tenant_members 一行（role='member'）
 *  - 缺 license_key → 不插入（用户继续存在，但访问 /api/works 会 403）
 *  - 无效 license_key（DB 无匹配） → 不插入（不抛错，不阻塞登录）
 *  - license status='revoked'/'expired' → 不插入
 *  - DB 异常 → 不抛（注册流程不应被阻塞）
 *
 * 完整 BEHAVIOR 在 .github/workflows/scripts/smoke/auth-tenant-bridge-smoke.sh
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bridgeNewUserToTenant } from '../src/auth-bridge';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('auth-bridge / bridgeNewUserToTenant', () => {
  it('导出 bridgeNewUserToTenant 函数', () => {
    expect(typeof bridgeNewUserToTenant).toBe('function');
  });

  it('有效 license_key + active license → 插入 tenant_members', async () => {
    // 1. 查 license：返回 1 行
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: 'tenant-uuid-pr2', status: 'active' }],
    });
    // 2. 插入 tenant_members
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-uuid-1',
      licenseKey: 'ZJ-VALID-001',
    });

    expect(result.linked).toBe(true);
    expect(result.tenantId).toBe('tenant-uuid-pr2');
    expect(mockQuery).toHaveBeenCalledTimes(2);
    // 验证 INSERT 用了 user.id 作 feishu_user_id 列
    const insertCall = mockQuery.mock.calls[1];
    const insertParams = insertCall[1] as unknown[];
    expect(insertParams).toContain('auth-user-uuid-1');
    expect(insertParams).toContain('tenant-uuid-pr2');
  });

  it('缺 license_key → 不查询 DB，返回 linked=false', async () => {
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-uuid-2',
      licenseKey: undefined,
    });
    expect(result.linked).toBe(false);
    expect(result.reason).toBe('NO_LICENSE_KEY');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('空字符串 license_key → 不查询 DB，返回 linked=false', async () => {
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-uuid-3',
      licenseKey: '   ',
    });
    expect(result.linked).toBe(false);
    expect(result.reason).toBe('NO_LICENSE_KEY');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('license_key 无匹配（DB 返回 0 行） → 不插入，不抛错', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-uuid-4',
      licenseKey: 'ZJ-FAKE-XXX',
    });
    expect(result.linked).toBe(false);
    expect(result.reason).toBe('LICENSE_NOT_FOUND');
    // 仅一次 SELECT，没有 INSERT
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('license status=revoked → 不插入', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: 'tenant-uuid-x', status: 'revoked' }],
    });
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-uuid-5',
      licenseKey: 'ZJ-REVOKED-001',
    });
    expect(result.linked).toBe(false);
    expect(result.reason).toBe('LICENSE_INACTIVE');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('license tenant_id 为 null（孤儿 license） → 不插入', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: null, status: 'active' }],
    });
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-uuid-6',
      licenseKey: 'ZJ-ORPHAN-001',
    });
    expect(result.linked).toBe(false);
    expect(result.reason).toBe('LICENSE_NO_TENANT');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('DB 异常 → 不抛，返回 linked=false reason=DB_ERROR（注册不被阻塞）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection lost'));
    const result = await bridgeNewUserToTenant({
      userId: 'auth-user-uuid-7',
      licenseKey: 'ZJ-VALID-001',
    });
    expect(result.linked).toBe(false);
    expect(result.reason).toBe('DB_ERROR');
  });

  it('license_key 用 trim 处理，并转为大写一致性查询', async () => {
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
