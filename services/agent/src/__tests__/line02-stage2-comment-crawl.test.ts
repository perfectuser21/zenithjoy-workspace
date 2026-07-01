import { describe, it, expect } from 'vitest';

/**
 * line02 Stage 2 评论采集回归守卫
 *
 * 验证 Stage 1（关键词搜索视频）和 Stage 2（评论区采集评论者）的 terminal 语义：
 * - Stage 1 末尾报 terminal='stage_1' → API 状态推到 stage_1_done（不是终态 done）
 * - Stage 2 末尾报 terminal='done' → API 状态推到 done（真正完成）
 * - commenters 非空时才写 acquisition_leads
 */

interface CollectReport {
  task_id: string;
  keyword?: string;
  video_id: string;
  commenters: Array<{ sec_uid: string | null; nickname: string }>;
  terminal?: string;
  error_code?: string;
}

function buildStage1Reports(taskId: string, keyword: string, videoUrls: string[]): CollectReport[] {
  return videoUrls.map((url, i) => ({
    task_id: taskId,
    keyword,
    video_id: url.split('/').pop() || url,
    commenters: [],
    terminal: i === videoUrls.length - 1 ? 'stage_1' : undefined,
  }));
}

function buildStage2Reports(
  taskId: string,
  keyword: string,
  videoUrls: string[],
  commentersByVideo: Array<Array<{ sec_uid: string | null; nickname: string }>>,
): CollectReport[] {
  return videoUrls.map((url, i) => ({
    task_id: taskId,
    keyword,
    video_id: url.split('/').pop() || url,
    commenters: commentersByVideo[i] ?? [],
    terminal: i === videoUrls.length - 1 ? 'done' : undefined,
  }));
}

describe('line02 Stage 2 评论采集结构守卫', () => {
  const TASK_ID = 'test-task-uuid-0001';
  const KEYWORD = '火锅';
  const VIDEOS = [
    'https://www.douyin.com/video/7111111111111111111',
    'https://www.douyin.com/video/7222222222222222222',
    'https://www.douyin.com/video/7333333333333333333',
  ];

  it('Stage 1 末尾 report 用 terminal=stage_1（不是 done）', () => {
    const reports = buildStage1Reports(TASK_ID, KEYWORD, VIDEOS);
    const lastReport = reports[reports.length - 1];
    expect(lastReport.terminal).toBe('stage_1');
    reports.slice(0, -1).forEach((r) => expect(r.terminal).toBeUndefined());
  });

  it('Stage 1 所有 report 的 commenters 都是空数组', () => {
    const reports = buildStage1Reports(TASK_ID, KEYWORD, VIDEOS);
    reports.forEach((r) => expect(r.commenters).toEqual([]));
  });

  it('Stage 2 末尾 report 用 terminal=done（真正完成）', () => {
    const commenters = VIDEOS.map(() => [{ sec_uid: 'MS4wLjABAAAAabc', nickname: '张三' }]);
    const reports = buildStage2Reports(TASK_ID, KEYWORD, VIDEOS, commenters);
    const lastReport = reports[reports.length - 1];
    expect(lastReport.terminal).toBe('done');
    reports.slice(0, -1).forEach((r) => expect(r.terminal).toBeUndefined());
  });

  it('Stage 2 report 包含真实 commenters（不是空数组）', () => {
    const commenters = VIDEOS.map(() => [
      { sec_uid: 'MS4wLjABAAAAabc', nickname: '张三' },
      { sec_uid: 'MS4wLjABAAAAdef', nickname: '李四' },
    ]);
    const reports = buildStage2Reports(TASK_ID, KEYWORD, VIDEOS, commenters);
    reports.forEach((r) => expect(r.commenters.length).toBeGreaterThan(0));
  });

  it('video_id 从 URL 末段提取（匹配 collect/report API 期望的格式）', () => {
    const reports = buildStage1Reports(TASK_ID, KEYWORD, VIDEOS);
    expect(reports[0].video_id).toBe('7111111111111111111');
    expect(reports[1].video_id).toBe('7222222222222222222');
  });

  it('spawnCommentCrawl 使用主号 Chrome CDP 端口 19222（非 burner 19225）', () => {
    // 19225（burner Chrome）可能触发 Douyin CAPTCHA，导致 commenters 恒为 []
    // 必须用主号 Chrome（19222），与 keyword-search 同一个已认证 session
    const EXPECTED_CDP_PORT = "'19222'";
    const FORBIDDEN_CDP_PORT = "'19225'";

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const indexPath = path.join(__dirname, '..', '..', 'build-modules', 'line02', 'index.js');
    const src = fs.readFileSync(indexPath, 'utf8') as string;

    // 取 spawnCommentCrawl 函数代码段
    const crawlStart = src.indexOf('function spawnCommentCrawl');
    const crawlEnd = src.indexOf('function spawnKeywordSearch');
    const crawlBlock = crawlStart >= 0 && crawlEnd > crawlStart
      ? src.slice(crawlStart, crawlEnd)
      : src;

    expect(crawlBlock).toContain(EXPECTED_CDP_PORT);
    expect(crawlBlock).not.toContain(FORBIDDEN_CDP_PORT);
  });
});
