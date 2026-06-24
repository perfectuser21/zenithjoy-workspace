/**
 * apps/api/src/services/wechat/cs-stats.ts — Line04 客服工作汇总统计聚合
 *
 * 两部分：
 *   - aggregateCsStats   环境无关纯函数：把消息行按「客服微信号 × 北京时区某天」聚合成四数。
 *                        无 DB 依赖，单测直接钉口径（口径/时区日界/NULL 排除/数据隔离）。
 *   - getCsStats         接 DB：拉近几天短期消息 + 每客服配置 + 心跳，组装每客服一卡
 *                        （四数 + cs_name + online + mode）。供 GET /api/wechat/cs/stats 用。
 *
 * 口径（钉死，PRD Golden Path）：
 *   接收 received_count   = count(role='in')
 *   回复 reply_count      = count(role='out')
 *   接待 served_customers = distinct contact 数
 *   工作时长 work_duration_minutes = 当天末条 − 首条 created_at（分钟，按北京时区当天范围）
 *
 * 隔离/兼容纪律：
 *   - 按 cs_wechat_id 分组，绝不跨客服串台
 *   - cs_wechat_id 为 NULL（老数据/解析失败）→ 不计入任何客服
 *   - 日界一律按北京时区（Asia/Shanghai），禁用中台美区本地时间（防 #832）
 *   - mode 由 wechat_cs_account_config.auto_agent_enabled 推导：true→live、false/无配置→dryrun
 */

import pool from '../../db/connection';
import { listHeartbeats } from '../wechat-heartbeat';

export type StatsDate = 'today' | 'yesterday';

export interface StatRow {
  cs_wechat_id: string | null;
  contact: string;
  role: 'in' | 'out';
  created_at: string | Date;
}

/** 单客服聚合结果（纯口径，不含 cs_name/online/mode 这些 DB 富化字段）。 */
export interface CsAggregate {
  cs_wechat_id: string;
  received_count: number;
  reply_count: number;
  served_customers: number;
  work_duration_minutes: number;
}

/** 前台一卡所需完整字段（信封 agents[] 的每一项）。 */
export interface CsStatCard extends CsAggregate {
  cs_name: string;
  online: boolean;
  mode: 'live' | 'dryrun';
}

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/** 取某时刻在给定时区下的「日期」字符串 YYYY-MM-DD（en-CA = ISO 风格）。 */
function dayInTz(value: string | Date, tz: string): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** YYYY-MM-DD 加减 delta 天（UTC 锚点做日历运算，与时区无关）。 */
function shiftDay(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** 目标「北京某天」的 YYYY-MM-DD：today=北京今天，yesterday=北京昨天。 */
function targetDay(opts: { date: StatsDate; now: Date; tz: string }): string {
  const today = dayInTz(opts.now, opts.tz);
  return opts.date === 'yesterday' ? shiftDay(today, -1) : today;
}

/**
 * 纯口径聚合：把消息行按 cs_wechat_id 分组，算每客服四数（只算目标北京日、非 NULL 身份）。
 */
export function aggregateCsStats(
  rows: StatRow[],
  opts: { date: StatsDate; now: Date; tz: string },
): CsAggregate[] {
  const day = targetDay(opts);
  const groups = new Map<
    string,
    { received: number; reply: number; contacts: Set<string>; first: number; last: number }
  >();

  for (const r of rows) {
    if (r.cs_wechat_id == null) continue; // NULL 身份章不计入任何客服
    if (dayInTz(r.created_at, opts.tz) !== day) continue; // 北京时区日界过滤
    const ts = (r.created_at instanceof Date ? r.created_at : new Date(r.created_at)).getTime();
    let g = groups.get(r.cs_wechat_id);
    if (!g) {
      g = { received: 0, reply: 0, contacts: new Set(), first: ts, last: ts };
      groups.set(r.cs_wechat_id, g);
    }
    if (r.role === 'in') g.received += 1;
    else if (r.role === 'out') g.reply += 1;
    if (r.contact) g.contacts.add(r.contact);
    if (ts < g.first) g.first = ts;
    if (ts > g.last) g.last = ts;
  }

  return [...groups.entries()].map(([cs_wechat_id, g]) => ({
    cs_wechat_id,
    received_count: g.received,
    reply_count: g.reply,
    served_customers: g.contacts.size,
    work_duration_minutes: Math.round((g.last - g.first) / 60000),
  }));
}

// ─── DB 富化：cs_name / mode / online ────────────────────────────────────────

function parsePersona(raw: unknown): { self_name?: string } {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as { self_name?: string };
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as { self_name?: string };
  return {};
}

interface CsConfigLite {
  cs_name?: string;
  mode: 'live' | 'dryrun';
}

/** 该客服当前是否在线（5 分钟内有监听心跳，进程内存 Map）。 */
function isOnline(csWechatId: string, now: number): boolean {
  return listHeartbeats().some(
    (h) => h.wechat_id === csWechatId && now - h.ts < ONLINE_WINDOW_MS,
  );
}

/**
 * GET /api/wechat/cs/stats 的服务实现：组装每客服一卡（四数 + cs_name + online + mode）。
 * 卡片集合 = 「目标日有消息的客服」∪「已配置过的客服」（已配但当天无消息 → 四个 0，不消失）。
 */
export async function getCsStats(
  date: StatsDate,
  now: Date = new Date(),
): Promise<CsStatCard[]> {
  // 拉近 3 天短期消息（足够覆盖北京今天/昨天），精确日界过滤交给纯函数
  const msgRes = await pool.query(
    `SELECT cs_wechat_id, contact, role, created_at
       FROM zenithjoy.cs_memory_messages
      WHERE cs_wechat_id IS NOT NULL
        AND created_at > now() - interval '3 days'`,
  );
  const aggregates = aggregateCsStats(msgRes.rows as StatRow[], {
    date,
    now,
    tz: 'Asia/Shanghai',
  });
  const aggMap = new Map(aggregates.map((a) => [a.cs_wechat_id, a]));

  // 每客服配置：cs_name（persona.self_name 缺省回落微信号）+ mode（auto_agent_enabled 推导）
  const cfgRes = await pool.query(
    `SELECT wechat_id, persona, auto_agent_enabled
       FROM zenithjoy.wechat_cs_account_config`,
  );
  const cfgMap = new Map<string, CsConfigLite>();
  for (const row of cfgRes.rows as Record<string, unknown>[]) {
    const wid = String(row.wechat_id);
    cfgMap.set(wid, {
      cs_name: parsePersona(row.persona).self_name,
      mode: row.auto_agent_enabled === true ? 'live' : 'dryrun',
    });
  }

  const nowMs = now.getTime();
  const ids = new Set<string>([...aggMap.keys(), ...cfgMap.keys()]);
  const cards: CsStatCard[] = [];
  for (const id of ids) {
    const agg = aggMap.get(id);
    const cfg = cfgMap.get(id);
    cards.push({
      cs_wechat_id: id,
      cs_name: cfg?.cs_name || id,
      online: isOnline(id, nowMs),
      mode: cfg?.mode ?? 'dryrun',
      received_count: agg?.received_count ?? 0,
      reply_count: agg?.reply_count ?? 0,
      served_customers: agg?.served_customers ?? 0,
      work_duration_minutes: agg?.work_duration_minutes ?? 0,
    });
  }
  cards.sort((a, b) => a.cs_wechat_id.localeCompare(b.cs_wechat_id));
  return cards;
}
