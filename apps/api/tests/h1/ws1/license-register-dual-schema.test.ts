/**
 * WS1 RED tests — license-register dual schema + LICENSE_DEVICE_LIMIT_EXCEEDED
 *
 * 当前实现 (apps/api/src/services/license.service.ts) 的 RegisterSuccess 仅含老字段
 * (ok/license_id/tier/max_machines/registered_machine_id/ws_token)，
 * 没有新字段 (success/agent_id/license_tier/device_count/device_limit)。
 * 这些测试在实现前**必须 RED**。
 *
 * 不直跑 DB（用 mock pool），保 generator commit-1 可在无 DB 环境跑。
 * 真 DB 行为靠 contract-dod-ws1.md BEHAVIOR manual:bash 验。
 */
import { describe, it, expect, vi } from 'vitest';

import type {
  RegisterSuccess as _RegisterSuccess,
  RegisterFailure as _RegisterFailure,
} from '../../../src/services/license.service';

describe('WS1 — license register dual schema [BEHAVIOR]', () => {
  it('RegisterSuccess type 应含新字段 success / agent_id / license_tier / device_count / device_limit', () => {
    const sample: _RegisterSuccess = {
      ok: true,
      license_id: 'l-1',
      tier: 'free',
      max_machines: 1,
      registered_machine_id: 'm-1',
      ws_token: 't',
      success: true,
      agent_id: '00000000-0000-0000-0000-000000000000',
      license_tier: 'free',
      device_count: 1,
      device_limit: 1,
    } as _RegisterSuccess;
    expect(sample.success).toBe(true);
    expect(sample.device_count).toBe(1);
    expect(sample.device_limit).toBe(1);
    expect(sample.license_tier).toBe('free');
    expect(sample.agent_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('RegisterFailure type 应含新字段 success / error / current_count / limit', () => {
    const sample: _RegisterFailure = {
      ok: false,
      code: 'QUOTA_EXCEEDED',
      message: '装机数已达上限 1',
      success: false,
      error: 'LICENSE_DEVICE_LIMIT_EXCEEDED',
      current_count: 1,
      limit: 1,
    } as _RegisterFailure;
    expect(sample.success).toBe(false);
    expect(sample.error).toBe('LICENSE_DEVICE_LIMIT_EXCEEDED');
    expect(sample.current_count).toBe(1);
    expect(sample.limit).toBe(1);
  });

  it('registerAgent 第 1 个新 machine 返 device_count=1 + device_limit=1 + UUID agent_id', async () => {
    vi.resetModules();
    vi.doMock('../../../src/db/connection', () => ({
      default: {
        query: vi.fn(async (sql: string) => {
          if (/FROM zenithjoy\.licenses/.test(sql))
            return {
              rows: [
                {
                  id: 'l1',
                  license_key: 'ZJ-F-AAAAAAAA',
                  tier: 'free',
                  max_machines: 1,
                  status: 'active',
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                },
              ],
            };
          if (/SELECT \* FROM zenithjoy\.license_machines\s+WHERE license_id/.test(sql))
            return { rows: [] };
          if (/SELECT COUNT/i.test(sql)) return { rows: [{ count: '0' }] };
          if (/INSERT INTO zenithjoy\.license_machines/.test(sql))
            return { rows: [] };
          if (/INSERT INTO zenithjoy\.agents/.test(sql))
            return { rows: [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }] };
          if (/FROM zenithjoy\.agents/.test(sql))
            return { rows: [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }] };
          return { rows: [] };
        }),
      },
    }));
    const mod = await import('../../../src/services/license.service');
    const result = await mod.registerAgent({
      license_key: 'ZJ-F-AAAAAAAA',
      machine_id: 'm-1',
      hostname: 'h-1',
      version: '0.1.0',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('register should succeed');
    expect((result as any).success).toBe(true);
    expect((result as any).device_count).toBe(1);
    expect((result as any).device_limit).toBe(1);
    expect((result as any).license_tier).toBe('free');
    expect((result as any).agent_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('registerAgent 第 2 个新 machine 撞 limit 时返 error=LICENSE_DEVICE_LIMIT_EXCEEDED + current_count + limit', async () => {
    vi.resetModules();
    vi.doMock('../../../src/db/connection', () => ({
      default: {
        query: vi.fn(async (sql: string) => {
          if (/FROM zenithjoy\.licenses/.test(sql))
            return {
              rows: [
                {
                  id: 'l1',
                  license_key: 'ZJ-F-BBBBBBBB',
                  tier: 'free',
                  max_machines: 1,
                  status: 'active',
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                },
              ],
            };
          if (/SELECT \* FROM zenithjoy\.license_machines\s+WHERE license_id/.test(sql))
            return { rows: [] };
          if (/SELECT COUNT/i.test(sql)) return { rows: [{ count: '1' }] };
          return { rows: [] };
        }),
      },
    }));
    const mod = await import('../../../src/services/license.service');
    const result = await mod.registerAgent({
      license_key: 'ZJ-F-BBBBBBBB',
      machine_id: 'm-2',
      hostname: 'h-2',
      version: '0.1.0',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('register should fail');
    expect(result.code).toBe('QUOTA_EXCEEDED');
    expect((result as any).success).toBe(false);
    expect((result as any).error).toBe('LICENSE_DEVICE_LIMIT_EXCEEDED');
    expect((result as any).current_count).toBe(1);
    expect((result as any).limit).toBe(1);
  });
});
