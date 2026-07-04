/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * agent-tenant-resolver — 中台按 agent 身份反查租户（Line04 客服 P0② NO_TENANT_CONTEXT 根治）
 *
 * 真机根因（2026-07-01 rog 铁证）：listen_chat 用 env/config 派生的 agent_id（如
 * `agent-env-mqz6komb`）POST draft-generate。该 env-id 只写进了 license_machines.agent_id
 * （register 时），从没进 agents.agent_id（心跳建行用随机 ws1-<hex>）。旧 resolveTenantId
 * 只查 agents → 查不到 → 返回空 → NO_TENANT_CONTEXT → 客户消息永远不回。
 *
 * 本 resolver 是「防线 2（中台）」：即使 agents 表没有该行，也能从
 *   service_agents(machine_id) ∪ license_machines(machine_id→license) ∪ license_machines(agent_id→license)
 * 稳健反查租户。deny-by-default：全部查不到才返回 ''（调用方一律 4xx，绝不回退全量）。
 *
 * commit-1 RED（resolver 尚不存在 → import 失败）；commit-2 GREEN。
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveTenantForAgent } from '../agent-tenant-resolver';

const TENANT_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const TENANT_B = 'bbbbbbbb-1111-2222-3333-444444444444';

/** 造一个按 SQL 文本分派返回的假 db（模拟 pg pool.query） */
function makeDb(handlers: Array<{ match: RegExp; rows: any[] }>) {
  const query = vi.fn(async (sql: string) => {
    for (const h of handlers) {
      if (h.match.test(String(sql))) return { rows: h.rows };
    }
    return { rows: [] };
  });
  return { db: { query } as any, query };
}

describe('resolveTenantForAgent [BEHAVIOR]', () => {
  it('agents 表命中 agent_id → 直接返回 tenant（保留既有主路径）', async () => {
    const { db, query } = makeDb([
      { match: /from\s+zenithjoy\.agents\s+where\s+agent_id/i, rows: [{ tenant_id: TENANT_A }] },
    ]);
    const t = await resolveTenantForAgent(db, { agentId: 'ws1-abc' });
    expect(t).toBe(TENANT_A);
    // 命中第一路径后不应再查 license_machines/service_agents
    const laterProbe = query.mock.calls.find((c) => /license_machines|service_agents/i.test(String(c[0])));
    expect(laterProbe).toBeFalsy();
  });

  it('agents 无该行、但 license_machines.agent_id 存该 env-id → 经 license 反查 tenant（真机根因）', async () => {
    const { db, query } = makeDb([
      { match: /from\s+zenithjoy\.agents\s+where\s+agent_id/i, rows: [] },
      { match: /license_machines[\s\S]*agent_id/i, rows: [{ tenant_id: TENANT_A }] },
    ]);
    const t = await resolveTenantForAgent(db, { agentId: 'agent-env-mqz6komb' });
    expect(t, 'env-id 命中 license_machines.agent_id 应反查到租户').toBe(TENANT_A);
    const lmCall = query.mock.calls.find((c) => /license_machines/i.test(String(c[0])) && /agent_id/i.test(String(c[0])));
    expect(lmCall, '必须查 license_machines.agent_id').toBeTruthy();
    expect((lmCall![1] ?? []) as unknown[]).toContain('agent-env-mqz6komb');
  });

  it('给 machine_id 命中 service_agents（CS SSOT）→ 直接返回 tenant', async () => {
    const { db, query } = makeDb([
      { match: /from\s+zenithjoy\.service_agents[\s\S]*machine_id/i, rows: [{ tenant_id: TENANT_B }] },
    ]);
    const t = await resolveTenantForAgent(db, { machineId: '425b144f077a667bb42666821220e06d' });
    expect(t).toBe(TENANT_B);
    const saCall = query.mock.calls.find((c) => /service_agents/i.test(String(c[0])));
    expect(saCall, '必须查 service_agents.machine_id').toBeTruthy();
    expect((saCall![1] ?? []) as unknown[]).toContain('425b144f077a667bb42666821220e06d');
  });

  it('给 machine_id、service_agents 无但 license_machines.machine_id 命中 → 经 license 反查 tenant', async () => {
    const { db } = makeDb([
      { match: /from\s+zenithjoy\.service_agents/i, rows: [] },
      { match: /license_machines[\s\S]*machine_id/i, rows: [{ tenant_id: TENANT_A }] },
    ]);
    const t = await resolveTenantForAgent(db, { machineId: 'm-xyz' });
    expect(t).toBe(TENANT_A);
  });

  it('全部查不到 → 返回 ""（deny-by-default，调用方负责 4xx）', async () => {
    const { db } = makeDb([]);
    const t = await resolveTenantForAgent(db, { agentId: 'unknown', machineId: 'nope' });
    expect(t).toBe('');
  });

  it('agentId 与 machineId 都为空 → 直接返回 "" 且不查库', async () => {
    const { db, query } = makeDb([]);
    const t = await resolveTenantForAgent(db, {});
    expect(t).toBe('');
    expect(query).not.toHaveBeenCalled();
  });

  it('DB 抛错时吞掉并返回 ""（绝不因反查异常回退全量/崩路由）', async () => {
    const db = { query: vi.fn(async () => { throw new Error('db down'); }) } as any;
    const t = await resolveTenantForAgent(db, { agentId: 'x' });
    expect(t).toBe('');
  });
});

describe('resolveTenantForAgent 多租户冲突探测 [BEHAVIOR]', () => {
  it('源1/2 miss、同机近7天命中 2 个 active 租户 → deny 返回 ""，onMultiTenantConflict 被调用且含两租户', async () => {
    const { db } = makeDb([
      { match: /from\s+zenithjoy\.agents\s+where\s+agent_id/i, rows: [] },
      { match: /from\s+zenithjoy\.service_agents/i, rows: [] },
      // 冲突探测 SQL：带 l.status = 'active' 过滤，返回两个不同租户
      { match: /status\s*=\s*'active'/i, rows: [{ tenant_id: TENANT_A }, { tenant_id: TENANT_B }] },
    ]);
    const onMultiTenantConflict = vi.fn(async () => {});
    const t = await resolveTenantForAgent(db, { agentId: 'ax', machineId: 'mx', onMultiTenantConflict });
    expect(t, '探测到多租户冲突必须 deny').toBe('');
    expect(onMultiTenantConflict, '必须触发告警回调').toHaveBeenCalledTimes(1);
    const [mid, tenants] = onMultiTenantConflict.mock.calls[0];
    expect(mid).toBe('mx');
    expect(tenants).toEqual(expect.arrayContaining([TENANT_A, TENANT_B]));
  });

  it('source2（service_agents）命中 → 直接返回该租户，冲突探测 SQL 根本没执行', async () => {
    const { db, query } = makeDb([
      { match: /from\s+zenithjoy\.service_agents[\s\S]*machine_id/i, rows: [{ tenant_id: TENANT_B }] },
    ]);
    const onMultiTenantConflict = vi.fn(async () => {});
    const t = await resolveTenantForAgent(db, { machineId: 'mx', onMultiTenantConflict });
    expect(t).toBe(TENANT_B);
    const probeCall = query.mock.calls.find((c) => /status\s*=\s*'active'/i.test(String(c[0])));
    expect(probeCall, 'SSOT 命中后不得再跑冲突探测').toBeFalsy();
    expect(onMultiTenantConflict).not.toHaveBeenCalled();
  });

  it('探测只返回 1 个租户 → 正常继续走 source3 返回该租户，无告警', async () => {
    const { db } = makeDb([
      { match: /from\s+zenithjoy\.agents\s+where\s+agent_id/i, rows: [] },
      { match: /from\s+zenithjoy\.service_agents/i, rows: [] },
      { match: /status\s*=\s*'active'/i, rows: [{ tenant_id: TENANT_A }] },
      { match: /license_machines[\s\S]*order\s+by\s+lm\.last_seen/i, rows: [{ tenant_id: TENANT_A }] },
    ]);
    const onMultiTenantConflict = vi.fn(async () => {});
    const t = await resolveTenantForAgent(db, { agentId: 'ax', machineId: 'mx', onMultiTenantConflict });
    expect(t).toBe(TENANT_A);
    expect(onMultiTenantConflict).not.toHaveBeenCalled();
  });

  it('冲突探测 SQL 必须含 l.status = \'active\' 与 interval \'7 days\'（revoke 解锁复测的生命线，防误删）', async () => {
    const { db, query } = makeDb([
      { match: /from\s+zenithjoy\.agents\s+where\s+agent_id/i, rows: [] },
      { match: /from\s+zenithjoy\.service_agents/i, rows: [] },
      { match: /status\s*=\s*'active'/i, rows: [{ tenant_id: TENANT_A }, { tenant_id: TENANT_B }] },
    ]);
    await resolveTenantForAgent(db, { agentId: 'ax', machineId: 'mx', onMultiTenantConflict: async () => {} });
    const probeCall = query.mock.calls.find((c) => /status\s*=\s*'active'/i.test(String(c[0])));
    expect(probeCall, '必须执行冲突探测 SQL').toBeTruthy();
    const sql = String(probeCall![0]);
    expect(sql).toMatch(/l\.status\s*=\s*'active'/i);
    expect(sql).toMatch(/interval\s*'7 days'/i);
    expect((probeCall![1] ?? []) as unknown[]).toContain('mx');
  });

  it('onMultiTenantConflict 抛异常 → 告警旁路失败不影响 deny，仍返回 ""', async () => {
    const { db } = makeDb([
      { match: /from\s+zenithjoy\.agents\s+where\s+agent_id/i, rows: [] },
      { match: /from\s+zenithjoy\.service_agents/i, rows: [] },
      { match: /status\s*=\s*'active'/i, rows: [{ tenant_id: TENANT_A }, { tenant_id: TENANT_B }] },
    ]);
    const onMultiTenantConflict = vi.fn(async () => { throw new Error('alert sink down'); });
    const t = await resolveTenantForAgent(db, { agentId: 'ax', machineId: 'mx', onMultiTenantConflict });
    expect(t, '告警回调抛错不得吞掉 deny').toBe('');
  });
});
