/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * H-2 Bug 9 layer 3 — license register 必须填 agents.license_id + hostname 列
 *
 * Root cause: walking-skeleton.service heartbeatUpsert 用
 *   `WHERE license_id=$1 AND hostname=$2` 找现有 agent。
 *   若 license register 留空 → heartbeat 找不到 → 创新 ws1-XXX row →
 *   agentContext 选错 row → task 派给孤儿 UUID → chrome 没弹。
 *
 * Fix: upsertAgentRowGetUuid INSERT/UPDATE 时填 license_id + hostname。
 * 本 unit test 用 mock pool 验 SQL 包含这两列 (cheap RED)。
 * 真 DB 端到端验 H-1 lead self-test extension。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../../db/connection';
import { registerAgent } from '../license.service';

describe('license register agents row [Bug 9 layer 3]', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('INSERT INTO zenithjoy.agents SQL 必须含 license_id + hostname 列', async () => {
    // mock license lookup
    vi.mocked(pool.query)
      .mockResolvedValueOnce({
        // findLicenseByKey
        rows: [
          {
            id: 'lic-uuid-1',
            license_key: 'ZJ-F-TEST',
            tier: 'free',
            max_machines: 1,
            status: 'active',
            expires_at: new Date(Date.now() + 86400000),
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any) // count active machines
      .mockResolvedValueOnce({ rows: [{ id: 'machine-uuid-1' }] } as any) // upsert license_machines
      .mockResolvedValueOnce({ rows: [{ ws_token: 'tok' }] } as any) // create ws_token
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-uuid-1' }] } as any) // tenant lookup
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-1' }] } as any); // upsert agent INSERT

    await registerAgent({
      license_key: 'ZJ-F-TEST',
      machine_id: 'mach-1',
      hostname: 'XX-ROG',
      agent_id: 'agent-test-1',
      version: '1.0.1',
    });

    // find the agents INSERT call (last query)
    const calls = vi.mocked(pool.query).mock.calls;
    const insertAgentCall = calls.find((c) => {
      const sql = c[0] as string;
      return /INSERT\s+INTO\s+zenithjoy\.agents/i.test(sql);
    });
    expect(insertAgentCall).toBeDefined();
    const sql = insertAgentCall![0] as string;
    // 关键：column list 含 license_id + hostname
    expect(sql).toMatch(/license_id/);
    expect(sql).toMatch(/hostname/);
    // ON CONFLICT UPDATE 也得 update license_id + hostname (COALESCE 不破老 row)
    expect(sql).toMatch(/license_id\s*=\s*COALESCE/i);
    expect(sql).toMatch(/hostname\s*=\s*COALESCE/i);
    // params 真传 license id + hostname
    const params = insertAgentCall![1] as any[];
    expect(params).toContain('lic-uuid-1');
    expect(params).toContain('XX-ROG');
  });

  it('hostname 缺失时 (input.hostname undefined) 传 NULL 不挂', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'lic-uuid-2',
            license_key: 'ZJ-F-TEST2',
            tier: 'free',
            max_machines: 1,
            status: 'active',
            expires_at: new Date(Date.now() + 86400000),
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'machine-uuid-2' }] } as any)
      .mockResolvedValueOnce({ rows: [{ ws_token: 'tok2' }] } as any)
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-uuid-2' }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-2' }] } as any);

    await registerAgent({
      license_key: 'ZJ-F-TEST2',
      machine_id: 'mach-2',
      // hostname intentionally omitted
      agent_id: 'agent-test-2',
      version: '1.0.1',
    });

    const calls = vi.mocked(pool.query).mock.calls;
    const insertAgentCall = calls.find((c) => /INSERT\s+INTO\s+zenithjoy\.agents/i.test(c[0] as string));
    expect(insertAgentCall).toBeDefined();
    const params = insertAgentCall![1] as any[];
    // hostname 应是 null (不是 undefined)
    expect(params).toContain(null);
    expect(params).toContain('lic-uuid-2'); // license_id 仍传
  });
});
