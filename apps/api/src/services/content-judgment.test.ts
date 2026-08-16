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
  });

  /**
   * 回归（真机复现 2026-07-16，Path2 安卓真机链路验证时撞到）：缓存命中分支只把结果
   * 返回给调用方，从不写库。writeJudgment/markPending 都是按 (tenant_id, video_id)
   * UPDATE，不分 task_id——同一热门视频被多个采集任务重复抓到时（真机复现常态：同一
   * 关键词反复搜出同一批热门卡片），新任务里刚 INSERT 的那一行 judgment_status 仍是
   * Stage1 落库时的初始值 'pending'，缓存命中直接 return 从不碰这一行，于是这一行永远
   * 卡在 pending——即使 API 响应明明说 cache_hit=true/judgment_status=matched。
   * 期望行为：缓存命中也要执行一次 UPDATE，把缓存到的判决结果写回，这样任何共享该
   * (tenant_id, video_id) 的行（不论来自哪个 task）都能收敛到正确状态。
   */
  it('回归：缓存命中必须把结果写回 DB，否则新任务里刚插入的行永远卡 pending', async () => {
    const pool = makePool({
      existingJudgment: { judgment_status: 'matched', judgment_reason: '符合目标画像' },
    });

    await judgeVideo(
      pool,
      'tenant-test',
      'video-cached-001',
      'screenshot',
      btoa('fake-data'),
    );

    const mockQuery = pool.query as ReturnType<typeof vi.fn>;
    const updateCalls = mockQuery.mock.calls.filter(([text]: [string]) =>
      /UPDATE.*collect_videos/i.test(text)
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    // 写回的必须是缓存到的那个结果，不能写错值
    const [, params] = updateCalls[0] as [string, unknown[]];
    expect(params).toContain('matched');
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

  /**
   * 回归（2026-07-19）：audio 分支必须把 title 塞进 prompt，指示 Gemini "先转写再判断"。
   * 2026-07-17 决策(判定点1d078987)只完成了客户端路由分流，服务端 buildPrompt 从未
   * 真正用上 title、也没有"先转写"指令——单次多模态调用内完成转写+判定两步，不新增
   * 独立转写API调用。
   */
  it('回归: audio分支prompt须含title并指示先转写再判定', async () => {
    process.env.TOAPIS_API_KEY = 'test-toapis-key';
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: 'MATCHED' } }] },
    } as never);

    const pool = makePool({ targetProfileDesc: '家装/室内设计目标客户' });
    await judgeVideo(
      pool,
      'tenant-title-001',
      'video-title-001',
      'audio',
      btoa('fake-pcm-wav-data'),
      undefined,
      undefined,
      '千呼万唤的一镜到底来啦～黑白灰极简小家装修',
    );

    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    const messages = body.messages as Array<{ content: Array<{ type: string; text?: string }> }>;
    const promptText = messages[0].content.find((p) => p.type === 'text')?.text ?? '';
    expect(promptText).toContain('千呼万唤的一镜到底来啦～黑白灰极简小家装修');
    expect(promptText).toContain('转写');
  });

  it('回归: audio分支title为空时不强行拼接空标题', async () => {
    process.env.TOAPIS_API_KEY = 'test-toapis-key';
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: 'MATCHED' } }] },
    } as never);

    const pool = makePool({ targetProfileDesc: '家装/室内设计目标客户' });
    await judgeVideo(
      pool,
      'tenant-title-002',
      'video-title-002',
      'audio',
      btoa('fake-pcm-wav-data'),
    );

    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    const messages = body.messages as Array<{ content: Array<{ type: string; text?: string }> }>;
    const promptText = messages[0].content.find((p) => p.type === 'text')?.text ?? '';
    expect(promptText).not.toContain('《undefined》');
    expect(promptText).not.toContain('《null》');
  });

  /**
   * 回归（2026-07-19，decision 4e421ae8）：audio分支判定matched时，Gemini响应里的
   * "转写：..."那一行必须被解析出来，作为transcript参数传给写库（UPDATE语句参数列表里
   * 能找到这段转写文字）——供后续新增的评论意向分档判定使用完整视频文案。
   */
  it('回归: audio分支判定matched时转写文案被解析并传入UPDATE写库', async () => {
    process.env.TOAPIS_API_KEY = 'test-toapis-key';
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: 'MATCHED\n转写：这是测试转写文案内容' } }] },
    } as never);

    const pool = makePool({ targetProfileDesc: '家装/室内设计目标客户' });
    await judgeVideo(
      pool,
      'tenant-transcript-001',
      'video-transcript-001',
      'audio',
      btoa('fake-pcm-wav-data'),
      undefined,
      undefined,
      '装修视频标题',
    );

    const mockQuery = pool.query as ReturnType<typeof vi.fn>;
    const updateCalls = mockQuery.mock.calls.filter(([text]: [string]) => /UPDATE.*collect_videos/i.test(text));
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const [, params] = updateCalls[updateCalls.length - 1] as [string, unknown[]];
    expect(params).toContain('这是测试转写文案内容');
  });

  it('回归: screenshot分支不要求转写，UPDATE参数里transcript传null', async () => {
    process.env.TOAPIS_API_KEY = 'test-toapis-key';
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: 'MATCHED' } }] },
    } as never);

    const pool = makePool({ targetProfileDesc: '家装/室内设计目标客户' });
    await judgeVideo(
      pool,
      'tenant-transcript-002',
      'video-transcript-002',
      'screenshot',
      btoa('fake-screenshot'),
    );

    const mockQuery = pool.query as ReturnType<typeof vi.fn>;
    const updateCalls = mockQuery.mock.calls.filter(([text]: [string]) => /UPDATE.*collect_videos/i.test(text));
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const [, params] = updateCalls[updateCalls.length - 1] as [string, unknown[]];
    expect(params).not.toContain('这是测试转写文案内容');
  });
});

// ── 视频判定三档 + commander 复核（step2 判定闸加固）─────────────────────────────
// 主判 Gemini 出 MATCHED/REJECTED/UNCERTAIN；UNCERTAIN(存疑) → commander(DeepSeek via ToAPIs)
// 拿主判理由复核 → 准=matched / 不准=rejected；解析失败=默认 rejected(保守)。
// 对外契约不变（存疑在服务端 commander 内部消化）。
describe('content-judgment: 视频三档 + commander 复核', () => {
  beforeEach(() => {
    // mockReset 而非 clearAllMocks：清空 mockResolvedValueOnce 队列，防跨用例泄漏
    // （clearAllMocks 只清 calls/results，不清 Once 队列——用例调用数不齐时会漏进下一个用例）。
    vi.mocked(axios.post).mockReset();
    process.env.TOAPIS_API_KEY = 'test-key';
  });

  // 主判返回 UNCERTAIN，附理由 + 转写，供 commander 复核
  const UNCERTAIN_RESP = {
    data: {
      choices: [
        {
          message: {
            content: 'UNCERTAIN\n原因：内容边界模糊，可能相关也可能无关\n转写：今天分享一个提高效率的小方法',
          },
        },
      ],
    },
  } as never;

  it('主判 UNCERTAIN + commander 准 → matched，且真调了两次（主判 + commander）', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost
      .mockResolvedValueOnce(UNCERTAIN_RESP)
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: '准' } }] } } as never);

    const pool = makePool({ targetProfileDesc: '中小企业主，关注降本增效' });
    const res = await judgeVideo(pool, 'tenant-cmd-1', 'video-cmd-1', 'audio', btoa('fake-audio'));

    expect(res.judgment_status).toBe('matched');
    expect(mockedPost).toHaveBeenCalledTimes(2);
  });

  it('主判 UNCERTAIN + commander 不准 → rejected', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost
      .mockResolvedValueOnce(UNCERTAIN_RESP)
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: '不准' } }] } } as never);

    const pool = makePool({ targetProfileDesc: '中小企业主，关注降本增效' });
    const res = await judgeVideo(pool, 'tenant-cmd-2', 'video-cmd-2', 'audio', btoa('fake-audio'));

    expect(res.judgment_status).toBe('rejected');
    expect(mockedPost).toHaveBeenCalledTimes(2);
  });

  it('主判 UNCERTAIN + commander 乱返回(无法解析) → 默认 rejected（保守，宁可漏也不放）', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost
      .mockResolvedValueOnce(UNCERTAIN_RESP)
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: '嗯……说不好' } }] } } as never);

    const pool = makePool({ targetProfileDesc: '中小企业主，关注降本增效' });
    const res = await judgeVideo(pool, 'tenant-cmd-3', 'video-cmd-3', 'audio', btoa('fake-audio'));

    expect(res.judgment_status).toBe('rejected');
  });

  it('主判 MATCHED → 直接 matched，不调 commander（只一次调用）', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({ data: { choices: [{ message: { content: 'MATCHED' } }] } } as never);

    const pool = makePool({ targetProfileDesc: '中小企业主，关注降本增效' });
    const res = await judgeVideo(pool, 'tenant-cmd-4', 'video-cmd-4', 'audio', btoa('fake-audio'));

    expect(res.judgment_status).toBe('matched');
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it('主判 REJECTED → 直接 rejected，不调 commander（只一次调用）', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: 'REJECTED\n原因：完全跑题' } }] },
    } as never);

    const pool = makePool({ targetProfileDesc: '中小企业主，关注降本增效' });
    const res = await judgeVideo(pool, 'tenant-cmd-5', 'video-cmd-5', 'audio', btoa('fake-audio'));

    expect(res.judgment_status).toBe('rejected');
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it('commander 请求体必须带上主判理由 + 转写文案（让它整体再看）', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost
      .mockResolvedValueOnce(UNCERTAIN_RESP)
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: '准' } }] } } as never);

    const pool = makePool({ targetProfileDesc: '中小企业主，关注降本增效' });
    await judgeVideo(pool, 'tenant-cmd-6', 'video-cmd-6', 'audio', btoa('fake-audio'), undefined, undefined, '效率工具测评');

    // 第二次调用 = commander，请求体应含主判理由 + 转写文案 + 画像
    const commanderCall = mockedPost.mock.calls[1];
    const body = JSON.stringify(commanderCall?.[1] ?? {});
    expect(body).toContain('内容边界模糊'); // 主判理由
    expect(body).toContain('今天分享一个提高效率的小方法'); // 转写文案
    expect(body).toContain('中小企业主'); // 画像
  });
});
