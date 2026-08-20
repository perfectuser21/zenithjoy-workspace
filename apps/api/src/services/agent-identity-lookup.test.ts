import { describe, expect, it } from 'vitest';
import { lookupAgentIdentity, resolveAgentIdentity, type AgentIdentityRow } from './agent-identity-lookup';

/**
 * 真机确诊（2026-08-19 → 08-20）：`WHERE agent_id = $1 OR id::text = $1 LIMIT 1` **无排序**。
 *
 * agents 表里存在「交叉污染」行——A 行的 agent_id 存着 B 行的 id。设备发一个值过来，
 * 两行都能命中（一行靠 agent_id、一行靠 id），返回哪行**看运气**。
 * staging 库现存 3 对这样的行，**每对横跨两个不同租户**。
 *
 * 这不只是"时好时坏"：命中错行 → 解析出**别的租户**的 tenant_id →
 * `pending-collect-tasks` 按那个 tenant 过滤后，**把另一个租户的任务发给这台设备**。
 * 那是跨租户泄漏，不是 flaky。
 *
 * 判定哲学与本仓库既有先例一致（agent-tenant-resolver.ts 的 machine_id 多租户探测）：
 * **同租户内可以确定性择一；跨租户一律告警 + deny，绝不静默二选一**
 * ——注释原话「0704 会议室实锤：旧租户行比新租户更活跃，选『最新』必错」。
 *
 * 确定性择一的方向：设备手里的 id 来自心跳响应 `agent_id: agent.id`，即 **agents.id**，
 * 所以 id 命中优先于 agent_id 命中。
 */
const TENANT_A = 'tenant-aaaa';
const TENANT_B = 'tenant-bbbb';

const row = (id: string, agentId: string | null, tenantId: string): AgentIdentityRow => ({
  id,
  agent_id: agentId,
  tenant_id: tenantId,
});

describe('resolveAgentIdentity — 唯一命中 [BEHAVIOR]', () => {
  it('一行命中 → 直接用它', () => {
    const r = resolveAgentIdentity([row('uuid-1', 'uuid-1', TENANT_A)], 'uuid-1');

    expect(r.kind).toBe('resolved');
    if (r.kind !== 'resolved') return;
    expect(r.tenantId).toBe(TENANT_A);
    expect(r.id).toBe('uuid-1');
    expect(r.ambiguous).toBe(false);
  });

  it('一行都不命中 → not_found（调用方按现状返回空清单，不回退不带 tenant 过滤）', () => {
    expect(resolveAgentIdentity([], 'nobody').kind).toBe('not_found');
  });

  it('header 为空 → not_found，绝不当成"匹配所有"', () => {
    expect(resolveAgentIdentity([row('uuid-1', 'uuid-1', TENANT_A)], '').kind).toBe('not_found');
    expect(resolveAgentIdentity([row('uuid-1', 'uuid-1', TENANT_A)], '   ').kind).toBe('not_found');
  });
});

describe('resolveAgentIdentity — 跨租户歧义必须 deny [REGRESSION]', () => {
  // staging 库现存的 3 对交叉污染行就是这个形状
  it('两行分属不同租户 → cross_tenant_ambiguous，绝不静默二选一', () => {
    const rows = [
      row('uuid-A', 'uuid-B', TENANT_A), // A 行的 agent_id 存着 B 行的 id
      row('uuid-B', 'uuid-Z', TENANT_B),
    ];

    const r = resolveAgentIdentity(rows, 'uuid-B');

    expect(r.kind).toBe('cross_tenant_ambiguous');
    if (r.kind !== 'cross_tenant_ambiguous') return;
    expect(r.tenantIds.sort()).toEqual([TENANT_A, TENANT_B].sort());
    expect(r.rowIds.sort()).toEqual(['uuid-A', 'uuid-B'].sort());
  });

  it('跨租户歧义时不返回任何 tenantId —— 返回了就等于把别人的任务发出去', () => {
    const r = resolveAgentIdentity(
      [row('uuid-A', 'uuid-B', TENANT_A), row('uuid-B', null, TENANT_B)],
      'uuid-B',
    );
    expect(r).not.toHaveProperty('tenantId');
  });
});

describe('resolveAgentIdentity — 同租户歧义可确定性择一 [BEHAVIOR]', () => {
  it('同租户两行 → 选 id 命中那行（设备手里的 id 来自心跳返回的 agents.id）', () => {
    const rows = [
      row('uuid-A', 'uuid-B', TENANT_A), // 靠 agent_id 命中
      row('uuid-B', 'uuid-Z', TENANT_A), // 靠 id 命中 ← 应该选它
    ];

    const r = resolveAgentIdentity(rows, 'uuid-B');

    expect(r.kind).toBe('resolved');
    if (r.kind !== 'resolved') return;
    expect(r.id).toBe('uuid-B');
    expect(r.tenantId).toBe(TENANT_A);
  });

  it('同租户歧义必须打上 ambiguous 标记 —— 数据脏了要能被看见，不能悄悄糊过去', () => {
    const rows = [row('uuid-A', 'uuid-B', TENANT_A), row('uuid-B', 'uuid-Z', TENANT_A)];

    const r = resolveAgentIdentity(rows, 'uuid-B');

    expect(r.kind).toBe('resolved');
    if (r.kind !== 'resolved') return;
    expect(r.ambiguous).toBe(true);
  });

  it('顺序颠倒结果必须一样 —— 这就是"无序 LIMIT 1"的病根', () => {
    const a = row('uuid-A', 'uuid-B', TENANT_A);
    const b = row('uuid-B', 'uuid-Z', TENANT_A);

    const r1 = resolveAgentIdentity([a, b], 'uuid-B');
    const r2 = resolveAgentIdentity([b, a], 'uuid-B');

    expect(r1).toEqual(r2);
  });

  it('没有任何一行是 id 命中（全靠 agent_id 命中）→ 仍确定性取第一个 id 字典序最小的行', () => {
    const rows = [row('uuid-Z', 'slug-x', TENANT_A), row('uuid-A', 'slug-x', TENANT_A)];

    const r1 = resolveAgentIdentity(rows, 'slug-x');
    const r2 = resolveAgentIdentity([...rows].reverse(), 'slug-x');

    expect(r1).toEqual(r2);
    expect(r1.kind).toBe('resolved');
    if (r1.kind !== 'resolved') return;
    expect(r1.id).toBe('uuid-A');
  });

  it('tenant_id 为空的行不参与租户冲突判定，也不会被选中', () => {
    const rows: AgentIdentityRow[] = [
      { id: 'uuid-A', agent_id: 'uuid-B', tenant_id: null },
      row('uuid-B', 'uuid-Z', TENANT_A),
    ];

    const r = resolveAgentIdentity(rows, 'uuid-B');

    expect(r.kind).toBe('resolved');
    if (r.kind !== 'resolved') return;
    expect(r.tenantId).toBe(TENANT_A);
  });
});

describe('lookupAgentIdentity — 查询本身不许回到病根 [REGRESSION]', () => {
  const fakeDb = (rows: AgentIdentityRow[]) => {
    let sql = '';
    return {
      db: { query: async (q: string) => { sql = q; return { rows }; } },
      lastSql: () => sql,
    };
  };

  it('SQL 绝不能带 LIMIT 1 —— 那正是「返回哪行看运气」的病根', async () => {
    const f = fakeDb([]);
    await lookupAgentIdentity(f.db, 'uuid-1');

    expect(f.lastSql()).not.toMatch(/LIMIT\s+1\s*`?\s*$/im);
    expect(f.lastSql()).toMatch(/agent_id\s*=\s*\$1\s+OR\s+id::text\s*=\s*\$1/i);
  });

  it('必须把全部候选行取回来才有得消歧（不是取一行）', async () => {
    const f = fakeDb([]);
    await lookupAgentIdentity(f.db, 'uuid-1');
    const m = f.lastSql().match(/LIMIT\s+(\d+)/i);

    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(1);
  });

  it('跨租户歧义 → 不返回任何租户（真走一遍查库路径）', async () => {
    const f = fakeDb([
      { id: 'uuid-A', agent_id: 'uuid-B', tenant_id: 'tenant-aaaa' },
      { id: 'uuid-B', agent_id: 'uuid-Z', tenant_id: 'tenant-bbbb' },
    ]);

    const r = await lookupAgentIdentity(f.db, 'uuid-B');

    expect(r.kind).toBe('cross_tenant_ambiguous');
    expect(r).not.toHaveProperty('tenantId');
  });
});
