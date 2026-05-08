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
    it('用 input[type="file"] selector + 传 queueData.video_path', async () => {
      const setInputFiles = vi.fn().mockResolvedValue(undefined);
      const fakePage = { setInputFiles };
      await uploadVideoFile(fakePage, '/local/path/test.mp4');
      expect(setInputFiles).toHaveBeenCalledTimes(1);
      expect(setInputFiles).toHaveBeenCalledWith('input[type="file"]', '/local/path/test.mp4');
    });

    it('selector 不含任何 xian-pc 特化字符串', async () => {
      const setInputFiles = vi.fn().mockResolvedValue(undefined);
      await uploadVideoFile({ setInputFiles }, '/x.mp4');
      const calledSelector = setInputFiles.mock.calls[0][0];
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
    it('用 getByRole button + name 正则匹配 发布/高清发布/提交发布/确认发布', async () => {
      const click = vi.fn().mockResolvedValue(undefined);
      const waitFor = vi.fn().mockResolvedValue(undefined);
      const locatorChain = { first: () => ({ click, waitFor }) };
      const getByRole = vi.fn().mockReturnValue(locatorChain);
      const fakePage = { getByRole };
      await clickPublishButton(fakePage);
      expect(getByRole).toHaveBeenCalledTimes(1);
      const [role, opts] = getByRole.mock.calls[0];
      expect(role).toBe('button');
      expect(opts.name).toBeInstanceOf(RegExp);
      expect(opts.name.test('发布')).toBe(true);
      expect(opts.name.test('高清发布')).toBe(true);
      expect(opts.name.test('提交发布')).toBe(true);
      expect(opts.name.test('确认发布')).toBe(true);
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
