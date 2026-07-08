/**
 * utils/resolveTenantId.ts 配套单元测试（lint-test-pairing 要求）
 *
 * resolveTenantId 逻辑：
 *   1. req.tenantId 已设 → 直接返回（短路，不查 DB）
 *   2. req.tenantId 未设 → 查 service_agents WHERE wechat_id = csWechatId → 取 tenant_id
 *   3. service_agents 无记录 + csWechatId 匹配 cs-<hex6+> → 查 license_machines JOIN licenses
 *   4. 两条路都查不到 → 返回 null
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request } from 'express';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../db/pool', () => ({
  pool: { query: mockQuery },
}));

import { resolveTenantId } from './resolveTenantId';

const TENANT_ID = 'dddddddd-0000-0000-0000-000000000001';

function mkReq(overrides: Partial<Request & { tenantId?: string }> = {}): Request & { tenantId?: string } {
  return { headers: {}, body: {}, params: {}, ...overrides } as unknown as Request & { tenantId?: string };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveTenantId — 短路路径（req.tenantId 已设）', () => {
  it('req.tenantId 已设 → 直接返回，不查 DB', async () => {
    const req = mkReq({ tenantId: TENANT_ID });
    const result = await resolveTenantId(req as Request, 'cs_any');
    expect(result).toBe(TENANT_ID);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('resolveTenantId — service_agents 查找路径', () => {
  it('service_agents 命中 → 返回 tenant_id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_ID }] });
    const req = mkReq();
    const result = await resolveTenantId(req as Request, 'cs_wechat_001');
    expect(result).toBe(TENANT_ID);
    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('service_agents');
    expect(params[0]).toBe('cs_wechat_001');
  });

  it('service_agents 无记录，csWechatId 非 cs-前缀 → 返回 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = mkReq();
    const result = await resolveTenantId(req as Request, 'plain_wechat_id');
    expect(result).toBeNull();
    // 非 cs-<hex> 格式不触发 license_machines 查询
    expect(mockQuery).toHaveBeenCalledOnce();
  });
});

describe('resolveTenantId — license_machines 回退路径（cs-<hex> 格式）', () => {
  it('service_agents 无 + cs-前缀 → 查 license_machines → 命中返回 tenant_id', async () => {
    // 第一次查询 service_agents → 空
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 第二次查询 license_machines → 命中
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_ID }] });

    const req = mkReq();
    const result = await resolveTenantId(req as Request, 'cs-a1b2c3d4e5f6');
    expect(result).toBe(TENANT_ID);
    expect(mockQuery).toHaveBeenCalledTimes(2);

    const [licSql, licParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(licSql).toContain('license_machines');
    // 前缀应为 hex 小写部分
    expect(licParams[0]).toBe('a1b2c3d4e5f6');
  });

  it('service_agents 无 + cs-前缀 + license_machines 无 → 返回 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // service_agents 空
    mockQuery.mockResolvedValueOnce({ rows: [] }); // license_machines 空

    const req = mkReq();
    const result = await resolveTenantId(req as Request, 'cs-aabbccdd1122');
    expect(result).toBeNull();
  });

  it('cs-<hex> 前缀长度 < 6 → 不触发 license_machines 查询（正则不匹配）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // service_agents 空

    const req = mkReq();
    // 仅 5 个 hex 字符，不满足 {6,} 最小长度
    const result = await resolveTenantId(req as Request, 'cs-a1b2c');
    expect(result).toBeNull();
    // 正则不匹配，只有 service_agents 那一次查询
    expect(mockQuery).toHaveBeenCalledOnce();
  });
});

describe('resolveTenantId — 两条路径都失败 → null', () => {
  it('service_agents 返回 null tenant_id（非预期脏数据）→ 回退 license_machines，仍 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: null }] }); // service_agents 有行但 tenant_id 为 null
    mockQuery.mockResolvedValueOnce({ rows: [] }); // license_machines 空

    const req = mkReq();
    // cs- 格式才能触发第二次查询
    const result = await resolveTenantId(req as Request, 'cs-000000aabbcc');
    expect(result).toBeNull();
  });
});
