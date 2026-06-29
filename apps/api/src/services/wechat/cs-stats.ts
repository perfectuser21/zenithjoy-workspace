/**
 * apps/api/src/services/wechat/cs-stats.ts — 客服工作汇总每客服每日 4 数聚合
 *
 * 口径 SSOT（PRD 已确认，单测 sprints/06232241-line04-cs-work-stats/tests/cs-stats.test.ts 钉死）：
 *   received_count        = 当日该客服 `in` 条数
 *   reply_count           = 当日该客服 `out` 条数
 *   served_customers      = 当日该客服去重 contact 数
 *   work_duration_minutes = 当日该客服 末条 created_at − 首条 created_at 取分钟
 *
 * 隔离纪律：
 *   - cs_wechat_id=NULL（老数据 / 身份解析失败）不计入任何客服（不串到别人头上）。
 *   - 每客服按 cs_wechat_id 物理分组，A 的数绝不进 B 行。
 *   - 日界按北京时区 Asia/Shanghai 算（中台跑在美区，聚合 SQL 显式 AT TIME ZONE，防 #832）。
 *
 * computeCsStats 是环境无关的纯函数（口径数学）；getCsWorkStats 负责按北京日界取行 +
 * 补 cs_name/online/mode 展示字段（接缝 #2：online/mode 真实值需真 health 源，本层只保证类型）。
 */

import pool from '../../db/connection';

/** 聚合输入：一条短期消息的最小投影（北京日界过滤后的当日行）。 */
export interface CsMessageRow {
  cs_wechat_id: string | null;
  contact: string;
  role: 'in' | 'out';
  created_at: Date;
}

/** 每客服 4 数（PRD 锚点字段名，禁止漂移到 in_count/out_count/duration/customers 等同义名）。 */
export interface CsStatRow {
  cs_wechat_id: string;
  received_count: number;
  reply_count: number;
  served_customers: number;
  work_duration_minutes: number;
}

/** 前台卡片展示行：4 数 + 展示字段（cs_name/online/mode 只读复用已有配置/health）。 */
export interface CsWorkStatRow extends CsStatRow {
  cs_name: string | null;
  online: boolean;
  mode: 'real' | 'dryrun';
}

function toMs(t: Date): number {
  return t instanceof Date ? t.getTime() : new Date(t).getTime();
}

/**
 * 纯函数：把当日（已按北京日界过滤）的消息行按客服聚合成每客服 4 数。
 * cs_wechat_id=NULL 的行直接丢弃（不计入任何客服）。
 */
export function computeCsStats(rows: CsMessageRow[]): CsStatRow[] {
  const groups = new Map<string, CsMessageRow[]>();
  for (const r of rows) {
    if (r.cs_wechat_id == null) continue; // NULL 身份不计入任何客服
    const g = groups.get(r.cs_wechat_id);
    if (g) g.push(r);
    else groups.set(r.cs_wechat_id, [r]);
  }

  const out: CsStatRow[] = [];
  for (const [cs, list] of groups) {
    let received = 0;
    let reply = 0;
    const contacts = new Set<string>();
    let minMs = Infinity;
    let maxMs = -Infinity;
    for (const r of list) {
      if (r.role === 'in') received += 1;
      else if (r.role === 'out') reply += 1;
      contacts.add(r.contact);
      const ms = toMs(r.created_at);
      if (ms < minMs) minMs = ms;
      if (ms > maxMs) maxMs = ms;
    }
    const durationMin = maxMs > minMs ? Math.round((maxMs - minMs) / 60000) : 0;
    out.push({
      cs_wechat_id: cs,
      received_count: received,
      reply_count: reply,
      served_customers: contacts.size,
      work_duration_minutes: durationMin,
    });
  }
  return out;
}

/**
 * 按北京时区取「今天 / 昨天」该日所有盖章消息行 → computeCsStats 聚合 → 补展示字段。
 * 空数据日返回 []（接口不报错；前台对 0 消息客服卡片兜底 4 个 0）。
 */
export async function getCsWorkStats(date: 'today' | 'yesterday'): Promise<CsWorkStatRow[]> {
  const offset = date === 'yesterday' ? 1 : 0;

  // 北京日界：timestamptz AT TIME ZONE 'Asia/Shanghai' → 北京墙钟 → ::date 取北京日历日，
  // 与服务器所在美区时区无关（显式换算，防 #832 美区算错日界）。
  const res = await pool.query(
    `SELECT cs_wechat_id, contact, role, created_at
       FROM zenithjoy.cs_memory_messages
      WHERE cs_wechat_id IS NOT NULL
        AND (created_at AT TIME ZONE 'Asia/Shanghai')::date
            = ((now() AT TIME ZONE 'Asia/Shanghai')::date - ($1::int))`,
    [offset],
  );

  const rows: CsMessageRow[] = (res.rows as Record<string, unknown>[]).map((r) => ({
    cs_wechat_id: r.cs_wechat_id == null ? null : String(r.cs_wechat_id),
    contact: String(r.contact),
    role: r.role === 'out' ? 'out' : 'in',
    created_at: r.created_at instanceof Date ? r.created_at : new Date(String(r.created_at)),
  }));

  const base = computeCsStats(rows);
  if (base.length === 0) return [];

  // 展示字段补全（cs_name / mode 取每客服配置；online 接缝 #2：best-effort 心跳，缺则 false）。
  const ids = base.map((b) => b.cs_wechat_id);
  const enrich = new Map<string, { cs_name: string | null; online: boolean; mode: 'real' | 'dryrun' }>();
  try {
    const er = await pool.query(
      `SELECT c.wechat_id,
              COALESCE(c.persona->>'self_name', c.persona->>'name') AS cs_name,
              c.auto_agent_enabled,
              bool_or(h.last_heartbeat_at > now() - interval '5 minutes') AS online
         FROM zenithjoy.wechat_cs_account_config c
         LEFT JOIN zenithjoy.service_agents sa
                ON sa.wechat_id = c.wechat_id AND sa.deleted_at IS NULL
         LEFT JOIN zenithjoy.license_machines lm ON lm.machine_id = sa.machine_id
         LEFT JOIN zenithjoy.agents h ON h.hostname = lm.hostname
        WHERE c.wechat_id = ANY($1::text[])
        GROUP BY c.wechat_id, c.persona, c.auto_agent_enabled`,
      [ids],
    );
    for (const r of er.rows as Record<string, unknown>[]) {
      enrich.set(String(r.wechat_id), {
        cs_name: r.cs_name == null ? null : String(r.cs_name),
        online: r.online === true,
        mode: r.auto_agent_enabled === true ? 'real' : 'dryrun',
      });
    }
  } catch (err) {
    console.warn('[cs-stats] 展示字段补全失败（不影响 4 数）:', err);
  }

  return base.map((b) => {
    const e = enrich.get(b.cs_wechat_id);
    return {
      ...b,
      cs_name: e?.cs_name ?? null,
      online: e?.online ?? false,
      mode: e?.mode ?? 'dryrun',
    };
  });
}
