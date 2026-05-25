// services/agent/src/handlers/keyword-search-douyin.ts
//
// 智能获客 — 主号 CDP 搜索抖音关键词，返回热门视频 URL 列表
//
// 依赖：主号 Chrome 已在 CDP_PORT(默认19222) 运行且已登录抖音
// 每个关键词：打开 douyin.com/search/{kw}?type=video → 等待视频列表 → 取前 N 条 URL

import path from 'node:path';

export interface KeywordSearchResult {
  ok: boolean;
  keyword: string;
  video_urls: string[];
  error?: string;
}

export interface KeywordSearchOptions {
  cdpPort?: number;
  maxVideosPerKeyword?: number;
}

export async function searchDouyinVideosByKeyword(
  keyword: string,
  options: KeywordSearchOptions = {},
): Promise<KeywordSearchResult> {
  const { chromium } = await import('playwright');
  const cdpPort = options.cdpPort ?? parseInt(process.env.DOUYIN_CDP_PORT ?? '19222');
  const maxVideos = options.maxVideosPerKeyword ?? 5;

  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;

  try {
    browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      return { ok: false, keyword, video_urls: [], error: 'NO_CDP_CONTEXT' };
    }
    const ctx = contexts[0];
    const page = await ctx.newPage();

    try {
      const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=video`;
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

      // Wait for video results to appear
      await page.waitForSelector('[data-e2e="search-video-card"], [class*="video-card"], a[href*="/video/"]', {
        timeout: 15000,
      }).catch(() => null);

      // Extract video URLs — try multiple selector patterns
      const videoUrls = await page.evaluate((max: number) => {
        const anchors = Array.from(document.querySelectorAll('a[href*="/video/"]'));
        const seen = new Set<string>();
        const results: string[] = [];
        for (const a of anchors) {
          const href = (a as HTMLAnchorElement).href;
          const match = href.match(/douyin\.com\/video\/(\d+)/);
          if (match && !seen.has(match[1])) {
            seen.add(match[1]);
            results.push(`https://www.douyin.com/video/${match[1]}`);
            if (results.length >= max) break;
          }
        }
        return results;
      }, maxVideos);

      return { ok: true, keyword, video_urls: videoUrls };
    } finally {
      await page.close().catch(() => null);
    }
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`[keyword-search-douyin] keyword="${keyword}" error:`, msg);
    return { ok: false, keyword, video_urls: [], error: msg };
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
}
