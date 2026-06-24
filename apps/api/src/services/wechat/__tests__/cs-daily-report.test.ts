/* eslint-disable @typescript-eslint/no-explicit-any -- 测试注入 mock */
/**
 * 同目录单测（CI lint-test-pairing 配对）— Line04 客服每日工作报告（S4）服务契约。
 *
 * 端到端真链路另在 .github/workflows/scripts/smoke/cs-daily-report-smoke.sh（真 DB + 真结算 + 幂等）。
 * 本文件用 mock pool + mock getCsWorkStats 钉死服务级契约：
 *  - 结算复用 S3 的 getCsWorkStats（不重新发明口径）
 *  - upsert daily_report 用 ON CONFLICT (cs_wechat_id, report_date) 保幂等（重复结算不翻倍）
 *  - report_date 按 Asia/Shanghai 当天（防美区日界坑）
 *  - 无客服数据 → 不写半截脏数据（settled=0），不抛
 *  - getDailyReports(date) 按 report_date 查
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/connection', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../cs-work-stats', () => ({
  getCsWorkStats: vi.fn(),
}));

import pool from '../../../db/connection';
import { getCsWorkStats } from '../cs-work-stats';
import { runDailyReportSettlement, getDailyReports } from '../cs-daily-report';

const mockedQuery = vi.mocked((pool as any).query);
const mockedStats = vi.mocked(getCsWorkStats);

beforeEach(() => {
  vi.clearAllMocks();
  mockedQuery.mockResolvedValue({ rows: [] });
  mockedStats.mockResolvedValue([]);
});

describe('runDailyReportSettlement', () => {
  it('复用 getCsWorkStats 取口径（不重新发明）', async () => {
    mockedStats.mockResolvedValueOnce([
      { cs_wechat_id: 'wxid_a', received_count: 3, reply_count: 2, served_customers: 2, work_duration_minutes: 20 },
    ]);
    await runDailyReportSettlement('today');
    expect(mockedStats).toHaveBeenCalledWith('today');
  });

  it('upsert daily_report 用 ON CONFLICT (cs_wechat_id, report_date) 保幂等', async () => {
    mockedStats.mockResolvedValueOnce([
      { cs_wechat_id: 'wxid_a', received_count: 3, reply_count: 2, served_customers: 2, work_duration_minutes: 20 },
    ]);
    await runDailyReportSettlement('today');
    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toMatch(/INSERT INTO zenithjoy\.daily_report/i);
    expect(sql).toMatch(/ON CONFLICT\s*\(\s*cs_wechat_id\s*,\s*report_date\s*\)/i);
    expect(sql).toMatch(/DO UPDATE/i);
  });

  it('report_date 按 Asia/Shanghai 当天（防美区日界坑）', async () => {
    mockedStats.mockResolvedValueOnce([
      { cs_wechat_id: 'wxid_a', received_count: 1, reply_count: 0, served_customers: 1, work_duration_minutes: 0 },
    ]);
    await runDailyReportSettlement('today');
    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toMatch(/AT TIME ZONE\s+'Asia\/Shanghai'/i);
  });

  it('无客服数据 → 不写 daily_report（settled=0），不抛', async () => {
    mockedStats.mockResolvedValueOnce([]);
    const r = await runDailyReportSettlement('today');
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(r.settled).toBe(0);
  });

  it('多客服 → 每客服各 upsert 一行（settled=N）', async () => {
    mockedStats.mockResolvedValueOnce([
      { cs_wechat_id: 'wxid_a', received_count: 3, reply_count: 2, served_customers: 2, work_duration_minutes: 20 },
      { cs_wechat_id: 'wxid_b', received_count: 1, reply_count: 0, served_customers: 1, work_duration_minutes: 0 },
    ]);
    const r = await runDailyReportSettlement('today');
    expect(r.settled).toBe(2);
    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });
});

describe('getDailyReports', () => {
  it('按 report_date 查指定历史日期', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { cs_wechat_id: 'wxid_a', received_count: '3', reply_count: '2', served_customers: '2', work_duration_minutes: '20', report_date: '2026-06-24', summary_text: '' },
      ],
    });
    const rows = await getDailyReports('2026-06-24');
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(String(sql)).toMatch(/FROM zenithjoy\.daily_report/i);
    expect(String(sql)).toMatch(/report_date\s*=/i);
    expect(params).toContain('2026-06-24');
    expect(rows[0].received_count).toBe(3);
  });
});
