/* eslint-disable @typescript-eslint/no-explicit-any -- vitest mock types require any cast */
/**
 * register 路径按 (tenant_id, hostname) 去重 — 回归单测
 *
 * 根因（真机回归）：#921 给 agents 表加了 partial unique index uq_agents_tenant_hostname
 *   (WHERE hostname 非空)。但 license register 路径的 upsertAgentRowGetUuid 仍只走
 *   `INSERT ... ON CONFLICT (agent_id)`，完全不看 hostname。
 *   当同一台机器以不同 agent_id 再次 register（hostname 不变）→ INSERT 撞 uq_agents_tenant_hostname
 *   → 抛 duplicate key → register handler 500。
 *
 * 修复：register 写 agents 行时复用 #921 的 (tenant_id, hostname) 去重逻辑——
 *   命中同 hostname 行 → UPDATE 复用并返回那行 id；未命中 / hostname 空 → 退回原
 *   INSERT ... ON CONFLICT(agent_id)（partial index WHERE hostname 非空，不受影响）。
 *
 * 覆盖：
 *  - [REG-DEDUP] register 同 hostname 第二次 → 命中已有行走 UPDATE，不 INSERT（不再 500）
 *  - [REG-DEDUP] register 返回 agent_id(UUID) = 去重后那行 id
 *  - [REG-DEDUP] hostname 空 → 退回原 INSERT ... ON CONFLICT(agent_id)
 *  - [REG-DEDUP] tenant 隔离 — SELECT 探测参数带 tenantId + hostname
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../../db/connection';
import { registerAgent } from '../license.service';

const mockQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

/** 喂前置 query（findLicenseByKey → existing license_machines(空,走新装机) → count active → INSERT license_machines） */
function feedRegisterPrelude(licenseId = 'lic-uuid-1') {
  mockQuery
    .mockResolvedValueOnce({
      // findLicenseByKey
      rows: [
        {
          id: licenseId,
          license_key: 'ZJ-F-TEST',
          tier: 'free',
          max_machines: 1,
          status: 'active',
          expires_at: new Date(Date.now() + 86400000),
        },
      ],
    } as any)
    .mockResolvedValueOnce({ rows: [] } as any) // existing license_machines → 空 = 新装机
    .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any) // count active machines
    .mockResolvedValueOnce({ rows: [] } as any); // INSERT license_machines
}

describe('license register dedup by (tenant_id, hostname) [REG-DEDUP]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('同 hostname 已有行 → UPDATE 复用，不 INSERT 新行（不再撞 uq_agents_tenant_hostname 500）', async () => {
    feedRegisterPrelude();
    // upsertAgentRowGetUuid: tenant lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-uuid-1' }] } as any);
    // SELECT 命中同 (tenant_id, hostname) 去重行
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'stable-agent-uuid' }],
    } as any);
    // UPDATE 那行（RETURNING id）
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'stable-agent-uuid' }] } as any);

    const result = await registerAgent({
      license_key: 'ZJ-F-TEST',
      machine_id: 'mach-1',
      hostname: 'XX-ROG',
      agent_id: 'agent-env-1700000099', // 与已有行不同的 agent_id —— 旧逻辑会撞唯一索引
      version: '2.0.34',
    });

    expect(result.ok).toBe(true);
    // 返回的 agent_id(UUID) 必须是去重后那行 id
    if (result.ok) {
      expect(result.agent_id).toBe('stable-agent-uuid');
    }

    // 命中后必须 UPDATE 那行，不能出现 INSERT INTO zenithjoy.agents
    const sqls = mockQuery.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sqls).toMatch(/UPDATE\s+zenithjoy\.agents/i);
    expect(sqls).not.toMatch(/INSERT\s+INTO\s+zenithjoy\.agents/i);
  });

  it('SELECT 探测带 tenantId + hostname（tenant 隔离）', async () => {
    feedRegisterPrelude();
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-iso' }] } as any); // tenant lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'hit' }] } as any); // SELECT 命中
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'hit' }] } as any); // UPDATE

    await registerAgent({
      license_key: 'ZJ-F-TEST',
      machine_id: 'mach-iso',
      hostname: 'HOST-ISO',
      agent_id: 'agent-iso',
      version: '1',
    });

    const selectCall = mockQuery.mock.calls.find(([sql]) =>
      /SELECT\s+id[\s\S]*FROM\s+zenithjoy\.agents/i.test(sql as string),
    );
    expect(selectCall).toBeTruthy();
    expect(selectCall![0]).toMatch(/tenant_id/i);
    expect(selectCall![0]).toMatch(/hostname/i);
    expect(selectCall![1]).toContain('tenant-iso');
    expect(selectCall![1]).toContain('HOST-ISO');
  });

  it('hostname 非空但无已有行 → INSERT 新行（走原 ON CONFLICT(agent_id)）', async () => {
    feedRegisterPrelude();
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-uuid-1' }] } as any); // tenant lookup
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // SELECT 未命中
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'new-agent-uuid' }] } as any); // INSERT RETURNING

    const result = await registerAgent({
      license_key: 'ZJ-F-TEST',
      machine_id: 'mach-new',
      hostname: 'NEW-PC',
      agent_id: 'agent-new',
      version: '2.0.34',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent_id).toBe('new-agent-uuid');
    const sqls = mockQuery.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sqls).toMatch(/INSERT\s+INTO\s+zenithjoy\.agents[\s\S]*ON\s+CONFLICT/i);
  });

  it('hostname 空 → 退回原 INSERT ... ON CONFLICT(agent_id)（partial index 不卡空 hostname）', async () => {
    feedRegisterPrelude();
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-uuid-1' }] } as any); // tenant lookup
    // hostname 空 → 不做 SELECT 探测，直接 INSERT
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-no-host-uuid' }] } as any); // INSERT RETURNING

    const result = await registerAgent({
      license_key: 'ZJ-F-TEST',
      machine_id: 'mach-no-host',
      // hostname 故意省略
      agent_id: 'agent-no-host',
      version: '2.0.34',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent_id).toBe('agent-no-host-uuid');

    // 不应出现 SELECT id FROM zenithjoy.agents 探测（hostname 空 → 跳过去重）
    const selectAgentsProbe = mockQuery.mock.calls.find(([sql]) =>
      /SELECT\s+id[\s\S]*FROM\s+zenithjoy\.agents[\s\S]*hostname/i.test(sql as string),
    );
    expect(selectAgentsProbe).toBeFalsy();
    const sqls = mockQuery.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sqls).toMatch(/INSERT\s+INTO\s+zenithjoy\.agents[\s\S]*ON\s+CONFLICT/i);
  });
});
