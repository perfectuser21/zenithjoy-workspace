/**
 * apps/api/src/services/wechat/cs-work-stats.ts — Line04 客服工作汇总统计（S3）
 *
 * 从真实回复链路落库表 zenithjoy.wechat_messages 聚合「每台客服机当天 4 个工作数据」：
 *   - received_count        接收：count(direction='in')
 *   - reply_count           回复：count(direction='out' AND status='delivered')（只算真送达，draft/failed 不计假账）
 *   - served_customers      接待客人数：count(distinct contact_key)
 *   - work_duration_minutes 工作时长：(末条 - 首条) 分钟数
 *
 * 口径纪律（spec / 哨兵）：
 *   - 按 Asia/Shanghai 当天分组（防美区算错日界，#832 坑）：用 created_at AT TIME ZONE 'Asia/Shanghai'
 *     取「北京当天」边界；today / yesterday 由日期偏移参数控制。
 *   - 排除 cs_wechat_id IS NULL（老数据 / 解析失败不计入、不串台）。
 *   - 按 cs_wechat_id 分组 → 一台客服机一行（1 账户 = 1 机器 = 1 微信号）。
 *
 * 富化（真发/演练标 + 客服名）：LEFT JOIN wechat_cs_account_config（按 wechat_id 命中该客服那一行），
 * 取 persona->>'self_name' 和 auto_agent_enabled（true=真发 / false=演练）。解不到 → 字段为空，
 * 不影响 4 个核心数（核心数永远来自 wechat_messages）。
 */

import pool from '../../db/connection';

export type StatsDate = 'today' | 'yesterday';

export interface CsWorkStat {
  cs_wechat_id: string;
  received_count: number;
  reply_count: number;
  served_customers: number;
  work_duration_minutes: number;
  self_name?: string;
  auto_agent_enabled?: boolean;
  online?: boolean;
}

/** today=0 / yesterday=1 天偏移（按北京日界回退）。 */
function dayOffset(date: StatsDate): number {
  return date === 'yesterday' ? 1 : 0;
}

/**
 * 聚合某一天（北京时区）每客服微信号的 4 个工作数据。
 *
 * 时间窗：以 now() 的北京日期为基准回退 $1 天，取那个「北京自然日」整天
 *   [北京当天00:00, 北京次日00:00) 的消息（用 ::date 比对 created_at 的北京日期）。
 */
export async function getCsWorkStats(date: StatsDate): Promise<CsWorkStat[]> {
  const offset = dayOffset(date);
  const res = await pool.query(
    `SELECT m.cs_wechat_id,
            count(*) FILTER (WHERE m.direction = 'in')                AS received_count,
            count(*) FILTER (WHERE m.direction = 'out'
                             AND m.status = 'delivered')              AS reply_count,
            count(DISTINCT m.contact_key)                            AS served_customers,
            COALESCE(
              CEIL(EXTRACT(EPOCH FROM (max(m.created_at) - min(m.created_at))) / 60.0),
              0
            )::int                                                    AS work_duration_minutes,
            cfg.persona->>'self_name'                                 AS self_name,
            cfg.auto_agent_enabled                                    AS auto_agent_enabled
       FROM zenithjoy.wechat_messages m
       LEFT JOIN zenithjoy.wechat_cs_account_config cfg
              ON cfg.wechat_id = m.cs_wechat_id
      WHERE m.cs_wechat_id IS NOT NULL
        AND (m.created_at AT TIME ZONE 'Asia/Shanghai')::date
            = ((now() AT TIME ZONE 'Asia/Shanghai')::date - ($1::int))
      GROUP BY m.cs_wechat_id, cfg.persona, cfg.auto_agent_enabled
      ORDER BY m.cs_wechat_id`,
    [offset],
  );

  return (res.rows ?? []).map((r: Record<string, unknown>): CsWorkStat => ({
    cs_wechat_id: String(r.cs_wechat_id),
    received_count: Number(r.received_count ?? 0),
    reply_count: Number(r.reply_count ?? 0),
    served_customers: Number(r.served_customers ?? 0),
    work_duration_minutes: Number(r.work_duration_minutes ?? 0),
    self_name: r.self_name ? String(r.self_name) : undefined,
    auto_agent_enabled:
      r.auto_agent_enabled === null || r.auto_agent_enabled === undefined
        ? undefined
        : Boolean(r.auto_agent_enabled),
  }));
}
