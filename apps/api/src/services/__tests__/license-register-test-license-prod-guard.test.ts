/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P0 修复 — 测试 license 禁止在生产环境注册（Brain issue 88d15763）
 *
 * 背景（2026-07-30 真机验证车道调试）：
 *   同一个测试 license (ZJ-F-K3MYP4VR) + 同一个测试租户 (455a8ca9-...) 在生产库
 *   zenithjoy 和 staging 库 zenithjoy_staging 里各自播种了一份（id 不同、tier 不同）。
 *   registerAgent() 之前没有任何环境校验：一台配置错误、心跳误连到生产的测试设备，
 *   拿这个 license 走标准 /api/agent/register 也会"注册成功"，完全没有信号能让人
 *   发现连错了环境。
 *
 * 修复：licenses 表新增 is_test 列（见迁移 20260730_120000_licenses_add_is_test_flag.sql）。
 * registerAgent() 在拿到 license 行后立刻检查：is_test=true 且 NODE_ENV=production
 * → 直接拒绝（TEST_LICENSE_IN_PRODUCTION），不再往下跑配额/装机逻辑。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../../db/connection';
import { registerAgent } from '../license.service';

const TEST_LICENSE_ROW = {
  id: 'lic-test-uuid',
  license_key: 'ZJ-F-K3MYP4VR',
  tier: 'free',
  max_machines: 999,
  status: 'active',
  expires_at: new Date(Date.now() + 86400_000 * 3650),
  is_test: true,
};

const REAL_LICENSE_ROW = {
  id: 'lic-real-uuid',
  license_key: 'ZJ-M-REALCUST',
  tier: 'matrix',
  max_machines: 3,
  status: 'active',
  expires_at: new Date(Date.now() + 86400_000 * 365),
  is_test: false,
};

describe('registerAgent — 生产环境拒绝 is_test license [Brain issue 88d15763]', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
    // vi.stubEnv 而不是直接赋值 process.env.NODE_ENV：直接赋值在恢复时若原值是
    // undefined 会把 process.env.NODE_ENV 错误地设成字符串 "undefined"（Node.js
    // 经典坑：process.env 的属性只能是字符串，赋 undefined 会被强转成 "undefined"），
    // 且这个全局 mutation 在 vitest threads pool 下会跨文件泄漏，污染同一 worker
    // 里后跑的其他测试文件（曾实测把 agent-burner-invalidate.test.ts 带挂）。
    // vi.stubEnv + afterEach(vi.unstubAllEnvs) 是 vitest 官方推荐的安全写法。
    vi.stubEnv('LICENSE_HMAC_SECRET', 'test-only-hmac-secret-16chars-min');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('生产环境 + is_test license → 拒绝，且不再往下发起配额/装机查询', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [TEST_LICENSE_ROW] } as any); // findLicenseByKey

    const result = await registerAgent({
      license_key: 'ZJ-F-K3MYP4VR',
      machine_id: 'some-prod-misconfigured-device',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TEST_LICENSE_IN_PRODUCTION');
      expect(result.error).toBe('TEST_LICENSE_IN_PRODUCTION');
    }
    // 关键：拒绝必须发生在第一次 findLicenseByKey 查询之后就短路，
    // 不应该再查 license_machines / count / INSERT agents 等（防止仍留下装机记录）。
    expect(vi.mocked(pool.query).mock.calls.length).toBe(1);
  });

  it('非生产环境（staging/dev/test）+ is_test license → 照常放行', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [TEST_LICENSE_ROW] } as any) // findLicenseByKey
      .mockResolvedValueOnce({ rows: [] } as any) // existing machine lookup
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any) // count active machines
      .mockResolvedValueOnce({ rows: [] } as any) // insert license_machines
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-uuid' }] } as any) // tenant lookup
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid' }] } as any); // upsert agent

    const result = await registerAgent({
      license_key: 'ZJ-F-K3MYP4VR',
      machine_id: 'staging-device',
    });

    expect(result.ok).toBe(true);
  });

  it('生产环境 + 非 is_test（真实客户）license → 照常放行（不能误伤真客户）', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [REAL_LICENSE_ROW] } as any) // findLicenseByKey
      .mockResolvedValueOnce({ rows: [] } as any) // existing machine lookup
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any) // count active machines
      .mockResolvedValueOnce({ rows: [] } as any) // insert license_machines
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-uuid' }] } as any) // tenant lookup
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid' }] } as any); // upsert agent

    const result = await registerAgent({
      license_key: 'ZJ-M-REALCUST',
      machine_id: 'real-customer-device',
    });

    expect(result.ok).toBe(true);
  });
});
