/**
 * WS auth 修复测试：attachAgentWS upgrade 应该用 licenses 表验证，
 * 不依赖 tenants.license_key（该字段对新账号为空 → 导致 401）
 *
 * 2026-07-27 补充（Path2 安卓智能获客验收 401 死循环回归测试）：
 * Agent 首连用 license_key（走 validateLicense），注册成功后 register 响应把
 * 服务端签发的 hex ws_token 写进本地配置；WsClient.buildWsUrl() 之后所有重连
 * 一律优先使用这个 hex token。但 authenticateWsToken 此前只调用 validateLicense
 * （只认 ZJ-X-XXXXXXXX 格式），从未调用已实现的 verifyWsToken() 校验 hex token，
 * 导致断线重连必然 401——staging 抓包实测 495 次 /agent-ws 请求 490 次 401。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db/connection', () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
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
import { signWsToken } from '../license.service';
import * as wsSvc from '../walking-skeleton.service';

describe('authenticateWsToken', () => {
  beforeEach(() => {
    vi.mocked(wsSvc.validateLicense).mockReset();
    mockQuery.mockReset();
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

  // ── 回归测试：hex ws_token 重连必须走通（Path2 安卓验收 401 死循环） ──────────

  it('[回归] 首连用 license_key 成功后签发的 hex ws_token，重连时必须校验通过（不再 401）', async () => {
    // license_key 格式必然走 validateLicense 分支，且不是本次 hex token 的格式，模拟其失败
    vi.mocked(wsSvc.validateLicense).mockResolvedValue({
      ok: false,
      code: 'INVALID_LICENSE',
      message: 'license 不存在',
    });
    const licenseId = 'lic-real-1';
    const machineId = 'afa73fead5fd2b3be1fa6a5c1a66943e'; // 于瑾报告里的真实 machine_id
    const hexToken = signWsToken(licenseId, machineId);

    // 服务端需要按 machine_id 反查 license_machines JOIN licenses 拿到 license_id + tenant_id
    mockQuery.mockResolvedValueOnce({
      rows: [{ license_id: licenseId, tenant_id: 'tenant-yujin' }],
    });

    const result = await authenticateWsToken(hexToken, machineId);
    expect(result).toBe('tenant-yujin');
  });

  it('[回归] hex ws_token 但 machine_id 对不上签发时的 machine_id → 拒绝', async () => {
    vi.mocked(wsSvc.validateLicense).mockResolvedValue({
      ok: false,
      code: 'INVALID_LICENSE',
      message: 'license 不存在',
    });
    const hexToken = signWsToken('lic-real-1', 'machine-A');

    mockQuery.mockResolvedValueOnce({
      rows: [{ license_id: 'lic-real-1', tenant_id: 'tenant-x' }],
    });

    // 重连时携带的 machine_id 与签发时不一致（伪造/错配）
    const result = await authenticateWsToken(hexToken, 'machine-B');
    expect(result).toBeNull();
  });

  it('[回归] hex ws_token 但 license_machines 查无记录 → 拒绝', async () => {
    vi.mocked(wsSvc.validateLicense).mockResolvedValue({
      ok: false,
      code: 'INVALID_LICENSE',
      message: 'license 不存在',
    });
    const hexToken = signWsToken('lic-real-1', 'machine-A');
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await authenticateWsToken(hexToken, 'machine-A');
    expect(result).toBeNull();
  });
});
