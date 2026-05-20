/**
 * WS auth 修复测试：attachAgentWS upgrade 应该用 licenses 表验证，
 * 不依赖 tenants.license_key（该字段对新账号为空 → 导致 401）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));
vi.mock('ws', () => ({
  WebSocketServer: vi.fn(),
  WebSocket: vi.fn(),
}));
vi.mock('../agent-registry', () => ({
  agentRegistry: { get: vi.fn(), register: vi.fn(), heartbeat: vi.fn(), unregister: vi.fn(), emit: vi.fn() },
}));
vi.mock('../agent-db', () => ({
  upsertAgent: vi.fn(),
  touchAgentHeartbeat: vi.fn(),
  setAgentOffline: vi.fn(),
  findOrCreateAgentUuid: vi.fn(),
}));
vi.mock('../skill-db', () => ({
  upsertAgentSkillStatuses: vi.fn(),
}));
vi.mock('../task-dispatch', () => ({ handleTaskResult: vi.fn() }));

// 重点：mock walking-skeleton.service，不再 mock tenant-db
vi.mock('../walking-skeleton.service', () => ({
  validateLicense: vi.fn(),
}));

import { authenticateWsToken } from '../agent-ws';
import * as wsSvc from '../walking-skeleton.service';

describe('authenticateWsToken', () => {
  beforeEach(() => {
    vi.mocked(wsSvc.validateLicense).mockReset();
  });

  it('有效 license → 返回 tenant_id', async () => {
    vi.mocked(wsSvc.validateLicense).mockResolvedValue({
      ok: true,
      license: {
        id: 'lic-1',
        license_key: 'ZJ-F-ABCD1234',
        tenant_id: 'tenant-uuid-1',
        status: 'active',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      } as any,
    });
    const result = await authenticateWsToken('ZJ-F-ABCD1234');
    expect(result).toBe('tenant-uuid-1');
    expect(wsSvc.validateLicense).toHaveBeenCalledWith('ZJ-F-ABCD1234');
  });

  it('无效 license → 返回 null', async () => {
    vi.mocked(wsSvc.validateLicense).mockResolvedValue({
      ok: false,
      code: 'INVALID_LICENSE',
      message: 'license 不存在',
    });
    const result = await authenticateWsToken('ZJ-X-INVALID');
    expect(result).toBeNull();
  });

  it('过期 license → 返回 null', async () => {
    vi.mocked(wsSvc.validateLicense).mockResolvedValue({
      ok: false,
      code: 'EXPIRED',
      message: 'license 已过期',
    });
    const result = await authenticateWsToken('ZJ-F-EXPIRED1');
    expect(result).toBeNull();
  });

  it('空 token → 返回 null（不调 validateLicense）', async () => {
    const result = await authenticateWsToken('');
    expect(result).toBeNull();
    expect(wsSvc.validateLicense).not.toHaveBeenCalled();
  });
});
