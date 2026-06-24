import { describe, it, expect } from 'vitest';
// TDD Red：generator 实现 apps/api/src/services/cs-work-stats.ts，导出纯口径聚合 + 北京日界 helper。
// 这些是「逻辑断言」（环境无关）：CI/单测验绿 = 真 done。接缝（真写入盖章 / 真浏览器渲染）见 contract-dod BEHAVIOR/E2E。
import {
  aggregateMessages,
  beijingDateExpr,
} from '../../../apps/api/src/services/cs-work-stats';

interface Msg {
  role: 'in' | 'out';
  contact: string;
  created_at: string; // ISO
}

describe('aggregateMessages 口径（接收/回复/接待/工作时长）[BEHAVIOR]', () => {
  it('received=count(in), reply=count(out), served=distinct(contact)', () => {
    const rows: Msg[] = [
      { role: 'in', contact: 'c1', created_at: '2026-06-24T02:00:00Z' },
      { role: 'out', contact: 'c1', created_at: '2026-06-24T02:05:00Z' },
      { role: 'in', contact: 'c1', created_at: '2026-06-24T02:10:00Z' },
      { role: 'in', contact: 'c2', created_at: '2026-06-24T02:15:00Z' },
      { role: 'out', contact: 'c2', created_at: '2026-06-24T02:17:00Z' },
    ];
    const r = aggregateMessages(rows);
    expect(r.received_count).toBe(3);
    expect(r.reply_count).toBe(2);
    expect(r.served_customers).toBe(2);
  });

  it('work_duration_minutes = round((末条-首条)/60)；首末相隔 17 分 → 17', () => {
    const rows: Msg[] = [
      { role: 'in', contact: 'c1', created_at: '2026-06-24T02:00:00Z' },
      { role: 'out', contact: 'c2', created_at: '2026-06-24T02:17:00Z' },
    ];
    expect(aggregateMessages(rows).work_duration_minutes).toBe(17);
  });

  it('单条消息 → 工作时长 0（不报错）', () => {
    const rows: Msg[] = [
      { role: 'in', contact: 'c1', created_at: '2026-06-24T02:00:00Z' },
    ];
    expect(aggregateMessages(rows).work_duration_minutes).toBe(0);
  });

  it('空消息 → 4 个 0', () => {
    const r = aggregateMessages([]);
    expect(r.received_count).toBe(0);
    expect(r.reply_count).toBe(0);
    expect(r.served_customers).toBe(0);
    expect(r.work_duration_minutes).toBe(0);
  });
});

describe('beijingDateExpr 北京日界 [BEHAVIOR]', () => {
  it('today/yesterday 生成北京时区 SQL 片段（含 Asia/Shanghai，yesterday 含 -1）', () => {
    const today = beijingDateExpr('today');
    const yesterday = beijingDateExpr('yesterday');
    expect(today).toContain('Asia/Shanghai');
    expect(yesterday).toContain('Asia/Shanghai');
    expect(yesterday).toMatch(/-\s*1|interval '1 day'/);
  });

  it('非法 date 抛错（路由层转 400）', () => {
    // @ts-expect-error 故意传非法值
    expect(() => beijingDateExpr('lastweek')).toThrow();
  });
});
