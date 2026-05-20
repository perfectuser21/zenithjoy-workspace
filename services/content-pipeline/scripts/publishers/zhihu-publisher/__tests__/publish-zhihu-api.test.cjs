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

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
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
    assert.equal(isLoginError(null), false);
    assert.equal(isLoginError(undefined), false);
    assert.equal(isLoginError(123), false);
    assert.equal(isLoginError(''), false);
  });

  test('知乎登录页 URL → true', () => {
    assert.equal(isLoginError('https://www.zhihu.com/signin'), true);
    assert.equal(isLoginError('https://www.zhihu.com/signup?next=/'), true);
    assert.equal(isLoginError('https://passport.zhihu.com/login'), true);
    assert.equal(isLoginError('https://zhihu.com/login?redirect=xxx'), true);
  });

  test('正常知乎页面 → false', () => {
    assert.equal(isLoginError('https://zhuanlan.zhihu.com/write'), false);
    assert.equal(isLoginError('https://zhuanlan.zhihu.com/p/12345678'), false);
    assert.equal(isLoginError('https://www.zhihu.com/'), false);
    assert.equal(isLoginError('https://www.zhihu.com/creator'), false);
  });
});

// ============================================================
// parseZhihuResponse
// ============================================================

describe('parseZhihuResponse', () => {
  test('HTTP 4xx → ok=false', () => {
    const r = parseZhihuResponse(403, '{"error":{"message":"禁止访问"}}');
    assert.equal(r.ok, false);
    assert.match(r.errorMsg, /403/);
  });

  test('HTTP 401 → ok=false', () => {
    const r = parseZhihuResponse(401, '{"error":{"message":"未登录"}}');
    assert.equal(r.ok, false);
    assert.equal(r.articleId, null);
  });

  test('成功响应含 id → ok=true, articleId 提取', () => {
    const r = parseZhihuResponse(200, '{"id":12345678,"title":"测试文章"}');
    assert.equal(r.ok, true);
    assert.equal(r.articleId, '12345678');
    assert.equal(r.errorMsg, null);
  });

  test('响应含 error 字段 → ok=false', () => {
    const r = parseZhihuResponse(200, '{"error":{"message":"发布频率限制"}}');
    assert.equal(r.ok, false);
    assert.match(r.errorMsg, /发布频率/);
  });

  test('非 JSON 响应 → ok=false', () => {
    const r = parseZhihuResponse(200, 'not json');
    assert.equal(r.ok, false);
    assert.match(r.errorMsg, /响应解析失败/);
  });

  test('空 id → articleId=null', () => {
    const r = parseZhihuResponse(200, '{"title":"test"}');
    assert.equal(r.ok, true);
    assert.equal(r.articleId, null);
  });
});

// ============================================================
// textToZhihuHtml
// ============================================================

describe('textToZhihuHtml', () => {
  test('空/非字符串 → <p></p>', () => {
    assert.equal(textToZhihuHtml(null), '<p></p>');
    assert.equal(textToZhihuHtml(undefined), '<p></p>');
    assert.equal(textToZhihuHtml(''), '<p></p>');
  });

  test('已含 HTML 标签 → 直接返回', () => {
    const html = '<p>已有HTML</p>';
    assert.equal(textToZhihuHtml(html), html);
  });

  test('纯文本 → 包装成 <p>', () => {
    const result = textToZhihuHtml('第一段\n\n第二段');
    assert.match(result, /<p>第一段<\/p>/);
    assert.match(result, /<p>第二段<\/p>/);
  });

  test('单行文本内换行 → <br/>', () => {
    const result = textToZhihuHtml('第一行\n第二行');
    assert.match(result, /第一行<br\/>第二行/);
  });
});

// ============================================================
// findCoverImage
// ============================================================

describe('findCoverImage', () => {
  test('目录无封面图 → null', () => {
    const mockFs = { existsSync: () => false };
    assert.equal(findCoverImage('/some/dir', mockFs), null);
  });

  test('找到 cover.jpg → 返回路径', () => {
    const mockFs = { existsSync: p => p.endsWith('cover.jpg') };
    const result = findCoverImage('/some/dir', mockFs);
    assert.equal(result, path.join('/some/dir', 'cover.jpg'));
  });

  test('找到 cover.jpeg（jpg 不存在）→ 返回路径', () => {
    const mockFs = { existsSync: p => p.endsWith('cover.jpeg') };
    const result = findCoverImage('/some/dir', mockFs);
    assert.equal(result, path.join('/some/dir', 'cover.jpeg'));
  });

  test('找到 cover.png（jpg/jpeg 不存在）→ 返回路径', () => {
    const mockFs = { existsSync: p => p.endsWith('cover.png') };
    const result = findCoverImage('/some/dir', mockFs);
    assert.equal(result, path.join('/some/dir', 'cover.png'));
  });
});
