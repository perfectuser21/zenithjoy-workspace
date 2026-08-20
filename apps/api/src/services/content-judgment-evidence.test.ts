/**
 * 内容判定链「假绿」三件套的回归守卫（挂片 2a23912e 修复）。
 *
 * 真机数据 0817–0819：38 个视频**只有 2 个有转写**，判定链实际上 100% 空转，
 * 而挂片一直标着 working。两条病叠加：
 *   (A) MediaProjection 授权进程重启即失效 → 16/38 是 skipped_capture_failed（无内容）
 *   (B) 剩下 22 个走音频路径，extractTranscript 找不到「转写：」、主判解析不了
 *       → parse_fallback → commander「输出无法解析一律保守判 rejected」→ 20 个 rejected
 *
 * 本文件守三件事：
 *   ① 采集失败绝不判 matched —— empty_profile 短路排在 skipped_capture_failed 之前是 fail-open
 *   ② 幂等 cache 命中不许覆盖 capture_type —— 它是「这次采集怎么样」的事实，不是判定结论的一部分。
 *      覆盖它会让 DB 看起来像「采集失败却判通过」，2026-08-20 排查时直接把人带沟里
 *   ③ AI 原始返回必须落库 —— 不留原始文本就永远修不对解析（judgment_reason 只有解析后的碎片）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { judgeVideo } from './content-judgment';
import type { QueryablePool } from './acquisition-dispatch';

vi.mock('axios');

type Call = { sql: string; params: unknown[] };

function makePool(opts?: {
  existingJudgment?: { judgment_status: string; judgment_reason: string | null } | null;
  targetProfileDesc?: string;
  calls?: Call[];
}): QueryablePool {
  return {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      opts?.calls?.push({ sql: text, params: params ?? [] });
      if (/SELECT.*judgment_status.*collect_videos/i.test(text)) {
        return { rows: opts?.existingJudgment ? [opts.existingJudgment] : [] };
      }
      if (/SELECT.*target_profile_desc.*acquisition_config/i.test(text)) {
        return { rows: [{ target_profile_desc: opts?.targetProfileDesc ?? '中小企业主' }] };
      }
      return { rows: [], rowCount: 1 };
    }),
  } as unknown as QueryablePool;
}

const updateCalls = (calls: Call[]) => calls.filter((c) => /UPDATE.*collect_videos/i.test(c.sql));

beforeEach(() => {
  vi.clearAllMocks();
  // 没有 key 会在调模型之前就早退成 pending，测不到解析逻辑
  vi.stubEnv('TOAPIS_API_KEY', 'test-key');
});
afterEach(() => vi.unstubAllEnvs());

describe('① 采集失败绝不判 matched [REGRESSION]', () => {
  it('空画像 + 采集失败 → pending，不许因为画像空就放行', async () => {
    const result = await judgeVideo(
      makePool({ targetProfileDesc: '' }),
      'tenant-x', 'video-cap-failed', 'skipped_capture_failed', '',
    );

    expect(
      result.judgment_status,
      '拿不到任何内容就判 matched 是在说谎——真机上 16/38 的视频都是这个状态',
    ).toBe('pending');
    expect(result.judgment_reason).toBe('skipped_capture_failed');
  });

  it('空画像 + 正常采集 → 仍然 matched（INV-6 行为不变，别误伤）', async () => {
    const result = await judgeVideo(
      makePool({ targetProfileDesc: '' }),
      'tenant-x', 'video-ok', 'screenshot', btoa('fake'),
    );
    expect(result.judgment_status).toBe('matched');
  });
});

describe('② 幂等 cache 命中不许覆盖 capture_type [REGRESSION]', () => {
  it('cache 命中时写库不得把 capture_type 改成本次的（销毁上次采集事实）', async () => {
    const calls: Call[] = [];
    const pool = makePool({
      existingJudgment: { judgment_status: 'matched', judgment_reason: null },
      calls,
    });

    const result = await judgeVideo(pool, 'tenant-x', 'video-cached', 'skipped_capture_failed', '');

    expect(result.cache_hit).toBe(true);
    expect(result.judgment_status).toBe('matched');

    const writes = updateCalls(calls);
    expect(writes.length, 'cache 命中仍要写库（防新 task 那行卡死 pending）').toBeGreaterThan(0);
    for (const w of writes) {
      expect(
        w.params.includes('skipped_capture_failed'),
        'cache 命中时把 capture_type 覆盖成本次的失败值 —— DB 会显示「采集失败却判通过」，' +
          '2026-08-20 排查时正是被这条误导',
      ).toBe(false);
    }
  });
});

describe('③ AI 原始返回必须落库 [BEHAVIOR]', () => {
  const rawText = '判定：匹配\n转写：这是一段装修报价的口播内容\n原因：目标受众吻合';

  it('主判的原始返回被写进库，供事后排查解析格式', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: { choices: [{ message: { content: rawText } }] },
    } as never);
    const calls: Call[] = [];

    await judgeVideo(makePool({ calls }), 'tenant-x', 'video-raw', 'audio', btoa('audio'), undefined, undefined, '标题');

    const wroteRaw = updateCalls(calls).some((w) =>
      w.params.some((p) => typeof p === 'string' && p.includes('这是一段装修报价的口播内容')),
    );
    expect(
      wroteRaw,
      '不留 AI 原始返回就永远修不对解析——真机 38 个视频里 36 个 extractTranscript 提不出转写，' +
        '而我们完全不知道模型到底吐了什么',
    ).toBe(true);
  });

  it('超长返回必须截断，别把库撑爆', async () => {
    const huge = '判定：匹配\n转写：' + 'x'.repeat(9000);
    vi.mocked(axios.post).mockResolvedValue({
      data: { choices: [{ message: { content: huge } }] },
    } as never);
    const calls: Call[] = [];

    await judgeVideo(makePool({ calls }), 'tenant-x', 'video-huge', 'audio', btoa('audio'));

    for (const w of updateCalls(calls)) {
      for (const p of w.params) {
        if (typeof p === 'string' && p.startsWith('判定：匹配')) {
          expect(p.length).toBeLessThanOrEqual(4000);
        }
      }
    }
  });
});

describe('④ 判定解析不许依赖行序 [REGRESSION]', () => {
  /**
   * prompt 自相矛盾：一边说「请先转写这段音频的内容，再结合标题和转写内容共同判断」，
   * 一边又说「第一行：MATCHED 或 REJECTED 或 UNCERTAIN」。模型照前一条做就会把转写放第一行，
   * 而 parseGeminiResponse 用的是 `upper.startsWith('MATCHED')` —— 必然解析失败
   * → parse_fallback → commander「输出无法解析一律保守判 rejected」。
   * 真机 0817-0819 的 20 个 rejected 就是这么来的，不是视频真的不匹配。
   */
  const rawTranscriptFirst = '转写：这是一段讲装修报价的口播\nMATCHED';

  it('模型先转写后判定 → 仍解析为 matched，不许掉进 parse_fallback', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: { choices: [{ message: { content: rawTranscriptFirst } }] },
    } as never);
    const calls: Call[] = [];

    const r = await judgeVideo(makePool({ calls }), 'tenant-x', 'v-order', 'audio', btoa('a'));

    expect(r.judgment_status, '判定关键词不在第一行就判不出来 —— 而 prompt 恰恰要求先转写').toBe('matched');
    const wroteTranscript = updateCalls(calls).some((w) =>
      w.params.some((p) => typeof p === 'string' && p.includes('讲装修报价的口播')),
    );
    expect(wroteTranscript, '转写也要能提出来').toBe(true);
  });

  it('REJECTED 在转写之后 → 正确解析为 rejected 并带上原因', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: { choices: [{ message: { content: '转写：随便聊聊日常\nREJECTED\n原因：与画像无关' } }] },
    } as never);

    const r = await judgeVideo(makePool(), 'tenant-x', 'v-order2', 'audio', btoa('a'));

    expect(r.judgment_status).toBe('rejected');
    expect(r.judgment_reason).toBe('与画像无关');
  });

  it('转写正文里出现关键词不许被误当成判定', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: { choices: [{ message: { content: '转写：他说这个方案 REJECTED 掉了\nMATCHED' } }] },
    } as never);

    const r = await judgeVideo(makePool(), 'tenant-x', 'v-order3', 'audio', btoa('a'));

    expect(r.judgment_status, '转写行必须被跳过，否则内容里一个词就能翻转判定').toBe('matched');
  });
})
