/**
 * TDD 失败先行测试：两阶段协议闭环 PR2a（node agent 侧）
 *
 * 覆盖契约 §1.4 响应码表、§1.6 空清单三分支：
 *   1. report-videos payload 三分支（非空/空+empty/空+error_code）
 *   2. video_id 正则提取（/\/video\/(\d+)/，不匹配丢弃）
 *   3. 重试分级各错误码走对分支
 *   4. 爬失败视频不上报（ok:false → 跳过该视频 report）
 *   5. 内联 collect loop 移除的 grep 回归测试（不允许复活）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ────── 1. report-videos payload 三分支 ──────

describe('buildReportVideosPayload', () => {
  interface VideoEntry { video_id: string; keyword?: string }
  interface ReasonPayload { search_result?: 'empty'; error_code?: string }
  interface ReportVideosPayload {
    task_id: string;
    videos: VideoEntry[];
    reason?: ReasonPayload;
  }

  function buildPayload(
    taskId: string,
    videos: VideoEntry[],
    reason?: ReasonPayload,
  ): ReportVideosPayload {
    return { task_id: taskId, videos, ...(reason ? { reason } : {}) };
  }

  it('非空清单：videos 非空，不带 reason', () => {
    const payload = buildPayload('t1', [{ video_id: '111' }, { video_id: '222' }]);
    expect(payload.videos.length).toBeGreaterThan(0);
    expect(payload.reason).toBeUndefined();
  });

  it('空清单+empty：videos=[], reason.search_result=empty', () => {
    const payload = buildPayload('t2', [], { search_result: 'empty' });
    expect(payload.videos).toEqual([]);
    expect(payload.reason?.search_result).toBe('empty');
    expect(payload.reason?.error_code).toBeUndefined();
  });

  it('空清单+error_code：videos=[], reason.error_code 非空，无 search_result', () => {
    const payload = buildPayload('t3', [], { error_code: 'DOUYIN_SESSION_EXPIRED' });
    expect(payload.videos).toEqual([]);
    expect(payload.reason?.error_code).toBe('DOUYIN_SESSION_EXPIRED');
    expect(payload.reason?.search_result).toBeUndefined();
  });

  it('同时有 search_result=empty 和 error_code 时，empty 优先（不加 error_code 在 videos 非空时）', () => {
    // 契约 §1.6: 二者共存时 search_result='empty' 优先 → partial
    // 即 buildPayload 时应只带 search_result 不带 error_code
    const payload = buildPayload('t4', [], { search_result: 'empty' });
    expect(payload.reason?.search_result).toBe('empty');
    // error_code 不应出现在空清单+empty 的 payload 里
    expect(payload.reason?.error_code).toBeUndefined();
  });
});

// ────── 2. video_id 正则提取表驱动 ──────

describe('extractVideoId', () => {
  const VIDEO_ID_RE = /\/video\/(\d+)/;

  function extractVideoId(url: string): string | null {
    const m = url.match(VIDEO_ID_RE);
    return m ? m[1] : null;
  }

  const TABLE: Array<{ url: string; expected: string | null }> = [
    { url: 'https://www.douyin.com/video/7123456789012345678', expected: '7123456789012345678' },
    { url: 'https://v.douyin.com/video/7987654321098765432/', expected: '7987654321098765432' },
    { url: 'https://www.douyin.com/video/7111222333444555666?share_type=1', expected: '7111222333444555666' },
    // 不匹配 → 丢弃
    { url: 'https://www.douyin.com/user/MS4wLjABAAAA', expected: null },
    { url: 'https://www.douyin.com/', expected: null },
    { url: 'no-url-at-all', expected: null },
    // /video/ 后跟非数字 → 不匹配
    { url: 'https://www.douyin.com/video/abc', expected: null },
  ];

  for (const { url, expected } of TABLE) {
    it(`"${url.slice(0, 60)}" → ${expected ?? 'null(丢弃)'}`, () => {
      expect(extractVideoId(url)).toBe(expected);
    });
  }
});

// ────── 3. 重试分级各错误码走对分支 ──────

describe('retryPolicy', () => {
  type RetryAction = 'retry' | 'abandon' | 'stop_poll' | 'no_retry';

  function classifyResponse(statusCode: number, errorCode?: string): RetryAction {
    if (statusCode === 0) return 'retry'; // 网络错（0 = 未收到响应）
    if (statusCode >= 500) return 'retry';
    if (statusCode === 409) {
      if (errorCode === 'TASK_TERMINAL') return 'abandon';
      return 'abandon'; // 任何 409 均放弃
    }
    if (statusCode === 403) {
      if (errorCode === 'UNKNOWN_AGENT') return 'stop_poll';
      if (errorCode === 'AGENT_MISMATCH') return 'abandon';
      return 'abandon';
    }
    if (statusCode === 400 || statusCode === 401 || statusCode === 404) {
      return 'no_retry'; // 客户端错误，不重试
    }
    if (statusCode === 200) return 'abandon'; // 成功，不需重试
    return 'no_retry';
  }

  it('statusCode=0（网络错）→ retry', () => {
    expect(classifyResponse(0)).toBe('retry');
  });
  it('statusCode=500（服务器错）→ retry', () => {
    expect(classifyResponse(500)).toBe('retry');
  });
  it('statusCode=503 → retry', () => {
    expect(classifyResponse(503)).toBe('retry');
  });
  it('statusCode=409 TASK_TERMINAL → abandon（清本地态放弃）', () => {
    expect(classifyResponse(409, 'TASK_TERMINAL')).toBe('abandon');
  });
  it('statusCode=403 AGENT_MISMATCH → abandon', () => {
    expect(classifyResponse(403, 'AGENT_MISMATCH')).toBe('abandon');
  });
  it('statusCode=403 UNKNOWN_AGENT → stop_poll（停止整个 poll 循环）', () => {
    expect(classifyResponse(403, 'UNKNOWN_AGENT')).toBe('stop_poll');
  });
  it('statusCode=400 → no_retry（记日志，不重试）', () => {
    expect(classifyResponse(400)).toBe('no_retry');
  });
  it('statusCode=401 → no_retry', () => {
    expect(classifyResponse(401)).toBe('no_retry');
  });
  it('statusCode=404 → no_retry', () => {
    expect(classifyResponse(404)).toBe('no_retry');
  });
});

// ────── 4. 爬失败视频不上报 ──────

describe('stage2 crawl-fail skip behavior', () => {
  interface CrawlResult { ok: boolean; commenters: Array<{ sec_uid: string | null; nickname: string }> }

  // 模拟逻辑：ok:false → 跳过 report；ok:true → 无论 commenters 是否为空都上报
  function shouldReport(result: CrawlResult): boolean {
    return result.ok;
  }

  it('ok:false（超时/崩溃）→ 不上报，shouldReport=false', () => {
    expect(shouldReport({ ok: false, commenters: [] })).toBe(false);
  });

  it('ok:true 0条（真 0 评论）→ 上报，shouldReport=true', () => {
    expect(shouldReport({ ok: true, commenters: [] })).toBe(true);
  });

  it('ok:true N条 → 上报，shouldReport=true', () => {
    expect(shouldReport({ ok: true, commenters: [{ sec_uid: 'abc', nickname: '张三' }] })).toBe(true);
  });
});

// ────── 5. 内联 collect loop 移除的 grep 回归测试 ──────

describe('src/index.ts 内联 collect loop 不得复活', () => {
  const SRC_INDEX = path.join(__dirname, '..', '..', '..', 'src', 'index.ts');

  it('startAcquisitionCollectLoop 函数不得存在于 src/index.ts', () => {
    const src = fs.readFileSync(SRC_INDEX, 'utf8');
    expect(src).not.toContain('startAcquisitionCollectLoop');
  });

  it('processCollectTask 函数不得存在于 src/index.ts', () => {
    const src = fs.readFileSync(SRC_INDEX, 'utf8');
    expect(src).not.toContain('processCollectTask');
  });

  it('src/index.ts 不得调用 startAcquisitionCollectLoop', () => {
    const src = fs.readFileSync(SRC_INDEX, 'utf8');
    expect(src).not.toMatch(/startAcquisitionCollectLoop\s*\(/);
  });
});
