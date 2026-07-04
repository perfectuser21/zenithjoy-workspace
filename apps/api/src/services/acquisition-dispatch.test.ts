import { describe, it, expect, vi } from 'vitest';
import {
  defaultConfig,
  AcquisitionConfig,
  computeRelevanceScore,
  rescoreLead,
  heuristicScore,
  QueryablePool,
} from './acquisition-dispatch';

// 配套 unit（lint-test-pairing）— dispatchDue 真派单到 publish_tasks 的核心契约。
// 端到端行为由 staging DB 验证：dm_assignments.status='dispatched' + publish_tasks 有记录。

describe('acquisition-dispatch defaultConfig', () => {
  it('dm_message 有默认话术', () => {
    const cfg: AcquisitionConfig = defaultConfig('t1');
    expect(cfg.dm_message).toBeTruthy();
    expect(cfg.dm_message.length).toBeGreaterThan(0);
  });

  it('dm_per_hour / dm_per_day 有合理默认值', () => {
    const cfg = defaultConfig('t2');
    expect(cfg.dm_per_hour).toBeGreaterThan(0);
    expect(cfg.dm_per_day).toBeGreaterThanOrEqual(cfg.dm_per_hour);
  });

  it('dm_active_start < dm_active_end（时段合法）', () => {
    const cfg = defaultConfig('t3');
    expect(cfg.dm_active_start < cfg.dm_active_end).toBe(true);
  });

  it('dm_interval_min_sec <= dm_interval_max_sec', () => {
    const cfg = defaultConfig('t4');
    expect(cfg.dm_interval_min_sec).toBeLessThanOrEqual(cfg.dm_interval_max_sec);
  });
});

describe('computeRelevanceScore', () => {
  const now = new Date('2026-07-04T12:00:00Z');

  it('单条「高意向」24h 内 → 100×1.0 + 10 频次，封顶 100', () => {
    const score = computeRelevanceScore(
      [{ grade: '高意向', commented_at: new Date('2026-07-04T06:00:00Z') }],
      now
    );
    expect(score).toBe(100);
  });

  it('3 条「感兴趣」都在 24h 内 → 40×1.0 + 30 = 70', () => {
    const score = computeRelevanceScore(
      [
        { grade: '感兴趣', commented_at: new Date('2026-07-04T02:00:00Z') },
        { grade: '感兴趣', commented_at: new Date('2026-07-04T05:00:00Z') },
        { grade: '感兴趣', commented_at: new Date('2026-07-04T08:00:00Z') },
      ],
      now
    );
    expect(score).toBe(70);
  });

  it('1 条「精准」10 天前 → 70×0.5 + 10 = 45', () => {
    const score = computeRelevanceScore(
      [{ grade: '精准', commented_at: new Date('2026-06-24T12:00:00Z') }],
      now
    );
    expect(score).toBe(45);
  });

  it('空数组 → 回落 heuristicScore 兜底', () => {
    expect(computeRelevanceScore([], now)).toBe(heuristicScore({}));
  });

  it('40 天前评论 → 衰减系数封顶 0.3，不会更低', () => {
    // 高意向 100 × 0.3 = 30 + 10 频次 = 40；若无封顶则 100×(1-2)=负数
    const score = computeRelevanceScore(
      [{ grade: '高意向', commented_at: new Date('2026-05-25T12:00:00Z') }],
      now
    );
    expect(score).toBe(40);
  });

  it('取历史里最高档权重（混合档位）', () => {
    // 最高档=精准 70，频次 2 条 +20，24h 内 → 70 + 20 = 90
    const score = computeRelevanceScore(
      [
        { grade: '感兴趣', commented_at: new Date('2026-07-04T03:00:00Z') },
        { grade: '精准', commented_at: new Date('2026-07-04T09:00:00Z') },
      ],
      now
    );
    expect(score).toBe(90);
  });
});

describe('rescoreLead', () => {
  it('查 acquisition_lead_comments 表并 UPDATE acquisition_leads.relevance_score', async () => {
    const now = new Date('2026-07-04T12:00:00Z');
    const calls: { text: string; params?: unknown[] }[] = [];
    const pool: QueryablePool = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        calls.push({ text, params });
        if (/acquisition_lead_comments/.test(text)) {
          return {
            rows: [
              { grade: '高意向', commented_at: new Date('2026-07-04T06:00:00Z') },
              { grade: '感兴趣', commented_at: new Date('2026-07-04T09:00:00Z') },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const result = await rescoreLead(pool, 'tenant-1', 'lead-abc', now);

    const selectCall = calls.find((c) => /SELECT/i.test(c.text) && /acquisition_lead_comments/.test(c.text));
    expect(selectCall).toBeTruthy();
    expect(selectCall?.params).toEqual(['tenant-1', 'lead-abc']);

    const updateCall = calls.find((c) => /UPDATE\s+zenithjoy\.acquisition_leads/i.test(c.text));
    expect(updateCall).toBeTruthy();
    expect(/relevance_score/.test(updateCall!.text)).toBe(true);
    // 最高档=高意向 100，2 条 +20 → 120 封顶 100
    expect(result.score).toBe(100);
    expect(result.comment_count).toBe(2);
    expect(updateCall?.params?.[2]).toBe(100);
    expect(updateCall?.params?.[3]).toBe(2);
  });
});
