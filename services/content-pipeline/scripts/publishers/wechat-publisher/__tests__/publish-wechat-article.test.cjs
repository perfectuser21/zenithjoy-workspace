'use strict';
/**
 * 微信公众号发布器单元测试
 *
 * 测试范围：纯函数（无网络、无凭据依赖）
 *
 * 运行：
 *   node --test packages/workflows/skills/wechat-publisher/scripts/__tests__/publish-wechat-article.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseEnvFile,
  isTokenCacheValid,
  buildTokenCache,
  textToHtml,
  uploadInlineImages,
} = require('../publish-wechat-article.cjs');

// ============================================================
// parseEnvFile
// ============================================================
describe('parseEnvFile', () => {
  test('空字符串 → 空对象', () => {
    assert.deepEqual(parseEnvFile(''), {});
  });

  test('null → 空对象', () => {
    assert.deepEqual(parseEnvFile(null), {});
  });

  test('注释行被忽略', () => {
    const result = parseEnvFile('# 这是注释\nWECHAT_APPID=wx123');
    assert.equal(result.WECHAT_APPID, 'wx123');
    assert.equal(Object.keys(result).length, 1);
  });

  test('简单 key=value', () => {
    const result = parseEnvFile('WECHAT_APPID=wxabc123\nWECHAT_APPSECRET=secret456');
    assert.equal(result.WECHAT_APPID, 'wxabc123');
    assert.equal(result.WECHAT_APPSECRET, 'secret456');
  });

  test('带引号的值 → 去除引号', () => {
    const result = parseEnvFile('KEY="quoted_value"\nKEY2=\'single_quoted\'');
    assert.equal(result.KEY, 'quoted_value');
    assert.equal(result.KEY2, 'single_quoted');
  });

  test('空行被跳过', () => {
    const result = parseEnvFile('\n\nKEY=val\n\n');
    assert.equal(result.KEY, 'val');
    assert.equal(Object.keys(result).length, 1);
  });

  test('等号在值中保留', () => {
    const result = parseEnvFile('KEY=a=b=c');
    assert.equal(result.KEY, 'a=b=c');
  });
});

// ============================================================
// isTokenCacheValid
// ============================================================
describe('isTokenCacheValid', () => {
  const NOW = 1700000000000; // 固定时间戳
  const MARGIN_MS = 300 * 1000;

  test('null → false', () => {
    assert.equal(isTokenCacheValid(null, NOW), false);
  });

  test('无 access_token → false', () => {
    assert.equal(isTokenCacheValid({ expires_at: NOW + 10000 }, NOW), false);
  });

  test('access_token 为空字符串 → false', () => {
    assert.equal(isTokenCacheValid({ access_token: '', expires_at: NOW + 10000 }, NOW), false);
  });

  test('无 expires_at → false', () => {
    assert.equal(isTokenCacheValid({ access_token: 'token123' }, NOW), false);
  });

  test('Token 剩余 1 小时 → true（有效）', () => {
    const cache = { access_token: 'token123', expires_at: NOW + 3600 * 1000 };
    assert.equal(isTokenCacheValid(cache, NOW), true);
  });

  test('Token 剩余 4 分钟（< 5 分钟阈值）→ false（即将过期）', () => {
    const cache = { access_token: 'token123', expires_at: NOW + 4 * 60 * 1000 };
    assert.equal(isTokenCacheValid(cache, NOW), false);
  });

  test('Token 剩余恰好 5 分钟 → false（边界，不满足 >）', () => {
    const cache = { access_token: 'token123', expires_at: NOW + MARGIN_MS };
    assert.equal(isTokenCacheValid(cache, NOW), false);
  });

  test('Token 剩余 5 分钟 + 1ms → true', () => {
    const cache = { access_token: 'token123', expires_at: NOW + MARGIN_MS + 1 };
    assert.equal(isTokenCacheValid(cache, NOW), true);
  });

  test('Token 已过期 → false', () => {
    const cache = { access_token: 'token123', expires_at: NOW - 1000 };
    assert.equal(isTokenCacheValid(cache, NOW), false);
  });
});

// ============================================================
// buildTokenCache
// ============================================================
describe('buildTokenCache', () => {
  const NOW = 1700000000000;

  test('正确计算 expires_at（7200s）', () => {
    const cache = buildTokenCache('mytoken', 7200, NOW);
    assert.equal(cache.access_token, 'mytoken');
    assert.equal(cache.expires_at, NOW + 7200 * 1000);
    assert.equal(cache.obtained_at, NOW);
  });

  test('正确计算 expires_at（3600s）', () => {
    const cache = buildTokenCache('abc', 3600, NOW);
    assert.equal(cache.expires_at, NOW + 3600 * 1000);
  });

  test('建好后立刻有效（7200s）', () => {
    const cache = buildTokenCache('token', 7200, NOW);
    assert.equal(isTokenCacheValid(cache, NOW), true);
  });

  test('构建后接近过期时间无效', () => {
    const cache = buildTokenCache('token', 300, NOW); // 只有 5 分钟有效期
    // 恰好等于阈值 300s，边界无效
    assert.equal(isTokenCacheValid(cache, NOW), false);
  });
});

// ============================================================
// textToHtml
// ============================================================
describe('textToHtml', () => {
  test('空字符串 → 空字符串', () => {
    assert.equal(textToHtml(''), '');
  });

  test('null → 空字符串', () => {
    assert.equal(textToHtml(null), '');
  });

  test('单行文本 → 单个 <p>', () => {
    const html = textToHtml('你好世界');
    assert.equal(html, '<p>你好世界</p>');
  });

  test('多行文本 → 多个 <p>', () => {
    const html = textToHtml('第一行\n第二行');
    assert.ok(html.includes('<p>第一行</p>'));
    assert.ok(html.includes('<p>第二行</p>'));
  });

  test('空行 → <p><br/></p>', () => {
    const html = textToHtml('文字\n\n文字2');
    assert.ok(html.includes('<p><br/></p>'));
  });

  test('HTML 特殊字符被转义', () => {
    const html = textToHtml('<b>A&B</b>');
    assert.ok(!html.includes('<b>'));
    assert.ok(html.includes('&lt;b&gt;'));
    assert.ok(html.includes('&amp;'));
  });

  test('& 符号被转义', () => {
    const html = textToHtml('A & B');
    assert.ok(html.includes('A &amp; B'));
  });
});

// ============================================================
// uploadInlineImages
// ============================================================
describe('uploadInlineImages', () => {
  test('null html → 原样返回', async () => {
    const result = await uploadInlineImages(null, 'fake-token');
    assert.equal(result, null);
  });

  test('无 <img> 标签的 HTML → 原样返回', async () => {
    const html = '<p>纯文字段落，无图片。</p>';
    const result = await uploadInlineImages(html, 'fake-token');
    assert.equal(result, html);
  });

  test('外链图片（https://）→ 不处理，原样保留', async () => {
    const html = '<p>文字</p><img src="https://example.com/img.jpg"><p>后文</p>';
    const result = await uploadInlineImages(html, 'fake-token');
    assert.equal(result, html);
  });

  test('外链图片（http://）→ 不处理，原样保留', async () => {
    const html = '<img src="http://cdn.example.com/photo.png">';
    const result = await uploadInlineImages(html, 'fake-token');
    assert.equal(result, html);
  });

  test('本地图片不存在 → 打印警告，保留原 src，不 throw', async () => {
    const html = '<img src="/tmp/non-existent-image-xyz.jpg">';
    const result = await uploadInlineImages(html, 'fake-token');
    assert.ok(result.includes('/tmp/non-existent-image-xyz.jpg'), '应保留原 src');
  });

  test('多个外链图片全部跳过', async () => {
    const html = '<img src="https://a.com/1.jpg"><img src="https://b.com/2.png">';
    const result = await uploadInlineImages(html, 'fake-token');
    assert.equal(result, html);
  });
});
