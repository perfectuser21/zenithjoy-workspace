// services/agent/publishers/wechat-publisher/__tests__/wechat-image.test.ts
//
// Walking Skeleton #1 — wechat-publisher 图文「真发」单测
//
// 验证：
//   - runWechatImage 成功路径返回 ok:true / dryRun:false / 真点击发表
//   - chrome CDP 19222 连不上 → ok:false 友好错误
//   - 页面命中风控关键词 → ok:false（兜底）

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runWechatImage } = require('../publish-wechat-image.cjs');

function makeFakePage(opts: { url?: string; html?: string; onPublish?: () => void } = {}) {
  let currentUrl = opts.url || 'https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit';
  return {
    url: () => currentUrl,
    goto: vi.fn(async (u: string) => {
      currentUrl = u;
    }),
    waitForTimeout: vi.fn(async () => {}),
    waitForURL: vi.fn(async (urlOrRegex: any) => {
      // 模拟跳转到「已发布」/草稿页
      currentUrl = 'https://mp.weixin.qq.com/s/fake-published-id';
    }),
    waitForSelector: vi.fn(async () => ({})),
    content: vi.fn(async () => opts.html || '<html></html>'),
    evaluate: vi.fn(async () => ({ success: true })),
    locator: vi.fn(() => ({
      first: () => ({
        isVisible: vi.fn(async () => true),
        waitFor: vi.fn(async () => {}),
        click: vi.fn(async () => {
          if (opts.onPublish) opts.onPublish();
        }),
        getAttribute: vi.fn(async () => null),
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

describe('runWechatImage (real publish)', () => {
  let tmpDir: string;
  let queueFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-wx-img-real-'));
    const img = path.join(tmpDir, 'cover.png');
    fs.writeFileSync(img, 'fake-png');
    queueFile = path.join(tmpDir, 'queue.json');
    fs.writeFileSync(
      queueFile,
      JSON.stringify({
        title: '真发图文测试',
        content: '正文内容',
        images: [img],
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

  it('returns ok:true dryRun:false on happy path (clicks 发表)', async () => {
    let clicked = false;
    const page = makeFakePage({ onPublish: () => (clicked = true) });
    const browser = makeFakeBrowser(page);
    const chromium = { connectOverCDP: vi.fn(async () => browser) };

    const out = await runWechatImage(queueFile, { chromium });

    expect(out.ok).toBe(true);
    expect(out.dryRun).toBe(false);
    expect(out.title).toBe('真发图文测试');
    expect(out.imagesCount).toBe(1);
    expect(clicked).toBe(true);
    expect(out.url).toMatch(/mp\.weixin\.qq\.com/);
  });

  it('returns ok:false when CDP 19222 not reachable', async () => {
    const chromium = {
      connectOverCDP: vi.fn(async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:19222');
      }),
    };
    const out = await runWechatImage(queueFile, { chromium });
    expect(out.ok).toBe(false);
    expect(String(out.error)).toMatch(/CDP|chrome|19222|connect/i);
  });

  it('returns ok:false when 风控 keyword detected (违规)', async () => {
    const page = makeFakePage({
      html: '<div>检测到违规内容，发布被拦截</div>',
    });
    const browser = makeFakeBrowser(page);
    const chromium = { connectOverCDP: vi.fn(async () => browser) };

    const out = await runWechatImage(queueFile, { chromium });

    expect(out.ok).toBe(false);
    expect(String(out.error)).toMatch(/违规|风险|风控|频繁/);
  });
});
