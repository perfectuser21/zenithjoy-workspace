/**
 * apps/api/src/services/wechat/cs-daily-report.ts — Line04 客服每日工作报告（S4）
 *
 * 每天北京 23:55 定时结算：把当天每客服 4 个数（接收/回复/接待客人数/工作时长）固化进
 * zenithjoy.daily_report，按 (cs_wechat_id, report_date) 唯一键 upsert 保幂等（重复触发不翻倍）。
 *
 * 数据来源：复用 S3 的 getCsWorkStats（不重新发明统计口径）。report_date 按 Asia/Shanghai 当天
 * （today/yesterday 偏移），防美区算错日界。
 *
 * 降级纪律：无客服数据 → 不写半截脏数据（settled=0）；getCsWorkStats 抛错由调用方（scheduler）收尾，
 * 不写半截。
 */

import pool from '../../db/connection';
import { getCsWorkStats, type StatsDate } from './cs-work-stats';

export interface DailyReportRow {
  cs_wechat_id: string;
  report_date: string;
  received_count: number;
  reply_count: number;
  served_customers: number;
  work_duration_minutes: number;
  summary_text: string;
  self_name?: string;
}

/** 一句话小结（thin：确定性本地生成；不接 LLM，二期再说）。 */
function buildSummary(s: {
  received_count: number;
  reply_count: number;
  served_customers: number;
  work_duration_minutes: number;
}): string {
  if (s.received_count === 0 && s.reply_count === 0) return '今日无消息。';
  return `今日接待 ${s.served_customers} 位客户，收到 ${s.received_count} 条、回复 ${s.reply_count} 条，工作约 ${s.work_duration_minutes} 分钟。`;
}

/**
 * 结算指定一天（today/yesterday，按北京日界）的每客服日报，upsert 进 daily_report。
 * 返回 settled = 固化的客服数。无数据 → settled=0，不写库（不产生半截脏行）。
 */
export async function runDailyReportSettlement(
  date: StatsDate,
): Promise<{ settled: number; date: StatsDate }> {
  const stats = await getCsWorkStats(date);
  if (!stats.length) return { settled: 0, date };

  const offset = date === 'yesterday' ? 1 : 0;
  let settled = 0;
  for (const s of stats) {
    const summary = buildSummary(s);
    // report_date 用 SQL 端按 Asia/Shanghai 当天 - offset 算（与 getCsWorkStats 同口径，防美区日界）。
    await pool.query(
      `INSERT INTO zenithjoy.daily_report
         (cs_wechat_id, report_date, received_count, reply_count, served_customers,
          work_duration_minutes, summary_text)
       VALUES (
         $1,
         ((now() AT TIME ZONE 'Asia/Shanghai')::date - ($7::int)),
         $2, $3, $4, $5, $6
       )
       ON CONFLICT (cs_wechat_id, report_date) DO UPDATE
         SET received_count        = EXCLUDED.received_count,
             reply_count           = EXCLUDED.reply_count,
             served_customers      = EXCLUDED.served_customers,
             work_duration_minutes = EXCLUDED.work_duration_minutes,
             summary_text          = EXCLUDED.summary_text`,
      [
        s.cs_wechat_id,
        s.received_count,
        s.reply_count,
        s.served_customers,
        s.work_duration_minutes,
        summary,
        offset,
      ],
    );
    settled += 1;
  }
  return { settled, date };
}

/**
 * 回看任意历史日期的日报（按 report_date 精确匹配，date 形如 'YYYY-MM-DD'）。
 * 富化客服名：LEFT JOIN wechat_cs_account_config 取 persona->>'self_name'。
 */
export async function getDailyReports(date: string): Promise<DailyReportRow[]> {
  const res = await pool.query(
    `SELECT r.cs_wechat_id,
            to_char(r.report_date, 'YYYY-MM-DD')  AS report_date,
            r.received_count,
            r.reply_count,
            r.served_customers,
            r.work_duration_minutes,
            r.summary_text,
            cfg.persona->>'self_name'             AS self_name
       FROM zenithjoy.daily_report r
       LEFT JOIN zenithjoy.wechat_cs_account_config cfg
              ON cfg.wechat_id = r.cs_wechat_id
      WHERE r.report_date = $1::date
      ORDER BY r.cs_wechat_id`,
    [date],
  );
  return (res.rows ?? []).map((r: Record<string, unknown>): DailyReportRow => ({
    cs_wechat_id: String(r.cs_wechat_id),
    report_date: String(r.report_date),
    received_count: Number(r.received_count ?? 0),
    reply_count: Number(r.reply_count ?? 0),
    served_customers: Number(r.served_customers ?? 0),
    work_duration_minutes: Number(r.work_duration_minutes ?? 0),
    summary_text: r.summary_text ? String(r.summary_text) : '',
    self_name: r.self_name ? String(r.self_name) : undefined,
  }));
}
