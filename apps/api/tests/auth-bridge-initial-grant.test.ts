/**
 * auth-bridge 注册送积分 —— 真行为验证
 *
 * 守的事情（Task 9，2026-04-29 产品决策"注册即试用"）：
 *   1. free fallback 路径真的调用了 recharge(tenantId, 100, 'initial_grant', ...)。
 *   2. 赠送失败不阻断注册——recharge 抛错时 bridgeNewUserToTenant 仍要正常返回
 *      linked=true（用户能正常登录，余额由运营补发），并留下 error 日志。
 *
 * 第 1 点 tests/auth-bridge.test.ts 已经用同样的 mock 方式断言过一次
 *（见该文件"Task 9"标注的用例），这里不重复展开分支覆盖，只保留一条最小验证
 * 证明本文件本身是可独立运行的真行为测试；第 2 点（赠送失败的容错路径）
 * 是既有文件未覆盖的缺口，是本文件存在的主要理由。
 *
 * mock 方式照抄 tests/auth-bridge.test.ts（同一个模块的既有测试）：
 * 全量 mock db/connection 与 credits.service——auth-bridge.ts 只从
 * credits.service 里 import 了 recharge 一个符号，不需要 importOriginal
 * 部分 mock（那是 tests/credits.test.ts 因为要 import 整个 app.ts、
 * 顶层就要读 CREDIT_COSTS 才需要的写法，这里不适用）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bridgeNewUserToTenant } from '../src/auth-bridge';
import { recharge } from '../src/services/credits.service';

const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();

vi.mock('../src/db/connection', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn(),
    end: vi.fn(),
  },
}));

vi.mock('../src/services/credits.service', () => ({
  recharge: vi.fn(),
}));

import pool from '../src/db/connection';

const mockConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
const mockRecharge = recharge as ReturnType<typeof vi.fn>;

/** free fallback 事务序列：BEGIN → INSERT licenses → INSERT tenants → UPDATE licenses → INSERT tenant_members → COMMIT */
function setupFreeTxMocks(opts: { licenseId?: string; tenantId?: string } = {}) {
  const licenseId = opts.licenseId ?? 'grant-test-lic';
  const tenantId = opts.tenantId ?? 'grant-test-tenant';
  mockClientQuery.mockReset();
  mockClientQuery
    .mockResolvedValueOnce({}) // BEGIN
    .mockResolvedValueOnce({ rows: [{ id: licenseId, license_key: 'ZJ-F-GRANTTEST' }] }) // INSERT licenses
    .mockResolvedValueOnce({ rows: [{ id: tenantId }] }) // INSERT tenants
    .mockResolvedValueOnce({}) // UPDATE licenses tenant_id
    .mockResolvedValueOnce({ rowCount: 1 }) // INSERT tenant_members owner
    .mockResolvedValueOnce({}); // COMMIT
  return { licenseId, tenantId };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClientQuery.mockReset();
  mockClientRelease.mockReset();
  mockConnect.mockResolvedValue({
    query: mockClientQuery,
    release: mockClientRelease,
  });
});

describe('auth-bridge 注册送积分（initial_grant）', () => {
  it('free fallback 建租户成功后真的调用 recharge(tenantId, 100, "initial_grant", ...)', async () => {
    const { tenantId } = setupFreeTxMocks();
    mockRecharge.mockResolvedValueOnce({ balance: 100, total_recharged: 100, total_consumed: 0 });

    const result = await bridgeNewUserToTenant({
      userId: 'grant-test-user',
      licenseKey: undefined,
    });

    expect(result.linked).toBe(true);
    expect(result.reason).toBe('FREE_TENANT_CREATED');
    expect(mockRecharge).toHaveBeenCalledTimes(1);
    expect(mockRecharge).toHaveBeenCalledWith(
      tenantId,
      100,
      'initial_grant',
      expect.any(Object)
    );
  });

  it('赠送失败不阻断注册：recharge reject 时注册仍正常返回 linked=true，并记录 error 日志', async () => {
    const { tenantId } = setupFreeTxMocks({ licenseId: 'grant-fail-lic', tenantId: 'grant-fail-tenant' });
    mockRecharge.mockRejectedValueOnce(new Error('credits service 暂时不可用'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await bridgeNewUserToTenant({
      userId: 'grant-fail-user',
      licenseKey: undefined,
    });

    // 租户/license/member 该建的都建成了——注册主流程不被积分赠送拖垮
    expect(result.linked).toBe(true);
    expect(result.tenantId).toBe(tenantId);
    expect(result.reason).toBe('FREE_TENANT_CREATED');
    expect(mockRecharge).toHaveBeenCalledTimes(1);
    // 失败必须留痕，不能悄悄吞掉
    expect(errSpy).toHaveBeenCalled();
    const loggedInitialGrantFailure = errSpy.mock.calls.some((call) =>
      call.some((arg) => typeof arg === 'string' && /initial_grant/.test(arg))
    );
    expect(loggedInitialGrantFailure).toBe(true);

    errSpy.mockRestore();
  });
});
