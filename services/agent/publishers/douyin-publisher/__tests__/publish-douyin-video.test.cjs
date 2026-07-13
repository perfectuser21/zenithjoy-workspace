/* eslint-disable @typescript-eslint/no-explicit-any -- vitest mock types require any cast */
// vitest globals: describe, it, expect, vi are injected by vitest (globals: true in config)
// do NOT require('vitest') — CJS cannot import ESM vitest directly
const path = require('path');

// require 时如果模块还没 export 这些函数，整个 describe 都会跑不起来 — 这是 RED 状态
const {
  uploadVideoFile,
  waitForUploadProcessed,
  fillTitle,
  clickPublishButton,
  extractPublishedUrl,
} = require('../publish-douyin-video.cjs');

describe('publish-douyin-video selector 通用化契约', () => {
  describe('uploadVideoFile', () => {
    // 实现已进化为三策略容错（FileChooser → CDP shadow DOM → setInputFiles 兜底），签名加了 context。
    // 契约不变量：策略全链最终仍以 input[type="file"] + video_path 落地，selector 无机器特化。
    // （巡检 2026-07-12 收编时随实现签名更新 mock）
    const makeFakePage = () => ({
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ fileInputCount: 0 }),
      waitForEvent: vi.fn().mockRejectedValue(new Error('no filechooser in unit test')),
      click: vi.fn().mockRejectedValue(new Error('no dom in unit test')),
      setInputFiles: vi.fn().mockResolvedValue(undefined),
    });

    it('兜底策略用 input[type="file"] selector + 传 queueData.video_path', async () => {
      const fakePage = makeFakePage();
      await uploadVideoFile(fakePage, undefined, '/local/path/test.mp4');
      expect(fakePage.setInputFiles).toHaveBeenCalledTimes(1);
      const [selector, filePath] = fakePage.setInputFiles.mock.calls[0];
      expect(selector).toBe('input[type="file"]');
      expect(filePath).toBe('/local/path/test.mp4');
    });

    it('selector 不含任何 xian-pc 特化字符串', async () => {
      const fakePage = makeFakePage();
      await uploadVideoFile(fakePage, undefined, '/x.mp4');
      const calledSelector = fakePage.setInputFiles.mock.calls[0][0];
      expect(calledSelector).not.toMatch(/xian-pc|xuxia|100\.97\.|WINDOWS_BASE_DIR/);
    });
  });

  describe('fillTitle', () => {
    it('用 input[placeholder*="标题"] selector + 传 title', async () => {
      const fill = vi.fn().mockResolvedValue(undefined);
      const waitFor = vi.fn().mockResolvedValue(undefined);
      const locatorChain = { first: () => ({ fill, waitFor }) };
      const locator = vi.fn().mockReturnValue(locatorChain);
      const fakePage = { locator };
      await fillTitle(fakePage, '我的视频标题');
      expect(locator).toHaveBeenCalledWith('input[placeholder*="标题"]');
      expect(fill).toHaveBeenCalledWith('我的视频标题');
    });
  });

  describe('clickPublishButton', () => {
    it('用 getByRole button name=发布 exact=true 严格匹配（避开 nav bar 高清发布 + dropdown 子项）', async () => {
      const click = vi.fn().mockResolvedValue(undefined);
      const waitFor = vi.fn().mockResolvedValue(undefined);
      const locatorChain = { first: () => ({ click, waitFor }) };
      const getByRole = vi.fn().mockReturnValue(locatorChain);
      const fakePage = { getByRole };
      await clickPublishButton(fakePage);
      expect(getByRole).toHaveBeenCalledTimes(1);
      const [role, opts] = getByRole.mock.calls[0];
      expect(role).toBe('button');
      // exact:true 让 name 严格 match "发布"，避免误中 "高清发布" / "发布视频" / "发布图文" 等
      expect(opts.name).toBe('发布');
      expect(opts.exact).toBe(true);
      expect(click).toHaveBeenCalledTimes(1);
    });
  });

  describe('extractPublishedUrl', () => {
    it('从 a[href*="douyin.com/video/"] 抓最近一条 URL，//... 前补 https:', async () => {
      const evaluate = vi.fn().mockResolvedValue('https://www.douyin.com/video/1234567890');
      const fakePage = { evaluate, url: () => 'https://creator.douyin.com/creator-micro/content/manage' };
      const result = await extractPublishedUrl(fakePage);
      expect(result.url).toBe('https://www.douyin.com/video/1234567890');
      expect(result.urlFallback).not.toBe(true);
    });

    it('页面没找到 video link → fallback 到管理页 URL + urlFallback:true', async () => {
      const evaluate = vi.fn().mockResolvedValue(null);
      const fakePage = {
        evaluate,
        url: () => 'https://creator.douyin.com/creator-micro/content/manage',
      };
      const result = await extractPublishedUrl(fakePage);
      expect(result.url).toContain('creator-micro');
      expect(result.urlFallback).toBe(true);
    });
  });
});
