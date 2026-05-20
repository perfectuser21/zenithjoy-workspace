'use strict';
/**
 * 微博新 API 发布器单元测试
 *
 * 测试范围：纯函数（无网络、无 CDP 依赖）
 *
 * 运行：node --test packages/workflows/skills/weibo-publisher/scripts/__tests__/publish-weibo-api.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCookieHeader,
  getCookieValue,
  isRateLimit,
  isLoginError,
  buildPicUploadForm,
} = require('../publish-weibo-api.cjs');

// ============================================================
// parseCookieHeader
// ============================================================
describe('parseCookieHeader', () => {
  test('空数组 → 空 cookieHeader 和 null xsrfToken', () => {
    const result = parseCookieHeader([]);
    assert.equal(result.cookieHeader, '');
    assert.equal(result.xsrfToken, null);
  });

  test('null → 空 cookieHeader 和 null xsrfToken', () => {
    const result = parseCookieHeader(null);
    assert.equal(result.cookieHeader, '');
    assert.equal(result.xsrfToken, null);
  });

  test('单个 cookie → 正确的 header 字符串', () => {
    const cookies = [{ name: 'SUB', value: 'abc123' }];
    const { cookieHeader } = parseCookieHeader(cookies);
    assert.equal(cookieHeader, 'SUB=abc123');
  });

  test('多个 cookie → 用分号和空格连接', () => {
    const cookies = [
      { name: 'SUB', value: 'abc' },
      { name: 'SUBP', value: 'xyz' },
      { name: 'SSOLoginState', value: '12345' },
    ];
    const { cookieHeader } = parseCookieHeader(cookies);
    assert.equal(cookieHeader, 'SUB=abc; SUBP=xyz; SSOLoginState=12345');
  });

  test('XSRF-TOKEN 被提取为 xsrfToken', () => {
    const cookies = [
      { name: 'SUB', value: 'abc' },
      { name: 'XSRF-TOKEN', value: 'token123' },
    ];
    const { xsrfToken } = parseCookieHeader(cookies);
    assert.equal(xsrfToken, 'token123');
  });

  test('xsrf-token（小写）也被提取', () => {
    const cookies = [{ name: 'xsrf-token', value: 'mytoken' }];
    const { xsrfToken } = parseCookieHeader(cookies);
    assert.equal(xsrfToken, 'mytoken');
  });

  test('_xsrf 也被提取', () => {
    const cookies = [{ name: '_xsrf', value: 'secret' }];
    const { xsrfToken } = parseCookieHeader(cookies);
    assert.equal(xsrfToken, 'secret');
  });

  test('没有 XSRF Cookie 时 xsrfToken 为 null', () => {
    const cookies = [{ name: 'SUB', value: 'abc' }];
    const { xsrfToken } = parseCookieHeader(cookies);
    assert.equal(xsrfToken, null);
  });
});

// ============================================================
// getCookieValue
// ============================================================
describe('getCookieValue', () => {
  test('提取存在的 cookie 值', () => {
    const header = 'SUB=abc123; SUBP=xyz';
    assert.equal(getCookieValue(header, 'SUB'), 'abc123');
    assert.equal(getCookieValue(header, 'SUBP'), 'xyz');
  });

  test('不存在的 cookie 名 → null', () => {
    const header = 'SUB=abc; SUBP=xyz';
    assert.equal(getCookieValue(header, 'OTHER'), null);
  });

  test('空 header → null', () => {
    assert.equal(getCookieValue('', 'SUB'), null);
    assert.equal(getCookieValue(null, 'SUB'), null);
  });
});

// ============================================================
// isRateLimit
// ============================================================
describe('isRateLimit', () => {
  test('发帖太频繁 → true', () => {
    assert.equal(isRateLimit('{"error":"发帖太频繁，请稍后再试"}'), true);
  });

  test('操作太频繁 → true', () => {
    assert.equal(isRateLimit('操作太频繁，请稍后再试'), true);
  });

  test('操作过于频繁 → true', () => {
    assert.equal(isRateLimit('您的操作过于频繁'), true);
  });

  test('频率限制 → true', () => {
    assert.equal(isRateLimit('触发频率限制'), true);
  });

  test('限制发言 → true', () => {
    assert.equal(isRateLimit('该账号已被限制发言'), true);
  });

  test('rate limit（英文）→ true', () => {
    assert.equal(isRateLimit('rate limit exceeded'), true);
  });

  test('正常成功响应 → false', () => {
    assert.equal(isRateLimit('{"ok":1,"data":{"id":"12345"}}'), false);
  });

  test('空字符串 → false', () => {
    assert.equal(isRateLimit(''), false);
  });

  test('null → false', () => {
    assert.equal(isRateLimit(null), false);
  });
});

// ============================================================
// isLoginError
// ============================================================
describe('isLoginError', () => {
  test('HTTP 401 → true', () => {
    assert.equal(isLoginError(401, ''), true);
  });

  test('HTTP 403 → true', () => {
    assert.equal(isLoginError(403, ''), true);
  });

  test('未登录关键词 → true', () => {
    assert.equal(isLoginError(200, '{"error":"未登录，请先登录"}'), true);
  });

  test('请登录关键词 → true', () => {
    assert.equal(isLoginError(200, '请登录后操作'), true);
  });

  test('登录失效 → true', () => {
    assert.equal(isLoginError(200, '登录失效，请重新登录'), true);
  });

  test('login required（英文）→ true', () => {
    assert.equal(isLoginError(200, 'login required'), true);
  });

  test('正常 200 + 无错误关键词 → false', () => {
    assert.equal(isLoginError(200, '{"ok":1}'), false);
  });

  test('HTTP 500 + 无登录错误 → false', () => {
    assert.equal(isLoginError(500, 'Internal Server Error'), false);
  });

  test('null body → 仅看状态码', () => {
    assert.equal(isLoginError(200, null), false);
    assert.equal(isLoginError(403, null), true);
  });
});

// ============================================================
// buildPicUploadForm
// ============================================================
describe('buildPicUploadForm', () => {
  const testImageBuffer = Buffer.from('fake-image-data');
  const boundary = 'TestBoundary123';

  test('返回 Buffer 类型', () => {
    const result = buildPicUploadForm(testImageBuffer, 'test.jpg', boundary);
    assert.ok(Buffer.isBuffer(result));
  });

  test('包含 boundary 分隔符', () => {
    const result = buildPicUploadForm(testImageBuffer, 'test.jpg', boundary);
    const body = result.toString();
    assert.ok(body.includes(`--${boundary}`));
    assert.ok(body.includes(`--${boundary}--`));
  });

  test('包含文件名', () => {
    const result = buildPicUploadForm(testImageBuffer, 'photo.jpg', boundary);
    const body = result.toString();
    assert.ok(body.includes('photo.jpg'));
  });

  test('.jpg 使用 image/jpeg Content-Type', () => {
    const result = buildPicUploadForm(testImageBuffer, 'photo.jpg', boundary);
    const body = result.toString();
    assert.ok(body.includes('image/jpeg'));
  });

  test('.png 使用 image/png Content-Type', () => {
    const result = buildPicUploadForm(testImageBuffer, 'photo.png', boundary);
    const body = result.toString();
    assert.ok(body.includes('image/png'));
  });

  test('.gif 使用 image/gif Content-Type', () => {
    const result = buildPicUploadForm(testImageBuffer, 'image.gif', boundary);
    const body = result.toString();
    assert.ok(body.includes('image/gif'));
  });

  test('未知扩展名 fallback 到 image/jpeg', () => {
    const result = buildPicUploadForm(testImageBuffer, 'photo.bmp', boundary);
    const body = result.toString();
    assert.ok(body.includes('image/jpeg'));
  });

  test('包含必要的表单字段（encoded, mark, ori, pid, type）', () => {
    const result = buildPicUploadForm(testImageBuffer, 'test.jpg', boundary);
    const body = result.toString();
    assert.ok(body.includes('name="encoded"'));
    assert.ok(body.includes('name="mark"'));
    assert.ok(body.includes('name="ori"'));
    assert.ok(body.includes('name="pid"'));
    assert.ok(body.includes('name="type"'));
  });

  test('包含图片二进制数据', () => {
    const result = buildPicUploadForm(testImageBuffer, 'test.jpg', boundary);
    assert.ok(result.includes(testImageBuffer));
  });

  test('不同 boundary 生成不同结果', () => {
    const r1 = buildPicUploadForm(testImageBuffer, 'test.jpg', 'boundary1');
    const r2 = buildPicUploadForm(testImageBuffer, 'test.jpg', 'boundary2');
    assert.notDeepEqual(r1, r2);
  });
});
