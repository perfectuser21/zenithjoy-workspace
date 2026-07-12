/**
 * content-judgment.test.ts — commit-1 Red
 *
 * 这个文件在 commit-1 阶段故意 FAIL：
 *   - import 的 `./content-judgment` 模块尚不存在
 *   - 所有测试用例在 commit-4（Green）实现后才会通过
 *
 * 测试覆盖契约中的三个核心用例：
 *   TC-03: judgment API 超时 → 标 pending，不阻塞其他视频
 *   TC-05: 同 video_id 非 pending 结果 → cache_hit: true（不重复调 Gemini）
 *   INV-6: empty target_profile_desc → 直接返回 matched（跳过 Gemini）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { judgeVideo, type JudgeVideoResult } from './content-judgment';
import type { QueryablePool } from './acquisition-dispatch';

// Mock: 模拟 DB pool
function makePool(overrides?: {
  existingJudgment?: { judgment_status: string; judgment_reason: string | null } | null;
  targetProfileDesc?: string;
}): QueryablePool {
  return {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      // 查 judgment 缓存
      if (/SELECT.*judgment_status.*collect_videos/i.test(text)) {
        if (overrides?.existingJudgment) {
          return { rows: [overrides.existingJudgment] };
        }
        return { rows: [] };
      }
      // 查 target_profile_desc
      if (/SELECT.*target_profile_desc.*acquisition_config/i.test(text)) {
        const desc = overrides?.targetProfileDesc ?? '中小企业主，关注降本增效';
        return { rows: [{ target_profile_desc: desc }] };
      }
      // UPDATE collect_videos
      if (/UPDATE.*collect_videos/i.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    }),
  };
}

describe('content-judgment judgeVideo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * TC-03: judgment API 超时（force_timeout=true）→ 标 pending，不阻塞
   * 超时后应立即返回 judgment_status=pending，不应等待 8s
   */
  it('TC-03: judgment api timeout should mark pending and not block other videos', async () => {
    const pool = makePool();
    const startMs = Date.now();

    const result: JudgeVideoResult = await judgeVideo(
      pool,
      'tenant-test',
      'video-timeout-001',
      'screenshot',
      btoa('fake-screenshot-data'),
      undefined,  // forceResult
      true,       // forceTimeout = true (test env only)
    );

    const elapsedMs = Date.now() - startMs;

    // 应返回 pending
    expect(result.judgment_status).toBe('pending');
    // 不应真的等 8s — force_timeout 应立即返回（<= 2s）
    expect(elapsedMs).toBeLessThan(2000);
  }, 10_000);

  /**
   * TC-05: 同 video_id 已有非 pending 结果 → 返回 cache_hit: true，不再调 Gemini
   */
  it('TC-05: same video_id with non-pending result should not re-call gemini', async () => {
    const pool = makePool({
      existingJudgment: { judgment_status: 'matched', judgment_reason: '符合目标画像' },
    });

    const result: JudgeVideoResult = await judgeVideo(
      pool,
      'tenant-test',
      'video-cached-001',
      'screenshot',
      btoa('fake-data'),
    );

    expect(result.judgment_status).toBe('matched');
    expect(result.cache_hit).toBe(true);

    // 验证没有调用 UPDATE（不应重新写库）
    const mockQuery = pool.query as ReturnType<typeof vi.fn>;
    const updateCalls = mockQuery.mock.calls.filter(([text]: [string]) =>
      /UPDATE/i.test(text)
    );
    expect(updateCalls).toHaveLength(0);
  });

  /**
   * INV-6: empty target_profile_desc → 跳过 Gemini，直接返回 matched
   */
  it('INV-6: empty target_profile_desc should default all videos to matched', async () => {
    const pool = makePool({ targetProfileDesc: '' });

    const result: JudgeVideoResult = await judgeVideo(
      pool,
      'tenant-no-profile',
      'video-no-profile-001',
      'screenshot',
      btoa('fake-data'),
    );

    expect(result.judgment_status).toBe('matched');
    // 空画像时不应是缓存命中（是主动跳过 Gemini 的逻辑）
    expect(result.cache_hit).toBeUndefined();
  });
});
