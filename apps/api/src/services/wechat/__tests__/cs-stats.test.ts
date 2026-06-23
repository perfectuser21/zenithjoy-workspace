/**
 * 同目录单测（CI lint-test-pairing 配对）— 客服工作汇总 computeCsStats 口径纯函数。
 *
 * 端到端口径（北京时区聚合 + 真 endpoint）由 sprint 数据 oracle
 * sprints/06232241-line04-cs-work-stats/scripts/cs-stats-verify.sh 真 API+DB 覆盖；
 * 本文件用纯函数钉死 4 数口径 + NULL 不计入 + A/B 不串台 + 字段名锁定（环境无关）。
 */
import { describe, it, expect } from 'vitest';
import { computeCsStats, type CsMessageRow } from '../cs-stats';

const t = (s: string) => new Date(`2026-06-23T${s}:00+08:00`); // 北京墙钟

describe('computeCsStats 口径', () => {
  it('单客服 4 数：received=in 条 / reply=out 条 / served=distinct contact / minutes=末-首', () => {
    const rows: CsMessageRow[] = [
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: t('09:00') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'out', created_at: t('09:05') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: t('09:10') },
      { cs_wechat_id: 'wxA', contact: 'c2', role: 'in', created_at: t('09:15') },
      { cs_wechat_id: 'wxA', contact: 'c2', role: 'out', created_at: t('09:20') },
    ];
    const a = computeCsStats(rows).find((r) => r.cs_wechat_id === 'wxA')!;
    expect(a.received_count).toBe(3);
    expect(a.reply_count).toBe(2);
    expect(a.served_customers).toBe(2);
    expect(a.work_duration_minutes).toBe(20);
  });

  it('A/B 互不串台 + 单条 duration=0', () => {
    const out = computeCsStats([
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: t('09:00') },
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: t('09:30') },
      { cs_wechat_id: 'wxB', contact: 'c9', role: 'in', created_at: t('10:00') },
    ]);
    expect(out.find((r) => r.cs_wechat_id === 'wxA')!.received_count).toBe(2);
    const b = out.find((r) => r.cs_wechat_id === 'wxB')!;
    expect(b.received_count).toBe(1);
    expect(b.reply_count).toBe(0);
    expect(b.work_duration_minutes).toBe(0);
  });

  it('cs_wechat_id=NULL 行不计入任何客服', () => {
    const out = computeCsStats([
      { cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: t('09:00') },
      { cs_wechat_id: null, contact: 'cx', role: 'in', created_at: t('11:00') },
    ]);
    expect(out.every((r) => r.cs_wechat_id != null)).toBe(true);
    expect(out.find((r) => r.cs_wechat_id === 'wxA')!.received_count).toBe(1);
    expect(out.length).toBe(1);
  });

  it('空输入返回空数组（空数据日不报错）', () => {
    expect(computeCsStats([])).toEqual([]);
  });

  it('输出对象只含 PRD 锚点字段，无禁用漂移字段名', () => {
    const keys = Object.keys(
      computeCsStats([{ cs_wechat_id: 'wxA', contact: 'c1', role: 'in', created_at: t('09:00') }])[0],
    );
    for (const k of ['cs_wechat_id', 'received_count', 'reply_count', 'served_customers', 'work_duration_minutes']) {
      expect(keys).toContain(k);
    }
    for (const banned of ['in_count', 'out_count', 'wechat_id', 'duration', 'customers', 'count', 'sum', 'total']) {
      expect(keys).not.toContain(banned);
    }
  });
});
