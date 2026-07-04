/**
 * agent-tenant-resolver — 按 agent 身份稳健反查租户（Line04 客服 P0② NO_TENANT_CONTEXT 根治）
 *
 * 真机根因（2026-07-01 rog 铁证）：
 *   listen_chat 用 env/config 派生的 agent_id（如 `agent-env-mqz6komb`）POST /api/wechat/draft-generate。
 *   这个 env-id 只在 register 时写进了 license_machines.agent_id，从没进 agents.agent_id
 *   （心跳建行用随机 `ws1-<hex>`）。旧 resolveTenantId 只查 agents 表 → 查不到 → 返回空
 *   → NO_TENANT_CONTEXT → 客户消息永远不回。今晚 rog 靠手工往 agents 插一行热修，重启即失效。
 *
 * 本模块是「防线 2（中台）」：即使 agents 表暂时没有该 agent 行，也从下列来源稳健反查租户：
 *   1) agents          按 agent_id（text 列）或 id（UUID）——保留既有主路径
 *   2) service_agents   按 machine_id（客服绑定 SSOT，决策 143f5d00，最权威）
 *   3) license_machines 按 machine_id → licenses.tenant_id
 *   4) license_machines 按 agent_id（env-id）→ licenses.tenant_id  ← 直接治真机根因
 *
 * deny-by-default：全部查不到才返回 ''（调用方一律 4xx，绝不回退不带 tenant 过滤的全量）。
 * 任何 DB 异常都吞掉返回 ''（反查是旁路，绝不因反查失败崩路由 / 回退全量）。
 */

/** 最小可注入的 pg 查询接口（便于单测注入假 db） */
export interface TenantResolverDb {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

interface TenantRow {
  tenant_id: string | null;
}

function firstTenant(rows: TenantRow[]): string {
  const t = rows?.[0]?.tenant_id;
  return typeof t === 'string' && t.trim().length > 0 ? t.trim() : '';
}

/**
 * 按 agent 身份反查租户。返回 '' 表示查不到（deny-by-default）。
 * @param db     pg pool（或任何实现 query 的对象）
 * @param opts   agentId = listen_chat 上报的 agent 标识（env-id / ws1-id / UUID 皆可）；
 *               machineId = 稳定机器指纹（心跳 / listen_chat 可带）。
 */
export async function resolveTenantForAgent(
  db: TenantResolverDb,
  opts: {
    agentId?: string | null;
    machineId?: string | null;
    /**
     * 多租户冲突告警回调（可选注入，避免 resolver 直接 import 全局 pool 的
     * cs-account-config-store 造成耦合）。探测到同机多租户时调用；抛异常不影响 deny。
     */
    onMultiTenantConflict?: (machineId: string, tenants: string[]) => Promise<void>;
  },
): Promise<string> {
  const agentId = (opts.agentId ?? '').trim();
  const machineId = (opts.machineId ?? '').trim();
  if (!agentId && !machineId) return '';

  try {
    // 1) agents：按 agent_id 文本列或 id::text（UUID）——保留既有主路径
    if (agentId) {
      const r = await db.query<TenantRow>(
        `SELECT tenant_id FROM zenithjoy.agents
          WHERE agent_id = $1 OR id::text = $1
          LIMIT 1`,
        [agentId],
      );
      const t = firstTenant(r.rows);
      if (t) return t;
    }

    // 2) service_agents：按 machine_id（客服绑定 SSOT，最权威）
    if (machineId) {
      const r = await db.query<TenantRow>(
        `SELECT tenant_id FROM zenithjoy.service_agents
          WHERE machine_id = $1 AND deleted_at IS NULL
          ORDER BY updated_at DESC
          LIMIT 1`,
        [machineId],
      );
      const t = firstTenant(r.rows);
      if (t) return t;
    }

    // 2.5) 多租户冲突探测：同一台机器近7天在多个 active license 下心跳 → 告警 + deny，
    //      绝不靠 last_seen 静默二选一（0704 会议室实锤：旧租户行比新租户更活跃，选"最新"必错）。
    if (machineId) {
      const c = await db.query<TenantRow>(
        `SELECT DISTINCT l.tenant_id
           FROM zenithjoy.license_machines lm
           JOIN zenithjoy.licenses l ON l.id = lm.license_id
          WHERE lm.machine_id = $1
            AND l.tenant_id IS NOT NULL
            AND l.status = 'active'
            AND lm.last_seen > now() - interval '7 days'`,
        [machineId],
      );
      const tenants = [...new Set(c.rows.map((r) => r.tenant_id).filter((t): t is string => typeof t === 'string' && t.trim().length > 0))];
      if (tenants.length > 1) {
        try { await opts.onMultiTenantConflict?.(machineId, tenants); } catch { /* 告警旁路失败不影响 deny */ }
        console.error(`[agent-tenant-resolver] 机器 ${machineId} 近7天命中 ${tenants.length} 个 active 租户，deny（multi_tenant_machine）`);
        return '';
      }
    }

    // 3) license_machines → licenses：按 machine_id
    if (machineId) {
      const r = await db.query<TenantRow>(
        `SELECT l.tenant_id
           FROM zenithjoy.license_machines lm
           JOIN zenithjoy.licenses l ON l.id = lm.license_id
          WHERE lm.machine_id = $1 AND l.tenant_id IS NOT NULL
          ORDER BY lm.last_seen DESC
          LIMIT 1`,
        [machineId],
      );
      const t = firstTenant(r.rows);
      if (t) return t;
    }

    // 4) license_machines → licenses：按 agent_id（env-id）← 治真机根因
    if (agentId) {
      const r = await db.query<TenantRow>(
        `SELECT l.tenant_id
           FROM zenithjoy.license_machines lm
           JOIN zenithjoy.licenses l ON l.id = lm.license_id
          WHERE lm.agent_id = $1 AND l.tenant_id IS NOT NULL
          ORDER BY lm.last_seen DESC
          LIMIT 1`,
        [agentId],
      );
      const t = firstTenant(r.rows);
      if (t) return t;
    }
  } catch (err) {
    // 反查是旁路：任何异常吞掉返回 ''（调用方 deny-by-default，绝不崩路由 / 回退全量）
    console.error('[agent-tenant-resolver] 反查租户异常（已吞，返回空）:', err);
    return '';
  }

  return '';
}
