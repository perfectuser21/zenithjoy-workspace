/**
 * agent-identity-lookup — 按设备上报的 `x-agent-id` **反查** agents 行并消除歧义（读取侧）。
 *
 * 与同目录 `agent-identity.ts` 分工（两者方向相反，别搞混）：
 *   agent-identity.ts        写入侧：心跳/注册时按哪个维度**去重建行**（machine_id 优先于 hostname）
 *   agent-identity-lookup.ts 读取侧：设备发来一个 id，**该认哪一行**
 *
 * 病根（2026-08-19 → 08-20 真机确诊）：五处路由都写着
 *   `WHERE agent_id = $1 OR id::text = $1 LIMIT 1`
 * **无 ORDER BY**。agents 表里存在「交叉污染」行——A 行的 agent_id 存着 B 行的 id。
 * 设备发一个值过来两行都能命中（一行靠 agent_id、一行靠 id），Postgres 返回哪行看运气。
 * staging 库现存 3 对这样的行，**每对横跨两个不同租户**。
 *
 * 后果不是「时好时坏」那么轻：命中错行 → 解析出**别的租户**的 tenant_id →
 * `pending-collect-tasks` 按那个 tenant 过滤后，**把另一个租户的任务发给这台设备**。
 *
 * 判定哲学与本仓库既有先例一致（见 agent-tenant-resolver.ts 的 machine_id 多租户探测）：
 *   **同租户内可以确定性择一；跨租户一律告警 + deny，绝不静默二选一。**
 * 那边的注释原话是「0704 会议室实锤：旧租户行比新租户更活跃，选『最新』必错」。
 *
 * 确定性择一的方向：设备手里的 id 来自心跳响应的 `agent_id: agent.id`，也就是
 * **agents.id**，所以 id 命中优先于 agent_id 命中；都不是 id 命中时按 id 字典序取最小，
 * 保证与行返回顺序无关。
 */

export interface AgentIdentityRow {
  id: string;
  agent_id: string | null;
  tenant_id: string | null;
}

export type AgentIdentityResolution =
  | {
      kind: 'resolved';
      id: string;
      agentId: string | null;
      tenantId: string;
      /** 命中了不止一行（数据脏）——已确定性择一，但调用方应当留痕 */
      ambiguous: boolean;
    }
  | { kind: 'cross_tenant_ambiguous'; tenantIds: string[]; rowIds: string[] }
  | { kind: 'not_found' };

const trimmed = (v: string | null | undefined): string => (v ?? '').trim();

/**
 * 纯函数：从「已按 agent_id/id 双条件查出的全部候选行」里定出唯一身份。
 * 调用方负责查询时**不要加 LIMIT 1**——那正是病根。
 */
export function resolveAgentIdentity(
  rows: AgentIdentityRow[],
  headerId: string,
): AgentIdentityResolution {
  const key = trimmed(headerId);
  if (!key) return { kind: 'not_found' };
  if (!rows || rows.length === 0) return { kind: 'not_found' };

  const withTenant = rows.filter((r) => trimmed(r.tenant_id).length > 0);
  if (withTenant.length === 0) return { kind: 'not_found' };

  const tenantIds = [...new Set(withTenant.map((r) => trimmed(r.tenant_id)))];
  if (tenantIds.length > 1) {
    // 跨租户歧义：返回任何一个 tenantId 都等于把别人的任务发出去，一律 deny。
    return {
      kind: 'cross_tenant_ambiguous',
      tenantIds: tenantIds.sort(),
      rowIds: rows.map((r) => r.id).sort(),
    };
  }

  // 同租户：id 命中优先；否则按 id 字典序取最小，保证与返回顺序无关
  const sorted = [...withTenant].sort((a, b) => a.id.localeCompare(b.id));
  const picked = sorted.find((r) => r.id === key) ?? sorted[0];

  return {
    kind: 'resolved',
    id: picked.id,
    agentId: picked.agent_id,
    tenantId: trimmed(picked.tenant_id),
    ambiguous: rows.length > 1,
  };
}

/** 最小可注入的 pg 查询接口（便于单测注入假 db，同 agent-tenant-resolver 的做法） */
export interface AgentIdentityDb {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

/**
 * 查库 + 消歧的一站式入口。**故意不加 LIMIT 1**（加了就回到病根），
 * 用 LIMIT 10 兜住异常数据量。
 *
 * 歧义一律留痕：数据脏了必须能被看见，不能悄悄糊过去——0819 那次「时好时坏」
 * 排查了三个晚上，就是因为它从头到尾一声不吭。
 */
export async function lookupAgentIdentity(
  db: AgentIdentityDb,
  headerId: string,
): Promise<AgentIdentityResolution> {
  const key = trimmed(headerId);
  if (!key) return { kind: 'not_found' };

  const { rows } = await db.query<AgentIdentityRow>(
    `SELECT id::text AS id, agent_id, tenant_id
       FROM zenithjoy.agents
      WHERE agent_id = $1 OR id::text = $1
      LIMIT 10`,
    [key],
  );

  const resolution = resolveAgentIdentity(rows, key);
  if (resolution.kind === 'cross_tenant_ambiguous') {
    console.error(
      `[agent-identity] 跨租户歧义，拒绝解析 x-agent-id=${key} —— ` +
        `命中 ${resolution.rowIds.length} 行、横跨租户 ${resolution.tenantIds.join('/')}；` +
        `这是 agents 表 id/agent_id 交叉污染，需人工清理：rows=${resolution.rowIds.join(',')}`,
    );
  } else if (resolution.kind === 'resolved' && resolution.ambiguous) {
    console.warn(
      `[agent-identity] x-agent-id=${key} 命中多行（同租户），已按 id 命中优先确定性择一 → ${resolution.id}`,
    );
  }
  return resolution;
}
