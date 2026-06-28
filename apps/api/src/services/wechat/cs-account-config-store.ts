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
import { listHeartbeats, type HeartbeatRecord } from '../wechat-heartbeat';
import type { BusinessKB, Persona } from './types';

export interface CSAccountConfig {
  wechat_id: string;
  /**
   * IA 重设计刀1（反转 PR#940）：每号承载**完整** persona（self_name + 全套 style），每号独立。
   * 用户拍板「每个客服号要不同名字+语气+话术」。全局话术库 wechat_cs_config 仅作回落兜底（deprecated）。
   */
  persona: Persona;
  /**
   * IA 重设计刀1：每号独立的企业知识库（company/products/audience_segments/qa_docs）。
   * 用户拍板「知识库也每号独立（不同号可扮不同业务）」。空 {} → AI 回复回落全局兜底。
   */
  business_kb: BusinessKB;
  auto_agent_enabled: boolean;
  business_hours_start: string;
  business_hours_end: string;
  key_contact_wechat: string;
  whitelist: string[];
  daily_limit: number;
  updated_at?: string;
}

/** 每客服配置默认值（新客服默认关 = dryrun，绝不在没人配过时真发）。 */
const CS_ACCOUNT_DEFAULTS: Omit<CSAccountConfig, 'wechat_id' | 'persona' | 'business_kb'> = {
  auto_agent_enabled: false,
  business_hours_start: '06:00',
  business_hours_end: '24:00',
  key_contact_wechat: '',
  whitelist: [],
  daily_limit: 0,
};

/** 空 persona / 空 business_kb（新号无配时占位，落库写 {}，读出补结构）。 */
const EMPTY_PERSONA = {} as Persona;
const EMPTY_KB = {} as BusinessKB;

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
    business_kb: asObject<BusinessKB>(row.business_kb, {} as BusinessKB),
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
      `SELECT wechat_id, persona, business_kb, auto_agent_enabled, business_hours_start, business_hours_end,
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
  wechat_id?: string; // 合成 id（cs-<前缀>）= 配置主 key，内部用
  real_wechat_id?: string; // 真实微信号（perfect-xx，SSOT，运营手填）
  wechat_display_name?: string; // 微信昵称（默忆，前端 display）
  self_name?: string; // AI 人设名（小苏），≠ 微信昵称
  whitelist?: string[];
  auto_agent_enabled?: boolean;
  // 健康（最新一份 line04 自报，前台一处看到，不用再去诊断页）：
  online?: boolean; // 5 分钟内有心跳
  wechat_ok?: boolean; // line04 健康（窗口找到+能发）
  wechat_reason?: string; // 不健康原因（#835 精确：没登录 / 登录了但UIA瞎 …）
  found_window?: boolean;
  login_present?: boolean;
  agent_id?: string; // license_machines.agent_id（env-id），匹配 listen_chat 心跳用
}

/**
 * 列出「我的全部客服机」：注册过的每台机器(license_machines)+ 它当前的配置状态(已配/待配 +
 * 白名单/人设/开关)。供前台「我的客服机」列表——已配的也能点进去改白名单，不像 pending 列表
 * 只显示没配过的。按 machine_id 去重取最新一条 hostname。
 *
 * per-operator scope（修「乱列表」）：传 tenantId（普通租户运营）→ **只列绑到该租户的客服机**
 *   （按 service_agents.tenant_id 过滤，该列在一键配置时由 license 落定，是客服机的归属租户主键）。
 *   不传 tenantId（super-admin 旁路）→ 列全部（保留超管全局视角，与 CRM 读闸同模型）。
 *   注意：scope 时以 service_agents 为驱动表（INNER），未绑定/待配机器不出现在运营视图
 *   （那是「待配」列表 listPendingMachines 的职责，运营不该看见别人未认领的机器）。
 */
export async function listAllMachines(tenantId?: string, limit = 100): Promise<CSMachine[]> {
  try {
    const scoped = typeof tenantId === 'string' && tenantId.length > 0;
    // Bug D：scoped(运营) 原以 service_agents 为驱动表(INNER) → 已装 Agent 上线但「未绑定/待配」的机器
    // 漏掉，不在「选机器」列表（只在 listPendingMachines）。改以 license_machines 为驱动（机器装 Agent
    // 注册即落此表），经 licenses.tenant_id scope 到该运营租户，LEFT JOIN service_agents（含未绑定：
    // sa.* 为 NULL → configured=false → 前台显「待配置」可点配置）。绑定过的机器必有 license_machines
    // 行（setupCSByMachine 要先解析 license 才能绑），故 lm 驱动不会漏掉已绑机器。
    const fromAndJoins = scoped
      ? `FROM zenithjoy.license_machines lm
         JOIN zenithjoy.licenses l ON l.id = lm.license_id
         LEFT JOIN zenithjoy.service_agents sa
                ON sa.machine_id = lm.machine_id AND sa.deleted_at IS NULL`
      : // 超管视图：license_machines 驱动，左连 service_agents（含未绑定机器）
        `FROM zenithjoy.license_machines lm
         LEFT JOIN zenithjoy.service_agents sa
                ON sa.machine_id = lm.machine_id AND sa.deleted_at IS NULL`;
    const scopeWhere = scoped ? `WHERE l.tenant_id = $2::uuid` : '';
    const machineIdExpr = 'lm.machine_id';
    const params: unknown[] = scoped ? [limit, tenantId] : [limit];
    const res = await pool.query(
      `SELECT ${machineIdExpr} AS machine_id,
              MAX(lm.hostname)        AS hostname,
              MAX(lm.last_seen)       AS last_seen,
              MAX(sa.wechat_id)       AS wechat_id,
              MAX(sa.real_wechat_id)      AS real_wechat_id,
              MAX(sa.wechat_display_name) AS wechat_display_name,
              MAX(lm.agent_id)        AS agent_id,
              MAX(h.agent_uuid)       AS agent_uuid,
              MAX(c.persona->>'self_name')   AS self_name,
              MAX(c.whitelist::text)         AS whitelist,
              bool_or(c.auto_agent_enabled)  AS auto_agent_enabled,
              bool_or(c.wechat_id IS NOT NULL) AS configured,
              MAX(h.l04_ok)        AS wechat_ok,
              MAX(h.l04_reason)    AS wechat_reason,
              MAX(h.found_window)  AS found_window,
              MAX(h.login_present) AS login_present,
              bool_or(h.last_hb > NOW() - interval '5 minutes') AS online
         ${fromAndJoins}
         LEFT JOIN zenithjoy.wechat_cs_account_config c
                ON c.wechat_id = sa.wechat_id
         LEFT JOIN LATERAL (
                SELECT a.id::text AS agent_uuid,
                       a.module_status->'line04-wechat-cs'->>'ok'           AS l04_ok,
                       a.module_status->'line04-wechat-cs'->>'reason'       AS l04_reason,
                       a.module_status->'line04-wechat-cs'->>'found_window' AS found_window,
                       a.module_status->'line04-wechat-cs'->>'login_present' AS login_present,
                       a.last_heartbeat_at AS last_hb
                  FROM zenithjoy.agents a
                 WHERE a.hostname = lm.hostname AND a.last_heartbeat_at IS NOT NULL
                 ORDER BY a.last_heartbeat_at DESC LIMIT 1
              ) h ON true
        ${scopeWhere}
        GROUP BY ${machineIdExpr}
        ORDER BY bool_or(h.last_hb > NOW() - interval '5 minutes') DESC NULLS LAST,
                 MAX(lm.last_seen) DESC NULLS LAST
        LIMIT $1`,
      params,
    );
    const asBool = (v: unknown): boolean | undefined =>
      v === null || v === undefined ? undefined : String(v) === 'true' || v === true;

    // Bug C（issue 205799b8）：preflight statusReport（agents.module_status）的 found_window 生产恒空，
    // 真值在 listen_chat.py 直报心跳的 diag.main_window_found（内存 Map，本进程可读）。这里按 agent 身份
    // 用「最新一条心跳」覆盖恒空的 preflight，让「微信窗口状态」看板读到真值（main_window_found=true →
    // found_window 真、wechat_ok 真、清掉「微信主窗口未找到」假告警；=false → 给精确不健康原因）。
    const HB_FRESH_MS = 5 * 60 * 1000;
    const now = Date.now();
    // listen_chat 心跳只带 agent_id（无 wechat_id/machine_id），按 agent_id 取每个 agent 最新一条。
    const hbByAgent = new Map<string, HeartbeatRecord>();
    for (const hb of listHeartbeats()) {
      if (!hb.agent_id) continue;
      const prev = hbByAgent.get(hb.agent_id);
      if (!prev || hb.ts > prev.ts) hbByAgent.set(hb.agent_id, hb);
    }

    return (res.rows ?? []).map((r: Record<string, unknown>) => {
      let whitelist: string[] | undefined;
      try {
        whitelist = r.whitelist ? (JSON.parse(String(r.whitelist)) as string[]) : undefined;
      } catch {
        whitelist = undefined;
      }
      const m: CSMachine = {
        machine_id: String(r.machine_id),
        hostname: r.hostname ? String(r.hostname) : undefined,
        last_seen:
          r.last_seen instanceof Date ? r.last_seen.toISOString() : (r.last_seen as string | undefined),
        configured: Boolean(r.configured),
        wechat_id: r.wechat_id ? String(r.wechat_id) : undefined,
        real_wechat_id: r.real_wechat_id ? String(r.real_wechat_id) : undefined,
        wechat_display_name: r.wechat_display_name ? String(r.wechat_display_name) : undefined,
        self_name: r.self_name ? String(r.self_name) : undefined,
        whitelist,
        auto_agent_enabled: r.auto_agent_enabled === null ? undefined : Boolean(r.auto_agent_enabled),
        online: r.online === null ? undefined : Boolean(r.online),
        wechat_ok: asBool(r.wechat_ok),
        wechat_reason: r.wechat_reason ? String(r.wechat_reason) : undefined,
        found_window: asBool(r.found_window),
        login_present: asBool(r.login_present),
        agent_id: r.agent_id ? String(r.agent_id) : undefined,
      };

      // listener 实际传的可能是 agents.id UUID（决策 8383f3e3），也可能是 env-id；两者都试。
      const hb: HeartbeatRecord | undefined =
        (r.agent_uuid ? hbByAgent.get(String(r.agent_uuid)) : undefined) ??
        (r.agent_id ? hbByAgent.get(String(r.agent_id)) : undefined);
      if (hb?.diag && hb.diag.main_window_found !== undefined) {
        const fresh = now - hb.ts < HB_FRESH_MS;
        m.found_window = hb.diag.main_window_found;
        if (hb.diag.login_present !== undefined) m.login_present = hb.diag.login_present;
        if (fresh) m.online = true; // 直报心跳新鲜 → 在线（preflight 心跳可能已陈旧）
        if (hb.diag.main_window_found === true) {
          // 窗口找到 = 看板转绿，覆盖 preflight 的「未找到微信」假告警
          m.wechat_ok = true;
          m.wechat_reason = undefined;
        } else {
          m.wechat_ok = false;
          m.wechat_reason = hb.diag.login_present
            ? '微信未登录（需在该机扫码登录）'
            : '未找到微信窗口';
        }
      }
      return m;
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
  patch: Partial<Omit<CSAccountConfig, 'persona' | 'business_kb'>> & {
    // IA 重设计刀1：客服机页只发运营参数；persona/business_kb 由「话术库」页每号编辑，setup 一般不带。
    // 仍接受（兼容存量一键配置写法），行级 merge 不清空已配人设/知识库。
    persona?: Partial<Persona>;
    business_kb?: Partial<BusinessKB>;
    wechat_id?: string;
    // SSOT 真实微信号(perfect-xx)——运营手填(wxauto 读不到微信号)；昵称/内部 wxid 由 agent 上报，
    // 一键配置若已带上(前端把扫码结果透传)也一并落库。三者写进 service_agents 新列，不动合成 wechat_id 主 key。
    real_wechat_id?: string;
    wechat_display_name?: string;
    wxid_internal?: string;
  },
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
  // 真实微信号(SSOT)/昵称/内部 wxid：缺省 NULL（存量/未填兼容）；trim 空串也归一成 NULL，避免空串占唯一索引。
  const trimOrNull = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null;
  const realWechatId = trimOrNull(patch.real_wechat_id);
  const displayName = trimOrNull(patch.wechat_display_name);
  const wxidInternal = trimOrNull(patch.wxid_internal);
  // COALESCE 保留既有非空值：本次没传(NULL)不抹掉上次填的真实微信号/昵称/wxid（幂等补填，不回退）。
  await pool.query(
    `INSERT INTO zenithjoy.service_agents
       (tenant_id, machine_id, wechat_id, real_wechat_id, wechat_display_name, wxid_internal)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (machine_id) WHERE deleted_at IS NULL
       DO UPDATE SET wechat_id = EXCLUDED.wechat_id,
                     real_wechat_id = COALESCE(EXCLUDED.real_wechat_id, zenithjoy.service_agents.real_wechat_id),
                     wechat_display_name = COALESCE(EXCLUDED.wechat_display_name, zenithjoy.service_agents.wechat_display_name),
                     wxid_internal = COALESCE(EXCLUDED.wxid_internal, zenithjoy.service_agents.wxid_internal),
                     updated_at = now()`,
    [tenantId, machineId, wechatId, realWechatId, displayName, wxidInternal],
  );
  await saveCSConfig(wechatId, patch);
  return { wechat_id: wechatId, agent_id: agentId };
}

/**
 * upsert「该客服那一行」。只写该 wechat_id 那一行，ON CONFLICT 更新同行，绝不动其他客服行。
 *
 * IA 重设计刀1（反转 PR#940）：每号承载**完整** persona + 每号 business_kb，落库存整份（不再截 self_name）。
 *
 * 行级 merge（关键）：本表现被两个页面写同一行——「话术库」页写 persona/business_kb、「客服机」页写运营参数。
 * 若按整行覆盖，两页会互相把对方字段写成默认/空（= 数据丢失 + 新的「抢」）。故先读既有行，patch 里
 * **没传的字段保留既有值**：persona/business_kb 未传 → 保留；运营参数未传 → 保留。这样两页各写各的互不清空。
 */
export async function saveCSConfig(
  wechatId: string,
  patch: Partial<Omit<CSAccountConfig, 'wechat_id' | 'persona' | 'business_kb' | 'updated_at'>> & {
    persona?: Partial<Persona>;
    business_kb?: Partial<BusinessKB>;
  },
): Promise<void> {
  // 行级 merge 基线：既有行 → 用它；无行（新号）→ 默认值 + 空 persona/kb。
  const existing = await getCSConfig(wechatId);
  const base: Omit<CSAccountConfig, 'wechat_id' | 'updated_at'> = existing
    ? {
        persona: existing.persona,
        business_kb: existing.business_kb,
        auto_agent_enabled: existing.auto_agent_enabled,
        business_hours_start: existing.business_hours_start,
        business_hours_end: existing.business_hours_end,
        key_contact_wechat: existing.key_contact_wechat,
        whitelist: existing.whitelist,
        daily_limit: existing.daily_limit,
      }
    : { persona: EMPTY_PERSONA, business_kb: EMPTY_KB, ...CS_ACCOUNT_DEFAULTS };

  const full: Omit<CSAccountConfig, 'wechat_id' | 'updated_at'> = {
    // 完整 persona / business_kb：本次传了就整份替换（话术库页发整份），没传保留既有（客服机页只发运营参数）。
    persona: patch.persona !== undefined ? (patch.persona as Persona) : base.persona,
    business_kb: patch.business_kb !== undefined ? (patch.business_kb as BusinessKB) : base.business_kb,
    auto_agent_enabled: patch.auto_agent_enabled ?? base.auto_agent_enabled,
    business_hours_start: patch.business_hours_start ?? base.business_hours_start,
    business_hours_end: patch.business_hours_end ?? base.business_hours_end,
    key_contact_wechat: patch.key_contact_wechat ?? base.key_contact_wechat,
    whitelist: patch.whitelist ?? base.whitelist,
    daily_limit: patch.daily_limit ?? base.daily_limit,
  };
  try {
    await pool.query(
      `INSERT INTO zenithjoy.wechat_cs_account_config
         (wechat_id, persona, business_kb, auto_agent_enabled, business_hours_start, business_hours_end,
          key_contact_wechat, whitelist, daily_limit, updated_at)
       SELECT $1,
              ($2::jsonb)->'persona',
              COALESCE(($2::jsonb)->'business_kb', '{}'::jsonb),
              COALESCE((($2::jsonb)->>'auto_agent_enabled')::boolean, false),
              ($2::jsonb)->>'business_hours_start',
              ($2::jsonb)->>'business_hours_end',
              ($2::jsonb)->>'key_contact_wechat',
              ($2::jsonb)->'whitelist',
              COALESCE((($2::jsonb)->>'daily_limit')::int, 0),
              now()
       ON CONFLICT (wechat_id) DO UPDATE
         SET persona = EXCLUDED.persona,
             business_kb = EXCLUDED.business_kb,
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
