// services/agent/src/handlers/keyword-search-douyin.ts
//
// 智能获客 — 主号 CDP 搜索抖音关键词，返回热门视频 URL 列表
//
// 依赖：主号 Chrome 已在 CDP_PORT(默认19222) 运行且已登录抖音
// 每个关键词：打开 douyin.com/search/{kw}?type=video → 等待视频列表 → 取前 N 条 URL

import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { loadChromium, type ChromiumLike, type LoadChromiumOptions } from '../shared/playwright-launcher';

export interface KeywordSearchResult {
  ok: boolean;
  keyword: string;
  video_urls: string[];
  error?: string;
}

export interface KeywordSearchOptions extends LoadChromiumOptions {
  cdpPort?: number;
  maxVideosPerKeyword?: number;
}

export async function searchDouyinVideosByKeyword(
  keyword: string,
  options: KeywordSearchOptions = {},
): Promise<KeywordSearchResult> {
  // 生产路径：无注入 → spawn 外部 .cjs（绕 pkg+playwright 崩溃）。
  // 测试路径：注入 chromiumLauncher/chromiumLoader → 走下方内部 loadChromium 逻辑（保旧单测绿）。
  if (!options.chromiumLauncher && !options.chromiumLoader) {
    return spawnKeywordSearchProcess(keyword, options);
  }

  // 共享底座：优先 playwright-core（包里打进的那个），打包真机不再报「playwright 未安装」
  const chromium = (await loadChromium(options)) as ChromiumLike & {
    connectOverCDP(url: string): Promise<any>;
  };
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
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[keyword-search-douyin] keyword="${keyword}" error:`, msg);
    return { ok: false, keyword, video_urls: [], error: msg };
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
}

// 解析外部脚本路径（与 qr-bind-douyin-burner resolveBurnerScript 同款查找）
export function resolveKeywordSearchScript(): string {
  const beside = path.join(path.dirname(process.execPath), 'publishers', 'keyword-search-douyin.cjs');
  if (fs.existsSync(beside)) return beside;
  return path.resolve(__dirname, '..', '..', 'publishers', 'keyword-search-douyin.cjs');
}

function resolveNodeExe(): string {
  const env = process.env.ZJ_NODE_EXE;
  if (env && fs.existsSync(env)) return env;
  return 'node';
}

// 生产路径：spawn 外部 Node 进程跑 .cjs，读末行 JSON 当结果。
function spawnKeywordSearchProcess(
  keyword: string,
  options: KeywordSearchOptions,
): Promise<KeywordSearchResult> {
  const scriptPath = resolveKeywordSearchScript();
  const nodeExe = resolveNodeExe();
  const cdpPort = options.cdpPort ?? parseInt(process.env.DOUYIN_CDP_PORT ?? '19222');
  const maxVideos = options.maxVideosPerKeyword ?? 5;
  const args = [scriptPath, keyword, String(cdpPort), String(maxVideos)];

  return new Promise<KeywordSearchResult>((resolve) => {
    let stdout = '';
    const proc = spawn(nodeExe, args, { env: { ...process.env }, timeout: 60000 });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { console.log('[keyword-search-douyin]', d.toString().trimEnd()); });
    proc.on('close', () => {
      const lastLine = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
      try {
        resolve(JSON.parse(lastLine) as KeywordSearchResult);
      } catch {
        resolve({ ok: false, keyword, video_urls: [], error: `result parse failed: ${lastLine || '(no output)'}` });
      }
    });
    proc.on('error', (err: Error) => {
      resolve({ ok: false, keyword, video_urls: [], error: `spawn failed: ${err.message}` });
    });
  });
}
