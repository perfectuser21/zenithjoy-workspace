/* eslint-disable @typescript-eslint/no-explicit-any -- 测试注入 mock */
/**
 * 同目录单测（CI lint-test-pairing 配对）— Line04 客服工作汇总统计（S3）服务契约。
 *
 * 端到端真链路另在 .github/workflows/scripts/smoke/cs-work-stats-smoke.sh 覆盖（真 DB + 真 /cs/stats）。
 * 本文件用 mock pool 钉死服务级口径/时区/隔离/NULL 兼容契约：
 *  - 口径正确：聚合 SQL 含 count(in)/count(out)/count(distinct contact_key)/末-首时长
 *  - 时区：按 Asia/Shanghai 当天分组（SQL 必须出现 AT TIME ZONE 'Asia/Shanghai'）
 *  - NULL 兼容：聚合排除 cs_wechat_id IS NULL（老数据不计入、不串台）
 *  - date 参数：today / yesterday 落到不同日期偏移
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../../../db/connection';
import { getCsWorkStats } from '../cs-work-stats';

const mockedQuery = vi.mocked((pool as any).query);

beforeEach(() => {
  vi.clearAllMocks();
  mockedQuery.mockResolvedValue({ rows: [] });
});

describe('getCsWorkStats 聚合口径', () => {
  it('口径正确：接收=count(in)、回复=count(out)、接待=distinct contact_key、时长=末-首', async () => {
    await getCsWorkStats('today');
    const sql = String(mockedQuery.mock.calls[0][0]);
    // 接收 / 回复
    expect(sql).toMatch(/count\([^)]*direction\s*=\s*'in'/i);
    expect(sql).toMatch(/count\([^)]*direction\s*=\s*'out'/i);
    // 接待客人数：distinct contact_key
    expect(sql).toMatch(/count\(\s*distinct\s+contact_key/i);
    // 工作时长：max(created_at) - min(created_at) → 分钟
    expect(sql).toMatch(/max\(created_at\)[\s\S]*min\(created_at\)/i);
  });

  it('时区：按 Asia/Shanghai 当天分组（防美区日界坑）', async () => {
    await getCsWorkStats('today');
    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toMatch(/AT TIME ZONE\s+'Asia\/Shanghai'/i);
  });

  it('NULL 兼容：聚合排除 cs_wechat_id IS NULL（老数据不计入、不串台）', async () => {
    await getCsWorkStats('today');
    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toMatch(/cs_wechat_id\s+IS\s+NOT\s+NULL/i);
    // 同时分组按 cs_wechat_id
    expect(sql).toMatch(/group\s+by[\s\S]*cs_wechat_id/i);
  });

  it('date=today 与 date=yesterday 走不同日期偏移参数', async () => {
    await getCsWorkStats('today');
    const todayParams = JSON.stringify(mockedQuery.mock.calls[0][1] ?? []);
    mockedQuery.mockClear();
    await getCsWorkStats('yesterday');
    const yParams = JSON.stringify(mockedQuery.mock.calls[0][1] ?? []);
    // 两次调用的日期偏移参数不同（today vs yesterday）
    expect(todayParams).not.toBe(yParams);
  });

  it('返回数组：每行映射成 4 个数（数字类型），cs_wechat_id 透传', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          cs_wechat_id: 'wxid_a',
          received_count: '3',
          reply_count: '2',
          served_customers: '2',
          work_duration_minutes: '20',
          self_name: '小齐',
          online: true,
          auto_agent_enabled: true,
        },
      ],
    });
    const stats = await getCsWorkStats('today');
    expect(Array.isArray(stats)).toBe(true);
    expect(stats[0].cs_wechat_id).toBe('wxid_a');
    expect(stats[0].received_count).toBe(3);
    expect(stats[0].reply_count).toBe(2);
    expect(stats[0].served_customers).toBe(2);
    expect(stats[0].work_duration_minutes).toBe(20);
  });
});
