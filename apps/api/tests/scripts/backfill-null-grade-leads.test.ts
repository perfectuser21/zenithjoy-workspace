import { describe, it, expect } from 'vitest';
import { selectBackfillCandidates, type CandidateRow } from '../../src/scripts/backfill-null-grade-leads';

describe('selectBackfillCandidates', () => {
  it('评论时间晚于画像创建时间 → 纳入候选（大概率是解析bug漏判，可安全backfill）', () => {
    const rows: CandidateRow[] = [
      {
        commentId: 'c1', leadId: 'l1', tenantId: 't1', commentText: '预算20w内能不能包入住？',
        commentedAt: new Date('2026-07-19T05:00:00Z'),
        configCreatedAt: new Date('2026-07-18T15:58:00Z'),
      },
    ];
    const result = selectBackfillCandidates(rows);
    expect(result).toEqual([{ commentId: 'c1', leadId: 'l1', tenantId: 't1', commentText: '预算20w内能不能包入住？' }]);
  });

  it('评论时间早于画像创建时间 → 排除（当时画像本来就是空的，本该是null，不能backfill出假意向）', () => {
    const rows: CandidateRow[] = [
      {
        commentId: 'c2', leadId: 'l2', tenantId: 't2', commentText: '随便看看',
        commentedAt: new Date('2026-07-10T00:00:00Z'),
        configCreatedAt: new Date('2026-07-18T15:58:00Z'),
      },
    ];
    expect(selectBackfillCandidates(rows)).toEqual([]);
  });

  it('该租户从未配置过画像（configCreatedAt为null）→ 排除', () => {
    const rows: CandidateRow[] = [
      {
        commentId: 'c3', leadId: 'l3', tenantId: 't3', commentText: '好看',
        commentedAt: new Date('2026-07-20T00:00:00Z'),
        configCreatedAt: null,
      },
    ];
    expect(selectBackfillCandidates(rows)).toEqual([]);
  });
});
