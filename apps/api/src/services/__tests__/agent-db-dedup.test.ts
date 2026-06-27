/* eslint-disable @typescript-eslint/no-explicit-any -- vitest mock types require any cast */
/**
 * 身份统一 — agent-db 按 (tenant_id, hostname) 去重单测
 *
 * 根因：同一台机器在 agents 表裂成两行（心跳 ws1-<hash> + WS 连接 agent-env-<ts>），
 * 因为 upsertAgent / findOrCreateAgentUuid 只按 agent_id(TEXT) upsert，完全不看 hostname。
 * 修复：upsert 一台 agent 时若已存在同 (tenant_id, hostname)(hostname 非空) 的行，复用/UPDATE 那行，
 * 不因 agent_id 不同而新增行。
 *
 * 覆盖：
 *  - [DEDUP] 同 hostname 第二次 upsert → 命中已有行走 UPDATE，不 INSERT 新行
 *  - [DEDUP] hostname 为空 → 退回原 agent_id upsert 行为（不去重）
 *  - [DEDUP] 不同 tenant 同 hostname → 隔离，各自一行（不串）
 *  - [DEDUP] findOrCreateAgentUuid 同 hostname 复用稳定行
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../../db/connection';
import { upsertAgent, findOrCreateAgentUuid } from '../agent-db';

const mockQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('agent-db dedup by (tenant_id, hostname) [DEDUP]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upsertAgent: 同 hostname 已有行 → UPDATE 复用，不 INSERT 新行', async () => {
    // 第 1 次 query = SELECT 命中已有去重行
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'aaaaaaaa-0000-0000-0000-000000000001' }],
    });
    // 第 2 次 query = UPDATE 那行
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await upsertAgent({
      tenantId: 'tid-1',
      agentId: 'agent-env-1700000000',
      capabilities: ['douyin'],
      version: '2.0.34',
      hostname: 'XX-ROG',
    });

    // 应有 SELECT 探测同 (tenant_id, hostname)
    const selectCall = mockQuery.mock.calls.find(([sql]) =>
      /SELECT[\s\S]*FROM\s+zenithjoy\.agents/i.test(sql),
    );
    expect(selectCall).toBeTruthy();
    expect(selectCall![0]).toMatch(/tenant_id/i);
    expect(selectCall![0]).toMatch(/hostname/i);

    // 命中后必须是 UPDATE 那行，不能出现 INSERT
    const sqls = mockQuery.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sqls).toMatch(/UPDATE\s+zenithjoy\.agents/i);
    expect(sqls).not.toMatch(/INSERT\s+INTO\s+zenithjoy\.agents/i);
  });

  it('upsertAgent: hostname 空 → 退回 agent_id upsert（INSERT ... ON CONFLICT）', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await upsertAgent({
      tenantId: 'tid-1',
      agentId: 'agent-no-host',
      capabilities: ['douyin'],
      version: '2.0.34',
      // 无 hostname
    });
    const sqls = mockQuery.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sqls).toMatch(/INSERT\s+INTO\s+zenithjoy\.agents[\s\S]*ON\s+CONFLICT/i);
  });

  it('upsertAgent: hostname 非空但无已有行 → INSERT 新行', async () => {
    // SELECT 未命中
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'new-uuid' }] });
    await upsertAgent({
      tenantId: 'tid-1',
      agentId: 'agent-env-first',
      capabilities: ['douyin'],
      version: '2.0.34',
      hostname: 'NEW-PC',
    });
    const sqls = mockQuery.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sqls).toMatch(/INSERT\s+INTO\s+zenithjoy\.agents/i);
  });

  it('upsertAgent: SELECT 探测 tenant 隔离 — 参数带 tenantId + hostname', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT 未命中
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'x' }] }); // INSERT
    await upsertAgent({
      tenantId: 'tid-iso',
      agentId: 'a',
      capabilities: [],
      version: '1',
      hostname: 'HOST-ISO',
    });
    const selectCall = mockQuery.mock.calls.find(([sql]) =>
      /SELECT[\s\S]*FROM\s+zenithjoy\.agents/i.test(sql),
    );
    expect(selectCall![1]).toContain('tid-iso');
    expect(selectCall![1]).toContain('HOST-ISO');
  });

  it('findOrCreateAgentUuid: 同 hostname 已有行 → 返回那行 id，UPDATE 不 INSERT 新行', async () => {
    // SELECT 命中去重行
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'stable-uuid-1' }],
    });
    // UPDATE 复用那行
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'stable-uuid-1' }] });

    const r = await findOrCreateAgentUuid({
      displayName: 'agent-env-1700000001',
      tenantId: 'tid-1',
      capabilities: ['douyin'],
      version: '2.0.34',
      hostname: 'XX-ROG',
    });
    expect(r.uuid).toBe('stable-uuid-1');
    const sqls = mockQuery.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sqls).not.toMatch(/INSERT\s+INTO\s+zenithjoy\.agents/i);
  });

  it('findOrCreateAgentUuid: 无 hostname → 退回原 INSERT ... ON CONFLICT(agent_id)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'uuid-legacy' }] });
    const r = await findOrCreateAgentUuid({
      displayName: 'old-v1.0-agent',
      tenantId: 'tid-1',
      capabilities: [],
      version: '1.0.0',
    });
    expect(r.uuid).toBe('uuid-legacy');
    const sqls = mockQuery.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sqls).toMatch(/INSERT\s+INTO\s+zenithjoy\.agents[\s\S]*ON\s+CONFLICT/i);
  });
});
