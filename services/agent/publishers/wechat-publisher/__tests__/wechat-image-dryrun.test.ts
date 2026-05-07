// services/agent/publishers/wechat-publisher/__tests__/wechat-image-dryrun.test.ts
//
// Walking Skeleton #1 — wechat-publisher 图文 dryrun 单测
//
// 验证：
//   - runWechatImageDryrun 成功路径返回 ok:true / dryRun:true / 不点最终发表按钮
//   - chrome CDP 19222 连不上 → ok:false 友好错误（不抛 stack）
//   - 页面命中风控关键词（"风险" / "频繁" / "违规"） → ok:false

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 通过相对路径 require .cjs（vitest 支持）
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runWechatImageDryrun } = require('../publish-wechat-image-dryrun.cjs');

interface FakePageOpts {
  url?: string;
  html?: string;
  publishClicked?: () => void;
}

function makeFakePage(opts: FakePageOpts = {}) {
  let currentUrl = opts.url || 'https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&type=10';
  return {
    url: () => currentUrl,
    goto: vi.fn(async (u: string) => {
      currentUrl = u;
    }),
    waitForTimeout: vi.fn(async () => {}),
    waitForURL: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => ({})),
    content: vi.fn(async () => opts.html || '<html></html>'),
    evaluate: vi.fn(async () => ({ success: true })),
    locator: vi.fn(() => ({
      first: () => ({
        isVisible: vi.fn(async () => true),
        waitFor: vi.fn(async () => {}),
        click: vi.fn(async () => {
          if (opts.publishClicked) opts.publishClicked();
        }),
        getAttribute: vi.fn(async () => null),
      }),
      last: () => ({
        isVisible: vi.fn(async () => true),
        isEnabled: vi.fn(async () => true),
        waitFor: vi.fn(async () => {}),
        click: vi.fn(async () => {
          if (opts.publishClicked) opts.publishClicked();
        }),
      }),
      isVisible: vi.fn(async () => true),
      isEnabled: vi.fn(async () => true),
    })),
    on: vi.fn(),
    setInputFiles: vi.fn(async () => {}),
  };
}

function makeFakeContext(page: ReturnType<typeof makeFakePage>) {
  return {
    pages: () => [page],
    newPage: vi.fn(async () => page),
    newCDPSession: vi.fn(async () => ({
      send: vi.fn(async (method: string) => {
        if (method === 'Runtime.evaluate') {
          return { result: { objectId: 'fake-id' } };
        }
        if (method === 'DOM.describeNode') {
          return { node: { backendNodeId: 1 } };
        }
        return {};
      }),
      detach: vi.fn(async () => {}),
    })),
  };
}

function makeFakeBrowser(context: any) {
  return {
    contexts: () => [context],
    close: vi.fn(async () => {}),
  };
}

describe('runWechatImageDryrun', () => {
  let tmpDir: string;
  let queueFile: string;
  let imgFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-wx-img-dry-'));
    imgFile = path.join(tmpDir, 'cover.png');
    fs.writeFileSync(imgFile, 'fake-png-bytes');
    queueFile = path.join(tmpDir, 'queue.json');
    fs.writeFileSync(
      queueFile,
      JSON.stringify({
        title: '测试图文 dryrun',
        content: '这是 walking-skeleton-1 自检文案',
        images: [imgFile],
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

  it('returns ok:true with dryRun:true on happy path (does not click 发表)', async () => {
    let publishClicked = false;
    const page = makeFakePage({ publishClicked: () => (publishClicked = true) });
    const ctx = makeFakeContext(page);
    const browser = makeFakeBrowser(ctx);
    const chromium = { connectOverCDP: vi.fn(async () => browser) };

    const out = await runWechatImageDryrun(queueFile, { chromium });

    expect(out.ok).toBe(true);
    expect(out.dryRun).toBe(true);
    expect(out.imagesCount).toBe(1);
    expect(out.title).toBe('测试图文 dryrun');
    // dryrun 必须不点击「发表」按钮
    expect(publishClicked).toBe(false);
    expect(chromium.connectOverCDP).toHaveBeenCalledWith(
      expect.stringMatching(/19222/),
    );
  });

  it('returns ok:false friendly error when chrome CDP not connected', async () => {
    const chromium = {
      connectOverCDP: vi.fn(async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:19222');
      }),
    };

    const out = await runWechatImageDryrun(queueFile, { chromium });

    expect(out.ok).toBe(false);
    expect(out.error).toBeTruthy();
    expect(String(out.error)).toMatch(/CDP|chrome|19222|connect/i);
  });

  it('returns ok:false when page content hits 风控 keyword (风险)', async () => {
    const page = makeFakePage({
      html: '<div>操作太频繁，存在风险，请稍后再试</div>',
    });
    const ctx = makeFakeContext(page);
    const browser = makeFakeBrowser(ctx);
    const chromium = { connectOverCDP: vi.fn(async () => browser) };

    const out = await runWechatImageDryrun(queueFile, { chromium });

    expect(out.ok).toBe(false);
    expect(String(out.error)).toMatch(/风险|频繁|风控/);
  });
});
