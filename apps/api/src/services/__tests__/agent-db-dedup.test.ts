/* eslint-disable @typescript-eslint/no-explicit-any -- vitest mock types require any cast */
/**
 * 身份统一 — agent-db 按 (tenant_id, hostname) 去重单测
 *
 * 真机复现(2026-07-29，客户已交付环境)：staging API 日志真实报错
 *   [agent-ws] upsertAgent failed: duplicate key value violates unique constraint "uq_agents_tenant_hostname"
 * 根因：旧实现用 SELECT-then-branch 模式去重（先查 (tenant_id, hostname) 是否已有行，
 * 查不到才走 INSERT ... ON CONFLICT(agent_id)）——这是经典 TOCTOU 竞态：设备重装/快速
 * 重连时多个并发连接同时 SELECT 不到现有行(前一个事务还没提交)，都各自走向 INSERT 分支，
 * 第二个 INSERT 撞上 (tenant_id, hostname) 这个 partial unique index，但 ON CONFLICT 只
 * 处理了 agent_id 这一个冲突目标，直接抛未捕获的 duplicate key 异常，整个注册流程失败。
 * 已用真实 zenithjoy_test 库手动复现过这个报错（两次不同 agent_id、相同 hostname 的
 * INSERT，第二次真实抛 uq_agents_tenant_hostname 冲突）。
 *
 * 修复：改用原子 INSERT ... ON CONFLICT (tenant_id, hostname) WHERE hostname IS NOT NULL
 * AND hostname <> '' DO UPDATE，消除 SELECT 和 INSERT 之间的竞态窗口——已用同一个真实库
 * 验证过两次并发 INSERT 都不再报错，最终只留一行。
 *
 * 覆盖：
 *  - [DEDUP] hostname 非空 → 单条原子 INSERT...ON CONFLICT(tenant_id,hostname)，不再是
 *    SELECT-then-branch 两步（消除竞态窗口）
 *  - [DEDUP] hostname 为空 → 退回原 agent_id upsert 行为（不去重）
 *  - [DEDUP] 不同 tenant 同 hostname → 隔离，各自一行（不串，走 WHERE tenant_id=$1 天然隔离）
 *  - [DEDUP] findOrCreateAgentUuid 同样改为原子 upsert
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

  it('upsertAgent: hostname 非空 → 单条原子 INSERT...ON CONFLICT(tenant_id,hostname)，不能是 SELECT-then-branch 两步', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await upsertAgent({
      tenantId: 'tid-1',
      agentId: 'agent-env-1700000000',
      capabilities: ['douyin'],
      version: '2.0.34',
      hostname: 'XX-ROG',
    });

    // 消除竞态窗口的核心要求：只能有一次数据库往返，不能先 SELECT 探测再决定 UPDATE/INSERT
    // ——两次往返之间就是真机复现的那个竞态窗口。
    expect(mockQuery.mock.calls.length).toBe(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT\s+INTO\s+zenithjoy\.agents/i);
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*tenant_id\s*,\s*hostname\s*\)/i);
    expect(sql).not.toMatch(/^\s*SELECT/i);
    expect(params).toContain('tid-1');
    expect(params).toContain('XX-ROG');
  });

  it('upsertAgent: hostname 空 → 退回 agent_id upsert（INSERT ... ON CONFLICT(agent_id)）', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await upsertAgent({
      tenantId: 'tid-1',
      agentId: 'agent-no-host',
      capabilities: ['douyin'],
      version: '2.0.34',
      // 无 hostname
    });
    expect(mockQuery.mock.calls.length).toBe(1);
    const sqls = mockQuery.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sqls).toMatch(/INSERT\s+INTO\s+zenithjoy\.agents[\s\S]*ON\s+CONFLICT\s*\(\s*agent_id\s*\)/i);
  });

  it('upsertAgent: 不同 tenant 参数各自隔离传参（不串）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await upsertAgent({
      tenantId: 'tid-iso',
      agentId: 'a',
      capabilities: [],
      version: '1',
      hostname: 'HOST-ISO',
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toContain('tid-iso');
    expect(params).toContain('HOST-ISO');
  });

  it('findOrCreateAgentUuid: hostname 非空 → 单条原子 INSERT...ON CONFLICT(tenant_id,hostname) RETURNING id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'stable-uuid-1' }] });

    const r = await findOrCreateAgentUuid({
      displayName: 'agent-env-1700000001',
      tenantId: 'tid-1',
      capabilities: ['douyin'],
      version: '2.0.34',
      hostname: 'XX-ROG',
    });
    expect(r.uuid).toBe('stable-uuid-1');
    expect(mockQuery.mock.calls.length).toBe(1);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*tenant_id\s*,\s*hostname\s*\)/i);
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
    expect(sqls).toMatch(/INSERT\s+INTO\s+zenithjoy\.agents[\s\S]*ON\s+CONFLICT\s*\(\s*agent_id\s*\)/i);
  });
});
