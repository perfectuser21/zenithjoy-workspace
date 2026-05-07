// services/agent/publishers/wechat-publisher/__tests__/wechat-article.test.ts
//
// Walking Skeleton #1 — wechat-publisher 长文（图文消息正文）单测
//
// 验证：
//   - runWechatArticle 接受 markdown 正文 → 转 HTML → 填编辑器 → 真点击发表
//   - chrome CDP 19222 连不上 → ok:false
//   - 页面命中风控关键词 → ok:false

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runWechatArticle } = require('../publish-wechat-article.cjs');

function makeFakePage(opts: {
  url?: string;
  html?: string;
  onPublish?: () => void;
  onContentFill?: (html: string) => void;
} = {}) {
  let currentUrl = opts.url || 'https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&type=article';
  let lastEvalArg: any = null;
  return {
    url: () => currentUrl,
    goto: vi.fn(async (u: string) => {
      currentUrl = u;
    }),
    waitForTimeout: vi.fn(async () => {}),
    waitForURL: vi.fn(async () => {
      currentUrl = 'https://mp.weixin.qq.com/s/fake-article-id';
    }),
    waitForSelector: vi.fn(async () => ({})),
    content: vi.fn(async () => opts.html || '<html></html>'),
    evaluate: vi.fn(async (_fn: any, arg: any) => {
      lastEvalArg = arg;
      if (typeof arg === 'object' && arg && arg.body && opts.onContentFill) {
        opts.onContentFill(arg.body);
      }
      return { success: true };
    }),
    locator: vi.fn(() => ({
      first: () => ({
        isVisible: vi.fn(async () => true),
        waitFor: vi.fn(async () => {}),
        click: vi.fn(async () => {
          if (opts.onPublish) opts.onPublish();
        }),
      }),
      last: () => ({
        isVisible: vi.fn(async () => true),
        isEnabled: vi.fn(async () => true),
        waitFor: vi.fn(async () => {}),
        click: vi.fn(async () => {
          if (opts.onPublish) opts.onPublish();
        }),
      }),
      isVisible: vi.fn(async () => true),
      isEnabled: vi.fn(async () => true),
    })),
    on: vi.fn(),
  };
}

function makeFakeBrowser(page: ReturnType<typeof makeFakePage>) {
  const ctx = {
    pages: () => [page],
    newPage: vi.fn(async () => page),
    newCDPSession: vi.fn(async () => ({
      send: vi.fn(async (method: string) => {
        if (method === 'Runtime.evaluate') return { result: { objectId: 'oid' } };
        if (method === 'DOM.describeNode') return { node: { backendNodeId: 1 } };
        return {};
      }),
      detach: vi.fn(async () => {}),
    })),
  };
  return {
    contexts: () => [ctx],
    close: vi.fn(async () => {}),
  };
}

describe('runWechatArticle', () => {
  let tmpDir: string;
  let queueFile: string;
  let mdFile: string;
  let coverFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-wx-article-'));
    mdFile = path.join(tmpDir, 'article.md');
    fs.writeFileSync(
      mdFile,
      '# 大标题\n\n这是**正文**段落。\n\n- 列表项 1\n- 列表项 2\n',
    );
    coverFile = path.join(tmpDir, 'cover.jpg');
    fs.writeFileSync(coverFile, 'fake-jpg');
    queueFile = path.join(tmpDir, 'queue.json');
    fs.writeFileSync(
      queueFile,
      JSON.stringify({
        title: '长文测试',
        digest: '摘要内容',
        cover: coverFile,
        markdown_path: mdFile,
      }),
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('returns ok:true dryRun:false on happy path (markdown→HTML, clicks 发表)', async () => {
    let clicked = false;
    let filledHtml = '';
    const page = makeFakePage({
      onPublish: () => (clicked = true),
      onContentFill: (html: string) => (filledHtml = html),
    });
    const browser = makeFakeBrowser(page);
    const chromium = { connectOverCDP: vi.fn(async () => browser) };

    const out = await runWechatArticle(queueFile, { chromium });

    expect(out.ok).toBe(true);
    expect(out.dryRun).toBe(false);
    expect(out.title).toBe('长文测试');
    expect(clicked).toBe(true);
    expect(out.url).toMatch(/mp\.weixin\.qq\.com/);
  });

  it('returns ok:false when CDP 19222 not reachable', async () => {
    const chromium = {
      connectOverCDP: vi.fn(async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:19222');
      }),
    };
    const out = await runWechatArticle(queueFile, { chromium });
    expect(out.ok).toBe(false);
    expect(String(out.error)).toMatch(/CDP|chrome|19222|connect/i);
  });

  it('returns ok:false when 风控 keyword detected (违规)', async () => {
    const page = makeFakePage({
      html: '<div>正文涉及违规内容，无法发表</div>',
    });
    const browser = makeFakeBrowser(page);
    const chromium = { connectOverCDP: vi.fn(async () => browser) };

    const out = await runWechatArticle(queueFile, { chromium });

    expect(out.ok).toBe(false);
    expect(String(out.error)).toMatch(/违规|风险|频繁|风控/);
  });
});
