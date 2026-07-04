/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * upsertAgentByHeartbeat — 精确 UPDATE + license_id 兜底 fall-through 测试
 *
 * 加固背景：精确 UPDATE WHERE 子句增加 `AND license_id = $5`，
 * 伪造别租户 agentUuid 时 license_id 不匹配 → UPDATE 命中 0 行 →
 * fall-through 到 (license_id, hostname) 原有隔离路径，合法 agent 行为不变。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../../db/connection';
import { upsertAgentByHeartbeat } from '../walking-skeleton.service';

const AGENT_ROW = {
  id: 'uuid-agent-001',
  tenant_id: 'tenant-001',
  agent_id: 'ws1-aabbccddeeff0011',
  hostname: 'my-pc',
  version: '2.0.32',
  license_id: 'lic-001',
  bound_folder_path: null,
  last_heartbeat_at: '2026-06-28T00:00:00Z',
  status: 'online',
  last_seen: '2026-06-28T00:00:00Z',
};

const BASE_ARGS = {
  licenseId: 'lic-001',
  tenantId: 'tenant-001',
  hostname: 'my-pc',
  version: '2.0.32',
  agentUuid: 'uuid-agent-001',
};

describe('upsertAgentByHeartbeat — 精确 UPDATE + license_id fall-through', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('uuid + license_id 命中 → 直接返回该行，不走 SELECT/INSERT 路径', async () => {
    // call 1: 精确 UPDATE 返回一行（命中）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);
    // call 2: pinned_agent UPDATE（可忽略结果）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    const result = await upsertAgentByHeartbeat(BASE_ARGS);

    expect(result.id).toBe('uuid-agent-001');
    expect(result.status).toBe('online');

    const calls = vi.mocked(pool.query).mock.calls;
    // 只有 2 次查询：精确 UPDATE + pinned_agent UPDATE
    expect(calls.length).toBe(2);

    // 第一次调用必须是精确 UPDATE（含 license_id 兜底 AND license_id = $5）
    const firstSql = calls[0][0] as string;
    expect(firstSql).toMatch(/UPDATE zenithjoy\.agents/i);
    expect(firstSql).toMatch(/WHERE id = \$3/);
    expect(firstSql).toMatch(/AND license_id = \$5/);

    // 最后一次调用不能是 INSERT（命中路径不走 INSERT）
    const lastSql = calls[calls.length - 1][0] as string;
    expect(lastSql).not.toMatch(/INSERT INTO zenithjoy\.agents/i);
  });

  it('uuid 未命中（license_id 不匹配 SQL 层已过滤） → fall-through 到 (license_id, hostname) 路径', async () => {
    // call 1: 精确 UPDATE 返回空（uuid 找不到 / license_id 不匹配）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    // call 2: SELECT by (license_id, hostname) → 找到既有 agent
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);
    // call 3: UPDATE agents by id（原有路径更新心跳）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);
    // call 4: pinned_agent UPDATE
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    const result = await upsertAgentByHeartbeat(BASE_ARGS);

    expect(result.id).toBe('uuid-agent-001');

    const calls = vi.mocked(pool.query).mock.calls;
    // fall-through 后至少 3 次（精确 UPDATE + SELECT + UPDATE/INSERT）
    expect(calls.length).toBeGreaterThanOrEqual(3);

    // 第二次调用应为 SELECT（按 license_id 隔离的原有路径）
    const secondSql = calls[1][0] as string;
    expect(secondSql).toMatch(/SELECT[\s\S]*FROM zenithjoy\.agents/i);
    expect(secondSql).toMatch(/WHERE license_id = \$1/i);

    // 整条调用链中应出现第二次 UPDATE（原有路径更新心跳）
    const hasSecondUpdate = calls.slice(2).some(
      (c: unknown[]) => typeof c[0] === 'string' && /UPDATE zenithjoy\.agents/i.test(c[0] as string),
    );
    expect(hasSecondUpdate).toBe(true);
  });
});

/** 判定某条调用是否为 license_machines 的写入（INSERT）。 */
function isLicenseMachineInsert(c: unknown[]): boolean {
  return typeof c[0] === 'string' && /INSERT INTO zenithjoy\.license_machines/i.test(c[0] as string);
}

describe('upsertAgentByHeartbeat — license_machines 配额门（心跳旁路补齐）', () => {
  const QUOTA_ARGS = { ...BASE_ARGS, machineId: 'mid-xyz' };

  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('新机器 + 配额已满 → 跳过 license_machines INSERT（agents 心跳照常更新）+ warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // call 1: SELECT 该 (license_id, machine_id) 是否已有行 → 无（新机器）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    // call 2: SELECT max_machines + active count → 已满（1/1）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ max: 1, cnt: 1 }] } as any);
    // call 3: 精确 UPDATE agents（心跳照常）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);
    // call 4: pinned_agent UPDATE
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    const result = await upsertAgentByHeartbeat(QUOTA_ARGS);
    expect(result.id).toBe('uuid-agent-001');

    const calls = vi.mocked(pool.query).mock.calls;
    // 全链路不得出现 license_machines INSERT（配额门拦下新机器）
    expect(calls.some(isLicenseMachineInsert)).toBe(false);
    // agents 精确 UPDATE 仍然发生（在线状态展示不受影响）
    expect(calls.some((c) => typeof c[0] === 'string' && /UPDATE zenithjoy\.agents/i.test(c[0] as string))).toBe(true);
    // 有配额已满告警
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls.map((c) => c.join(' ')).join('\n'))).toMatch(/配额已满/);
    warnSpy.mockRestore();
  });

  it('已绑定机器 + 配额已满 → 照旧 upsert（续命不受配额影响）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // call 1: SELECT 该 (license_id, machine_id) → 已有行（老机器续心跳）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ exists: 1 }] } as any);
    // call 2: license_machines upsert（照旧）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    // call 3: 精确 UPDATE agents
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);
    // call 4: pinned_agent UPDATE
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    await upsertAgentByHeartbeat(QUOTA_ARGS);

    const calls = vi.mocked(pool.query).mock.calls;
    // 已绑定机器必须照旧 upsert license_machines（不能把续命也拦了）
    expect(calls.some(isLicenseMachineInsert)).toBe(true);
  });

  it('新机器 + 配额未满 → 照旧 INSERT license_machines', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // call 1: SELECT 该 (license_id, machine_id) → 无（新机器）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    // call 2: SELECT max_machines + active count → 未满（2/5）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ max: 5, cnt: 2 }] } as any);
    // call 3: license_machines INSERT
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    // call 4: 精确 UPDATE agents
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);
    // call 5: pinned_agent UPDATE
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    await upsertAgentByHeartbeat(QUOTA_ARGS);

    const calls = vi.mocked(pool.query).mock.calls;
    expect(calls.some(isLicenseMachineInsert)).toBe(true);
  });
});
