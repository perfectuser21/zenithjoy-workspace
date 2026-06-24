/**
 * apps/api/src/services/wechat/cs-account-config-store.ts
 * 每客服配置 DB 存取层 —— 按 wechat_id 物理分行（多租户隔离，决策 04c34b86）。
 *
 * 与旧的全局单行 cs-config-store.ts 区别：旧表 zenithjoy.wechat_cs_config 是全局 key-value
 * （一份人设管所有客户 → 串台 Issue defe1a42）；本表 zenithjoy.wechat_cs_account_config 以
 * 「绑定微信号 wechat_id」为主 key 物理分行，写一行绝不影响另一行。
 *
 * 还承载身份校验异常（wechat_cs_identity_alert）的读写，供诊断页展示。
 *
 * 容错纪律（与 cs-config-store.ts 一致）：读类失败 console.warn 后回落（getCSConfig → null），
 * 写类失败 console.warn 不抛 —— 绝不让 DB 抖动阻塞中台保存或客户机拉配置主链路。
 *
 * SQL 参数形状刻意保持 [wechat_id, JSON.stringify(整份配置)] 两参：既匹配真实多列表（SQL 用
 * $2::jsonb 抽列），也兼容单测里「按 wechat_id 隔离的内存表」mock（只认 params[0]/params[1]）。
 */

import pool from '../../db/connection';
import type { Persona } from './types';

export interface CSAccountConfig {
  wechat_id: string;
  persona: Persona;
  auto_agent_enabled: boolean;
  business_hours_start: string;
  business_hours_end: string;
  key_contact_wechat: string;
  whitelist: string[];
  daily_limit: number;
  updated_at?: string;
}

/** 每客服配置默认值（新客服默认关 = dryrun，绝不在没人配过时真发）。 */
const CS_ACCOUNT_DEFAULTS: Omit<CSAccountConfig, 'wechat_id' | 'persona'> = {
  auto_agent_enabled: false,
  business_hours_start: '06:00',
  business_hours_end: '24:00',
  key_contact_wechat: '',
  whitelist: [],
  daily_limit: 0,
};

export interface IdentityAlert {
  wechat_id: string;
  reason: string;
  created_at?: string;
}

// ─── jsonb 容错：node-pg 可能给对象也可能给字符串 ──────────────────────────────
function asObject<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof raw === 'object') return raw as T;
  return fallback;
}

/** 把一行 DB row（真实多列 或 mock 的整份对象）规整成完整 CSAccountConfig（补默认值）。 */
function normalizeRow(row: Record<string, unknown>): CSAccountConfig {
  return {
    wechat_id: String(row.wechat_id),
    persona: asObject<Persona>(row.persona, {} as Persona),
    auto_agent_enabled: row.auto_agent_enabled === true,
    business_hours_start:
      typeof row.business_hours_start === 'string'
        ? row.business_hours_start
        : CS_ACCOUNT_DEFAULTS.business_hours_start,
    business_hours_end:
      typeof row.business_hours_end === 'string'
        ? row.business_hours_end
        : CS_ACCOUNT_DEFAULTS.business_hours_end,
    key_contact_wechat:
      typeof row.key_contact_wechat === 'string'
        ? row.key_contact_wechat
        : CS_ACCOUNT_DEFAULTS.key_contact_wechat,
    whitelist: asObject<string[]>(row.whitelist, []),
    daily_limit:
      typeof row.daily_limit === 'number' ? row.daily_limit : Number(row.daily_limit ?? 0) || 0,
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : (row.updated_at as string | undefined),
  };
}

/**
 * 读「该客服那一行」。命中 → 规整返回；无行 / DB 失败 → null（不返回任意一份配置，绝不串台）。
 */
export async function getCSConfig(wechatId: string): Promise<CSAccountConfig | null> {
  try {
    const res = await pool.query(
      `SELECT wechat_id, persona, auto_agent_enabled, business_hours_start, business_hours_end,
              key_contact_wechat, whitelist, daily_limit, updated_at
         FROM zenithjoy.wechat_cs_account_config
        WHERE wechat_id = $1`,
      [wechatId],
    );
    const row = res.rows?.[0];
    if (!row) return null;
    return normalizeRow(row as Record<string, unknown>);
  } catch (err) {
    console.warn(`[cs-account-config-store] getCSConfig(${wechatId}) 读取失败:`, err);
    return null;
  }
}

/**
 * 客户机按身份拉：machine_id → service_agents 绑定的 wechat_id → 该客服那一行。
 *
 * 身份链路（决策 143f5d00）：agents.id 那个 UUID 与 service_agents 无直接链，唯一通用 join
 * 键是 machine_id（agent 注册时带、service_agents 也存）。管理员在前台给该客服-PC 绑定填
 * wechat_id（= 该客服配置主 key）。客户机用本机 machine_id 拉自己那份，不靠 RPA 读真实微信号。
 *
 * 任一断点 → null（绝不返回任意一份，不串台）：
 *   - machine_id 未绑定 service_agents（或已软删）
 *   - 已绑 PC 但管理员还没填 wechat_id（wechat_id 为空）
 *   - 绑了微信号但该号还没配过（wechat_cs_account_config 无该行）
 */
export async function getCSConfigByMachine(machineId: string): Promise<CSAccountConfig | null> {
  let wechatId: string | null = null;
  try {
    const res = await pool.query(
      `SELECT wechat_id
         FROM zenithjoy.service_agents
        WHERE machine_id = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [machineId],
    );
    const raw = res.rows?.[0]?.wechat_id;
    wechatId = typeof raw === 'string' && raw.length > 0 ? raw : null;
  } catch (err) {
    console.warn(`[cs-account-config-store] getCSConfigByMachine(${machineId}) 反查绑定失败:`, err);
    return null;
  }
  if (!wechatId) return null;
  return getCSConfig(wechatId);
}

/**
 * 按 agent 身份拉每客服配置：agent 身份 → license_machines.machine_id → 该客服配置。
 * 中台草稿生成(generateChatDraft)用它拿这台机自己那份白名单/人设/开关，而不是查全局/飞书。
 *
 * agent 身份两种都认（决策 8383f3e3）：
 *  - env-id（agents.agent_id 文本列，= license_machines.agent_id）→ 直接命中
 *  - register 返的 agents.id UUID（core setIdentity 传 agentUuid）→ 经 agents 折成 env-id 再命中
 * listener 实际传的是 UUID，只按 env-id 查会落空 → 回落飞书 → 名单内被拒（2026-06-23 实测根因）。
 * 解不到(无链 / 未绑定 / 未配) → null（调用方回落旧逻辑，向后兼容）。
 */
export async function getCSConfigByAgentId(agentId: string): Promise<CSAccountConfig | null> {
  let machineId: string | null = null;
  try {
    const res = await pool.query(
      `SELECT lm.machine_id
         FROM zenithjoy.license_machines lm
        WHERE lm.agent_id = $1
           OR lm.agent_id IN (SELECT agent_id FROM zenithjoy.agents WHERE id::text = $1)
        ORDER BY lm.last_seen DESC LIMIT 1`,
      [agentId],
    );
    const raw = res.rows?.[0]?.machine_id;
    machineId = typeof raw === 'string' && raw.length > 0 ? raw : null;
  } catch (err) {
    console.warn(`[cs-account-config-store] getCSConfigByAgentId(${agentId}) 反查 machine 失败:`, err);
    return null;
  }
  if (!machineId) return null;
  return getCSConfigByMachine(machineId);
}

/**
 * 仅解析「该 agent 绑定的客服微信号」(service_agents.wechat_id)，不要求已配过(wechat_cs_account_config)。
 *
 * 用于 S3 客服工作汇总：消息落库时盖身份章 —— 即使该客服还没在前台配人设/白名单，
 * 只要 PC 已绑定(管理员填了 wechat_id)，就该把消息算到这台客服头上。比 getCSConfigByAgentId
 * 宽（后者要求 config 行存在，无配置 → null）。
 *
 * 身份链同 getCSConfigByAgentId（env-id 与 UUID 两种都认）→ machine_id → service_agents.wechat_id。
 * 任一断点 → null（解不到就不盖章，老数据/解析失败按 NULL，统计时不计入、不串台）。
 */
export async function resolveCsWechatIdByAgentId(agentId: string): Promise<string | null> {
  if (!agentId) return null;
  try {
    const res = await pool.query(
      `SELECT sa.wechat_id
         FROM zenithjoy.license_machines lm
         JOIN zenithjoy.service_agents sa
           ON sa.machine_id = lm.machine_id AND sa.deleted_at IS NULL
        WHERE lm.agent_id = $1
           OR lm.agent_id IN (SELECT agent_id FROM zenithjoy.agents WHERE id::text = $1)
        ORDER BY lm.last_seen DESC
        LIMIT 1`,
      [agentId],
    );
    const raw = res.rows?.[0]?.wechat_id;
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  } catch (err) {
    console.warn(`[cs-account-config-store] resolveCsWechatIdByAgentId(${agentId}) 反查失败:`, err);
    return null;
  }
}

export interface PendingMachine {
  machine_id: string;
  hostname?: string;
  last_seen?: string;
}

/**
 * 列出「在敲门但还没配」的机器：最近 10 分钟拉配置被拒(unregistered_machine)、且还没绑定的
 * machine_id。供一键配置页让管理员挑选——机器自己注册上来报到，管理员不用手抄 machine_id。
 */
export async function listPendingMachines(limit = 50): Promise<PendingMachine[]> {
  try {
    const res = await pool.query(
      `SELECT a.wechat_id AS machine_id,
              MAX(a.created_at) AS last_seen,
              MAX(lm.hostname) AS hostname
         FROM zenithjoy.wechat_cs_identity_alert a
         LEFT JOIN zenithjoy.license_machines lm ON lm.machine_id = a.wechat_id
        WHERE a.reason = 'unregistered_machine'
          AND a.created_at > NOW() - interval '10 minutes'
          AND NOT EXISTS (
            SELECT 1 FROM zenithjoy.service_agents s
             WHERE s.machine_id = a.wechat_id AND s.deleted_at IS NULL
          )
        GROUP BY a.wechat_id
        ORDER BY MAX(a.created_at) DESC
        LIMIT $1`,
      [limit],
    );
    return (res.rows ?? []).map((r: Record<string, unknown>) => ({
      machine_id: String(r.machine_id),
      hostname: r.hostname ? String(r.hostname) : undefined,
      last_seen:
        r.last_seen instanceof Date ? r.last_seen.toISOString() : (r.last_seen as string | undefined),
    }));
  } catch (err) {
    console.warn('[cs-account-config-store] listPendingMachines 失败:', err);
    return [];
  }
}

export interface CSMachine {
  machine_id: string;
  hostname?: string;
  last_seen?: string;
  configured: boolean;
  wechat_id?: string;
  self_name?: string;
  whitelist?: string[];
  auto_agent_enabled?: boolean;
  // 健康（最新一份 line04 自报，前台一处看到，不用再去诊断页）：
  online?: boolean; // 5 分钟内有心跳
  wechat_ok?: boolean; // line04 健康（窗口找到+能发）
  wechat_reason?: string; // 不健康原因（#835 精确：没登录 / 登录了但UIA瞎 …）
  found_window?: boolean;
  login_present?: boolean;
}

/**
 * 列出「我的全部客服机」：注册过的每台机器(license_machines)+ 它当前的配置状态(已配/待配 +
 * 白名单/人设/开关)。供前台「我的客服机」列表——已配的也能点进去改白名单，不像 pending 列表
 * 只显示没配过的。按 machine_id 去重取最新一条 hostname。
 */
export async function listAllMachines(limit = 100): Promise<CSMachine[]> {
  try {
    const res = await pool.query(
      `SELECT lm.machine_id,
              MAX(lm.hostname)        AS hostname,
              MAX(lm.last_seen)       AS last_seen,
              MAX(sa.wechat_id)       AS wechat_id,
              MAX(c.persona->>'self_name')   AS self_name,
              MAX(c.whitelist::text)         AS whitelist,
              bool_or(c.auto_agent_enabled)  AS auto_agent_enabled,
              bool_or(c.wechat_id IS NOT NULL) AS configured,
              MAX(h.l04_ok)        AS wechat_ok,
              MAX(h.l04_reason)    AS wechat_reason,
              MAX(h.found_window)  AS found_window,
              MAX(h.login_present) AS login_present,
              bool_or(h.last_hb > NOW() - interval '5 minutes') AS online
         FROM zenithjoy.license_machines lm
         LEFT JOIN zenithjoy.service_agents sa
                ON sa.machine_id = lm.machine_id AND sa.deleted_at IS NULL
         LEFT JOIN zenithjoy.wechat_cs_account_config c
                ON c.wechat_id = sa.wechat_id
         LEFT JOIN LATERAL (
                SELECT a.module_status->'line04-wechat-cs'->>'ok'           AS l04_ok,
                       a.module_status->'line04-wechat-cs'->>'reason'       AS l04_reason,
                       a.module_status->'line04-wechat-cs'->>'found_window' AS found_window,
                       a.module_status->'line04-wechat-cs'->>'login_present' AS login_present,
                       a.last_heartbeat_at AS last_hb
                  FROM zenithjoy.agents a
                 WHERE a.hostname = lm.hostname AND a.last_heartbeat_at IS NOT NULL
                 ORDER BY a.last_heartbeat_at DESC LIMIT 1
              ) h ON true
        GROUP BY lm.machine_id
        ORDER BY bool_or(h.last_hb > NOW() - interval '5 minutes') DESC NULLS LAST,
                 MAX(lm.last_seen) DESC NULLS LAST
        LIMIT $1`,
      [limit],
    );
    const asBool = (v: unknown): boolean | undefined =>
      v === null || v === undefined ? undefined : String(v) === 'true' || v === true;
    return (res.rows ?? []).map((r: Record<string, unknown>) => {
      let whitelist: string[] | undefined;
      try {
        whitelist = r.whitelist ? (JSON.parse(String(r.whitelist)) as string[]) : undefined;
      } catch {
        whitelist = undefined;
      }
      return {
        machine_id: String(r.machine_id),
        hostname: r.hostname ? String(r.hostname) : undefined,
        last_seen:
          r.last_seen instanceof Date ? r.last_seen.toISOString() : (r.last_seen as string | undefined),
        configured: Boolean(r.configured),
        wechat_id: r.wechat_id ? String(r.wechat_id) : undefined,
        self_name: r.self_name ? String(r.self_name) : undefined,
        whitelist,
        auto_agent_enabled: r.auto_agent_enabled === null ? undefined : Boolean(r.auto_agent_enabled),
        online: r.online === null ? undefined : Boolean(r.online),
        wechat_ok: asBool(r.wechat_ok),
        wechat_reason: r.wechat_reason ? String(r.wechat_reason) : undefined,
        found_window: asBool(r.found_window),
        login_present: asBool(r.login_present),
      };
    });
  } catch (err) {
    console.warn('[cs-account-config-store] listAllMachines 失败:', err);
    return [];
  }
}

/**
 * 一键配置：给某台机器(machine_id)自动绑定 + 写配置。管理员只填人设/白名单/开关，
 * machine_id 由机器自己注册上来(前台从 pending 列表挑)，wechat_id/租户/绑定全自动——
 * 不再让人手抄 machine_id hash。
 *
 * 流程：① 经 license_machines 解析机器所属租户 ② 派生 wechat_id(可填友好名，缺省 cs-<前缀>)
 * ③ upsert service_agents 绑定 ④ saveCSConfig 写配置。机器没注册过(无 license)→ 抛错(路由转 400)。
 */
export async function setupCSByMachine(
  machineId: string,
  patch: Partial<CSAccountConfig> & { persona: Persona; wechat_id?: string },
): Promise<{ wechat_id: string; agent_id: string | null }> {
  const ten = await pool.query(
    `SELECT l.tenant_id, lm.agent_id
       FROM zenithjoy.license_machines lm
       JOIN zenithjoy.licenses l ON l.id = lm.license_id
      WHERE lm.machine_id = $1
      ORDER BY lm.last_seen DESC
      LIMIT 1`,
    [machineId],
  );
  const tenantId = ten.rows?.[0]?.tenant_id as string | undefined;
  const agentId = (ten.rows?.[0]?.agent_id as string | undefined) ?? null;
  if (!tenantId) {
    throw new Error(`machine ${machineId} 未注册到任何 license/租户，无法配置`);
  }
  const wechatId =
    typeof patch.wechat_id === 'string' && patch.wechat_id.trim()
      ? patch.wechat_id.trim()
      : `cs-${machineId.slice(0, 8)}`;
  await pool.query(
    `INSERT INTO zenithjoy.service_agents (tenant_id, machine_id, wechat_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (machine_id) WHERE deleted_at IS NULL
       DO UPDATE SET wechat_id = EXCLUDED.wechat_id, updated_at = now()`,
    [tenantId, machineId, wechatId],
  );
  await saveCSConfig(wechatId, patch);
  return { wechat_id: wechatId, agent_id: agentId };
}

/**
 * upsert「该客服那一行」（patch 必含 persona；其余字段缺省走默认值）。
 * 只写该 wechat_id 那一行，ON CONFLICT 更新同行，绝不动其他客服行。
 */
export async function saveCSConfig(
  wechatId: string,
  patch: Partial<CSAccountConfig> & { persona: Persona },
): Promise<void> {
  const full: Omit<CSAccountConfig, 'wechat_id' | 'updated_at'> = {
    persona: patch.persona,
    auto_agent_enabled: patch.auto_agent_enabled ?? CS_ACCOUNT_DEFAULTS.auto_agent_enabled,
    business_hours_start: patch.business_hours_start ?? CS_ACCOUNT_DEFAULTS.business_hours_start,
    business_hours_end: patch.business_hours_end ?? CS_ACCOUNT_DEFAULTS.business_hours_end,
    key_contact_wechat: patch.key_contact_wechat ?? CS_ACCOUNT_DEFAULTS.key_contact_wechat,
    whitelist: patch.whitelist ?? CS_ACCOUNT_DEFAULTS.whitelist,
    daily_limit: patch.daily_limit ?? CS_ACCOUNT_DEFAULTS.daily_limit,
  };
  try {
    await pool.query(
      `INSERT INTO zenithjoy.wechat_cs_account_config
         (wechat_id, persona, auto_agent_enabled, business_hours_start, business_hours_end,
          key_contact_wechat, whitelist, daily_limit, updated_at)
       SELECT $1,
              ($2::jsonb)->'persona',
              COALESCE((($2::jsonb)->>'auto_agent_enabled')::boolean, false),
              ($2::jsonb)->>'business_hours_start',
              ($2::jsonb)->>'business_hours_end',
              ($2::jsonb)->>'key_contact_wechat',
              ($2::jsonb)->'whitelist',
              COALESCE((($2::jsonb)->>'daily_limit')::int, 0),
              now()
       ON CONFLICT (wechat_id) DO UPDATE
         SET persona = EXCLUDED.persona,
             auto_agent_enabled = EXCLUDED.auto_agent_enabled,
             business_hours_start = EXCLUDED.business_hours_start,
             business_hours_end = EXCLUDED.business_hours_end,
             key_contact_wechat = EXCLUDED.key_contact_wechat,
             whitelist = EXCLUDED.whitelist,
             daily_limit = EXCLUDED.daily_limit,
             updated_at = now()`,
      [wechatId, JSON.stringify(full)],
    );
  } catch (err) {
    console.warn(`[cs-account-config-store] saveCSConfig(${wechatId}) 写入失败:`, err);
  }
}

/** 写一条身份校验异常（登录号 ≠ 绑定号 / 未注册号拉配置）。失败 console.warn 不抛。 */
export async function recordIdentityAlert(wechatId: string, reason: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO zenithjoy.wechat_cs_identity_alert (wechat_id, reason) VALUES ($1, $2)`,
      [wechatId, reason],
    );
  } catch (err) {
    console.warn(`[cs-account-config-store] recordIdentityAlert(${wechatId}) 写入失败:`, err);
  }
}

/** 读最近身份校验异常（诊断页数据源）。失败回落空数组。 */
export async function listIdentityAlerts(limit = 100): Promise<IdentityAlert[]> {
  try {
    const res = await pool.query(
      `SELECT wechat_id, reason, created_at
         FROM zenithjoy.wechat_cs_identity_alert
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    );
    return (res.rows ?? []).map((r: Record<string, unknown>) => ({
      wechat_id: String(r.wechat_id),
      reason: String(r.reason),
      created_at:
        r.created_at instanceof Date ? r.created_at.toISOString() : (r.created_at as string | undefined),
    }));
  } catch (err) {
    console.warn('[cs-account-config-store] listIdentityAlerts 读取失败:', err);
    return [];
  }
}
