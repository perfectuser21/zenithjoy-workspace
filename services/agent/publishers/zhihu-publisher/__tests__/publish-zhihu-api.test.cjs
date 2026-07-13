'use strict';
/**
 * publish-zhihu-api 单元测试
 *
 * 测试策略：
 * - 不启动真实浏览器/CDP，仅测试纯函数逻辑
 * - 覆盖：isLoginError、parseZhihuResponse、textToZhihuHtml、findCoverImage
 *
 * 运行：
 *   node --test packages/workflows/skills/zhihu-publisher/scripts/__tests__/publish-zhihu-api.test.cjs
 */

const path = require('path');

const {
  isLoginError,
  parseZhihuResponse,
  textToZhihuHtml,
  findCoverImage,
} = require('../publish-zhihu-api.cjs');

// ============================================================
// isLoginError
// ============================================================

describe('isLoginError', () => {
  test('空/非字符串 → false', () => {
    expect(isLoginError(null)).toBe(false);
    expect(isLoginError(undefined)).toBe(false);
    expect(isLoginError(123)).toBe(false);
    expect(isLoginError('')).toBe(false);
  });

  test('知乎登录页 URL → true', () => {
    expect(isLoginError('https://www.zhihu.com/signin')).toBe(true);
    expect(isLoginError('https://www.zhihu.com/signup?next=/')).toBe(true);
    expect(isLoginError('https://passport.zhihu.com/login')).toBe(true);
    expect(isLoginError('https://zhihu.com/login?redirect=xxx')).toBe(true);
  });

  test('正常知乎页面 → false', () => {
    expect(isLoginError('https://zhuanlan.zhihu.com/write')).toBe(false);
    expect(isLoginError('https://zhuanlan.zhihu.com/p/12345678')).toBe(false);
    expect(isLoginError('https://www.zhihu.com/')).toBe(false);
    expect(isLoginError('https://www.zhihu.com/creator')).toBe(false);
  });
});

// ============================================================
// parseZhihuResponse
// ============================================================

describe('parseZhihuResponse', () => {
  test('HTTP 4xx → ok=false', () => {
    const r = parseZhihuResponse(403, '{"error":{"message":"禁止访问"}}');
    expect(r.ok).toBe(false);
    expect(r.errorMsg).toMatch(/403/);
  });

  test('HTTP 401 → ok=false', () => {
    const r = parseZhihuResponse(401, '{"error":{"message":"未登录"}}');
    expect(r.ok).toBe(false);
    expect(r.articleId).toBe(null);
  });

  test('成功响应含 id → ok=true, articleId 提取', () => {
    const r = parseZhihuResponse(200, '{"id":12345678,"title":"测试文章"}');
    expect(r.ok).toBe(true);
    expect(r.articleId).toBe('12345678');
    expect(r.errorMsg).toBe(null);
  });

  test('响应含 error 字段 → ok=false', () => {
    const r = parseZhihuResponse(200, '{"error":{"message":"发布频率限制"}}');
    expect(r.ok).toBe(false);
    expect(r.errorMsg).toMatch(/发布频率/);
  });

  test('非 JSON 响应 → ok=false', () => {
    const r = parseZhihuResponse(200, 'not json');
    expect(r.ok).toBe(false);
    expect(r.errorMsg).toMatch(/响应解析失败/);
  });

  test('空 id → articleId=null', () => {
    const r = parseZhihuResponse(200, '{"title":"test"}');
    expect(r.ok).toBe(true);
    expect(r.articleId).toBe(null);
  });
});

// ============================================================
// textToZhihuHtml
// ============================================================

describe('textToZhihuHtml', () => {
  test('空/非字符串 → <p></p>', () => {
    expect(textToZhihuHtml(null)).toBe('<p></p>');
    expect(textToZhihuHtml(undefined)).toBe('<p></p>');
    expect(textToZhihuHtml('')).toBe('<p></p>');
  });

  test('已含 HTML 标签 → 直接返回', () => {
    const html = '<p>已有HTML</p>';
    expect(textToZhihuHtml(html)).toBe(html);
  });

  test('纯文本 → 包装成 <p>', () => {
    const result = textToZhihuHtml('第一段\n\n第二段');
    expect(result).toMatch(/<p>第一段<\/p>/);
    expect(result).toMatch(/<p>第二段<\/p>/);
  });

  test('单行文本内换行 → <br/>', () => {
    const result = textToZhihuHtml('第一行\n第二行');
    expect(result).toMatch(/第一行<br\/>第二行/);
  });
});

// ============================================================
// findCoverImage
// ============================================================

describe('findCoverImage', () => {
  test('目录无封面图 → null', () => {
    const mockFs = { existsSync: () => false };
    expect(findCoverImage('/some/dir', mockFs)).toBe(null);
  });

  test('找到 cover.jpg → 返回路径', () => {
    const mockFs = { existsSync: p => p.endsWith('cover.jpg') };
    const result = findCoverImage('/some/dir', mockFs);
    expect(result).toBe(path.join('/some/dir', 'cover.jpg'));
  });

  test('找到 cover.jpeg（jpg 不存在）→ 返回路径', () => {
    const mockFs = { existsSync: p => p.endsWith('cover.jpeg') };
    const result = findCoverImage('/some/dir', mockFs);
    expect(result).toBe(path.join('/some/dir', 'cover.jpeg'));
  });

  test('找到 cover.png（jpg/jpeg 不存在）→ 返回路径', () => {
    const mockFs = { existsSync: p => p.endsWith('cover.png') };
    const result = findCoverImage('/some/dir', mockFs);
    expect(result).toBe(path.join('/some/dir', 'cover.png'));
  });
});
