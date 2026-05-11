/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * H-2 Bug 9 — backend hello handler agent_uuid 优先复用 row（避免 dual register race）
 *
 * 覆盖：
 *  - hello with agentUuid → 走 UPDATE 复用 row (不 INSERT 新行)
 *  - hello without agentUuid → 走老 path findOrCreateAgentUuid (向后兼容)
 *  - agentUuid 在 DB 无 row → fallback 到 findOrCreateAgentUuid (安全 fallback)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../agent-db', () => ({
  upsertAgent: vi.fn(),
  touchAgentHeartbeat: vi.fn(),
  setAgentOffline: vi.fn(),
  findOrCreateAgentUuid: vi.fn(),
}));

import pool from '../../db/connection';
import * as agentDb from '../agent-db';
import { resolveAgentUuidFromHello } from '../agent-ws';

describe('agent-ws hello handler [Bug 9]', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
    vi.mocked(agentDb.findOrCreateAgentUuid).mockReset();
    vi.mocked(agentDb.upsertAgent).mockReset();
  });

  it('hello with agentUuid → UPDATE 复用 row, 不调 findOrCreateAgentUuid', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: '11111111-1111-1111-1111-111111111111' }],
    } as any);
    const result = await resolveAgentUuidFromHello({
      agentId: 'agent-env-xxx',
      agentUuid: '11111111-1111-1111-1111-111111111111',
      capabilities: ['douyin'],
      version: '1.0.1',
    });
    expect(result).toBe('11111111-1111-1111-1111-111111111111');
    expect(vi.mocked(pool.query).mock.calls[0][0]).toMatch(/UPDATE\s+zenithjoy\.agents/i);
    expect(agentDb.findOrCreateAgentUuid).not.toHaveBeenCalled();
  });

  it('hello without agentUuid → 走老 path findOrCreateAgentUuid (向后兼容)', async () => {
    vi.mocked(agentDb.findOrCreateAgentUuid).mockResolvedValueOnce({
      uuid: '22222222-2222-2222-2222-222222222222',
      displayName: 'old-agent-without-uuid',
    } as any);
    const result = await resolveAgentUuidFromHello({
      agentId: 'old-agent-without-uuid',
      capabilities: ['douyin'],
      version: '1.0.0',
    });
    expect(result).toBe('22222222-2222-2222-2222-222222222222');
    expect(agentDb.findOrCreateAgentUuid).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'old-agent-without-uuid' })
    );
  });

  it('hello with agentUuid 但 DB 无对应 row → fallback findOrCreateAgentUuid', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    vi.mocked(agentDb.findOrCreateAgentUuid).mockResolvedValueOnce({
      uuid: '33333333-3333-3333-3333-333333333333',
      displayName: 'agent-orphaned',
    } as any);
    const result = await resolveAgentUuidFromHello({
      agentId: 'agent-orphaned',
      agentUuid: '99999999-9999-9999-9999-999999999999',
      capabilities: ['douyin'],
      version: '1.0.1',
    });
    expect(result).toBe('33333333-3333-3333-3333-333333333333');
    expect(agentDb.findOrCreateAgentUuid).toHaveBeenCalled();
  });
});
