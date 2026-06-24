/**
 * Line04 客服工作汇总 — 口径聚合纯函数 TDD Red
 *
 * 验证 aggregateCsStats（环境无关纯逻辑）：
 *   - 4 数口径：接收=count(in) / 回复=count(out) / 接待=distinct 客户 / 工作时长=末条−首条(分钟)
 *   - 北京时区日界：北京今天 00:30 归「今天」（防 #832 美区算错）
 *   - NULL 排除：cs_wechat_id=NULL 不计入任何客服
 *   - 数据隔离：不同 cs_wechat_id 各算各的，绝不串台
 *
 * Red 阶段：apps/api/src/services/wechat/cs-stats.ts 尚未实现 → import 失败 / 断言失败。
 * Generator 实现 aggregateCsStats 后转绿。
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error 实现前模块不存在（TDD Red）
import { aggregateCsStats } from '../../../apps/api/src/services/wechat/cs-stats';

interface Row {
  cs_wechat_id: string | null;
  contact: string;
  role: 'in' | 'out';
  created_at: string;
}

// 固定基准 now（北京时间 2026-06-24 12:00 = UTC 04:00），让时区断言确定
const NOW = new Date('2026-06-24T04:00:00Z');
const TZ = 'Asia/Shanghai';

// 北京某天 hh:mm 的 UTC ISO（北京 = UTC+8）
function bjUtc(dateBj: string, hhmm: string): string {
  return new Date(`${dateBj}T${hhmm}:00+08:00`).toISOString();
}

describe('aggregateCsStats [BEHAVIOR]', () => {
  it('4 数口径：接收=in数 / 回复=out数 / 接待=distinct客户 / 时长=末−首分钟', () => {
    const rows: Row[] = [
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: bjUtc('2026-06-24', '09:00') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'out', created_at: bjUtc('2026-06-24', '09:10') },
      { cs_wechat_id: 'wxA', contact: 'c2', role: 'in', created_at: bjUtc('2026-06-24', '09:30') },
      { cs_wechat_id: 'wxA', contact: 'c2', role: 'out', created_at: bjUtc('2026-06-24', '10:00') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: bjUtc('2026-06-24', '11:00') },
    ];
    const out = aggregateCsStats(rows, { date: 'today', now: NOW, tz: TZ });
    const a = out.find((x: { cs_wechat_id: string }) => x.cs_wechat_id === 'wxA');
    expect(a.received_count).toBe(3); // 3 条 in
    expect(a.reply_count).toBe(2); // 2 条 out
    expect(a.served_customers).toBe(2); // c1, c2
    expect(a.work_duration_minutes).toBe(120); // 09:00 → 11:00
  });

  it('北京时区日界：北京今天 00:30 的消息归「今天」（防美区算成昨天）', () => {
    const rows: Row[] = [
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: bjUtc('2026-06-24', '00:30') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: bjUtc('2026-06-23', '10:00') },
    ];
    const today = aggregateCsStats(rows, { date: 'today', now: NOW, tz: TZ });
    const yest = aggregateCsStats(rows, { date: 'yesterday', now: NOW, tz: TZ });
    expect(today.find((x: { cs_wechat_id: string }) => x.cs_wechat_id === 'wxA').received_count).toBe(1);
    expect(yest.find((x: { cs_wechat_id: string }) => x.cs_wechat_id === 'wxA').received_count).toBe(1);
  });

  it('NULL 排除：cs_wechat_id=NULL 不计入任何客服', () => {
    const rows: Row[] = [
      { cs_wechat_id: null, contact: 'c1', role: 'in', created_at: bjUtc('2026-06-24', '09:00') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: bjUtc('2026-06-24', '09:00') },
    ];
    const out = aggregateCsStats(rows, { date: 'today', now: NOW, tz: TZ });
    expect(out.every((x: { cs_wechat_id: string | null }) => x.cs_wechat_id !== null)).toBe(true);
    expect(out.find((x: { cs_wechat_id: string }) => x.cs_wechat_id === 'wxA').received_count).toBe(1);
  });

  it('数据隔离：不同 cs_wechat_id 各算各的，绝不串台', () => {
    const rows: Row[] = [
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: bjUtc('2026-06-24', '09:00') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: bjUtc('2026-06-24', '09:01') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: bjUtc('2026-06-24', '09:02') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: bjUtc('2026-06-24', '09:03') },
      { cs_wechat_id: 'wxB', contact: 'c2', role: 'in', created_at: bjUtc('2026-06-24', '09:00') },
    ];
    const out = aggregateCsStats(rows, { date: 'today', now: NOW, tz: TZ });
    expect(out.find((x: { cs_wechat_id: string }) => x.cs_wechat_id === 'wxA').received_count).toBe(4);
    expect(out.find((x: { cs_wechat_id: string }) => x.cs_wechat_id === 'wxB').received_count).toBe(1);
  });
});
