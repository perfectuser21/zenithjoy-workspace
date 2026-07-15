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
import axios from 'axios';

vi.mock('axios');
import type { QueryablePool } from './acquisition-dispatch';

// Mock: 模拟 DB pool
function makePool(overrides?: {
  existingJudgment?: { judgment_status: string; judgment_reason: string | null } | null;
  targetProfileDesc?: string;
}): QueryablePool {
  return {
    query: vi.fn(async (text: string) => {
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

    // 回归（handoff 0715 Seg2 根因）：空画像短路必须把 matched 落库，
    // 否则 API 响应说 matched，但 acquisition_collect_videos.judgment_status
    // 停在旧值/NULL——下游任何读库判断（派单/看板）永远读不到这次"匹配"。
    const mockQuery = pool.query as ReturnType<typeof vi.fn>;
    const updateCalls = mockQuery.mock.calls.filter(([text]: [string]) =>
      /UPDATE.*collect_videos/i.test(text)
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const [, params] = updateCalls[0] as [string, unknown[]];
    expect(params).toContain('matched');
  });

  /**
   * TC-06: 多模态判定必须走 OpenAI 兼容格式（/chat/completions + image_url）。
   * TOAPIS 是 OpenAI 兼容代理，Gemini 原生 generateContent + inline_data 会挂起
   * （2026-07-13 真机排查坐实：文本秒回、Gemini 原生带图请求 >40s 超时）。
   */
  it('TC-06: 多模态判定走 OpenAI 式 chat/completions + image_url', async () => {
    process.env.TOAPIS_API_KEY = 'test-toapis-key';
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: 'MATCHED' } }] },
    } as never);

    const pool = makePool({ targetProfileDesc: '家装/室内设计目标客户' });
    const result: JudgeVideoResult = await judgeVideo(
      pool,
      'tenant-openai',
      'video-openai-001',
      'screenshot',
      btoa('fake-screenshot'),
    );

    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    // 端点必须是 OpenAI 兼容 chat/completions，不能是 Gemini 原生 generateContent
    expect(url).toContain('/chat/completions');
    expect(url).not.toContain('generateContent');
    // body 必须是 OpenAI messages 结构，且截图走 image_url（不是 Gemini inline_data）
    const messages = body.messages as Array<{ content: Array<{ type: string }> }>;
    expect(Array.isArray(messages)).toBe(true);
    const parts = messages[0].content;
    expect(parts.some((p) => p.type === 'image_url')).toBe(true);
    expect(JSON.stringify(body)).not.toContain('inline_data');
    // 从 OpenAI choices[0].message.content 解析出判定
    expect(result.judgment_status).toBe('matched');
  });

});
