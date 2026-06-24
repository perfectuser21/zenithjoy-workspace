/**
 * 同目录单测（CI lint-test-pairing 配对）— Line04 客服工作汇总聚合纯函数 cs-stats.ts。
 *
 * 钉死 aggregateCsStats（环境无关纯逻辑，不碰 DB）的口径契约，与合同 sprint 测试
 * （sprints/06232241-line04-cs-work-stats/tests/cs-work-stats.test.ts）同源：
 *   - 4 数口径：接收=count(in) / 回复=count(out) / 接待=distinct 客户 / 工作时长=末−首分钟
 *   - 北京时区日界：北京今天 00:30 归「今天」（防 #832 美区算错）
 *   - NULL 排除：cs_wechat_id=NULL 不计入任何客服
 *   - 数据隔离：不同 cs_wechat_id 各算各的，绝不串台
 */
import { describe, it, expect } from 'vitest';
import { aggregateCsStats } from '../cs-stats';

const NOW = new Date('2026-06-24T04:00:00Z'); // 北京 2026-06-24 12:00
const TZ = 'Asia/Shanghai';

// 北京某天 hh:mm 的 UTC ISO（北京 = UTC+8）
function bjUtc(dateBj: string, hhmm: string): string {
  return new Date(`${dateBj}T${hhmm}:00+08:00`).toISOString();
}

describe('aggregateCsStats', () => {
  it('4 数口径：接收=in / 回复=out / 接待=distinct客户 / 时长=末−首分钟', () => {
    const rows = [
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in' as const, created_at: bjUtc('2026-06-24', '09:00') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'out' as const, created_at: bjUtc('2026-06-24', '09:10') },
      { cs_wechat_id: 'wxA', contact: 'c2', role: 'in' as const, created_at: bjUtc('2026-06-24', '09:30') },
      { cs_wechat_id: 'wxA', contact: 'c2', role: 'out' as const, created_at: bjUtc('2026-06-24', '10:00') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in' as const, created_at: bjUtc('2026-06-24', '11:00') },
    ];
    const a = aggregateCsStats(rows, { date: 'today', now: NOW, tz: TZ }).find((x) => x.cs_wechat_id === 'wxA');
    expect(a?.received_count).toBe(3);
    expect(a?.reply_count).toBe(2);
    expect(a?.served_customers).toBe(2);
    expect(a?.work_duration_minutes).toBe(120);
  });

  it('北京时区日界：北京今天 00:30 归「今天」', () => {
    const rows = [
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in' as const, created_at: bjUtc('2026-06-24', '00:30') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in' as const, created_at: bjUtc('2026-06-23', '10:00') },
    ];
    const today = aggregateCsStats(rows, { date: 'today', now: NOW, tz: TZ });
    const yest = aggregateCsStats(rows, { date: 'yesterday', now: NOW, tz: TZ });
    expect(today.find((x) => x.cs_wechat_id === 'wxA')?.received_count).toBe(1);
    expect(yest.find((x) => x.cs_wechat_id === 'wxA')?.received_count).toBe(1);
  });

  it('NULL 排除：cs_wechat_id=NULL 不计入任何客服', () => {
    const rows = [
      { cs_wechat_id: null, contact: 'c1', role: 'in' as const, created_at: bjUtc('2026-06-24', '09:00') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in' as const, created_at: bjUtc('2026-06-24', '09:00') },
    ];
    const out = aggregateCsStats(rows, { date: 'today', now: NOW, tz: TZ });
    expect(out.every((x) => x.cs_wechat_id !== null)).toBe(true);
    expect(out.find((x) => x.cs_wechat_id === 'wxA')?.received_count).toBe(1);
  });

  it('数据隔离：不同 cs_wechat_id 各算各的，绝不串台', () => {
    const rows = [
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in' as const, created_at: bjUtc('2026-06-24', '09:00') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in' as const, created_at: bjUtc('2026-06-24', '09:01') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in' as const, created_at: bjUtc('2026-06-24', '09:02') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in' as const, created_at: bjUtc('2026-06-24', '09:03') },
      { cs_wechat_id: 'wxB', contact: 'c2', role: 'in' as const, created_at: bjUtc('2026-06-24', '09:00') },
    ];
    const out = aggregateCsStats(rows, { date: 'today', now: NOW, tz: TZ });
    expect(out.find((x) => x.cs_wechat_id === 'wxA')?.received_count).toBe(4);
    expect(out.find((x) => x.cs_wechat_id === 'wxB')?.received_count).toBe(1);
  });
});
