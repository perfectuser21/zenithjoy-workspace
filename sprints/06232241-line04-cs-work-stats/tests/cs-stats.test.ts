import { describe, it, expect } from 'vitest';
// TDD Red：computeCsStats 尚未实现 → import 落空/函数缺失 → 本文件 FAIL。
// 口径 SSOT（PRD 已确认）：received=in 条数 / reply=out 条数 / served_customers=distinct contact /
// work_duration_minutes=该客服当日 末条-首条 created_at 取分钟。cs_wechat_id=NULL 不计入任何客服。
// generator 实现 computeCsStats 后，stats 路由按北京时区 SQL 取当日行 → 交此纯函数聚合（或等价 SQL）。
// 路径：sprints/.../tests → 上三级 = /workspace
import { computeCsStats, type CsMessageRow } from '../../../apps/api/src/services/wechat/cs-stats';

const t = (s: string) => new Date(`2026-06-23T${s}:00+08:00`); // 北京墙钟

describe('computeCsStats 口径 [BEHAVIOR]', () => {
  it('单客服 4 数：received=3 reply=2 served=2 work_duration_minutes=20', () => {
    const rows: CsMessageRow[] = [
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: t('09:00') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'out', created_at: t('09:05') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: t('09:10') },
      { cs_wechat_id: 'wxA', contact: 'c2', role: 'in', created_at: t('09:15') },
      { cs_wechat_id: 'wxA', contact: 'c2', role: 'out', created_at: t('09:20') },
    ];
    const out = computeCsStats(rows);
    const a = out.find((r) => r.cs_wechat_id === 'wxA')!;
    expect(a.received_count).toBe(3);
    expect(a.reply_count).toBe(2);
    expect(a.served_customers).toBe(2);
    expect(a.work_duration_minutes).toBe(20);
  });

  it('两客服互不串台：A 的数绝不出现在 B 行', () => {
    const rows: CsMessageRow[] = [
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: t('09:00') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: t('09:10') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: t('09:20') },
      { cs_wechat_id: 'wxB', contact: 'c9', role: 'in', created_at: t('10:00') },
    ];
    const out = computeCsStats(rows);
    expect(out.find((r) => r.cs_wechat_id === 'wxA')!.received_count).toBe(3);
    const b = out.find((r) => r.cs_wechat_id === 'wxB')!;
    expect(b.received_count).toBe(1);
    expect(b.reply_count).toBe(0);
    expect(b.served_customers).toBe(1);
  });

  it('cs_wechat_id=NULL 的行不计入任何客服（不串到别人头上）', () => {
    const rows: CsMessageRow[] = [
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: t('09:00') },
      { cs_wechat_id: null, contact: 'cx', role: 'in', created_at: t('11:00') },
      { cs_wechat_id: null, contact: 'cx', role: 'in', created_at: t('11:05') },
    ];
    const out = computeCsStats(rows);
    expect(out.every((r) => r.cs_wechat_id !== null && r.cs_wechat_id !== undefined)).toBe(true);
    expect(out.find((r) => r.cs_wechat_id === 'wxA')!.received_count).toBe(1);
  });

  it('字段名锁定 PRD 锚点，且不出现禁用漂移字段名', () => {
    const out = computeCsStats([
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: t('09:00') },
    ]);
    const keys = Object.keys(out[0]);
    for (const k of ['cs_wechat_id', 'received_count', 'reply_count', 'served_customers', 'work_duration_minutes']) {
      expect(keys).toContain(k);
    }
    for (const banned of ['in_count', 'out_count', 'wechat_id', 'duration', 'customers', 'count', 'sum', 'total']) {
      expect(keys).not.toContain(banned);
    }
  });
});
