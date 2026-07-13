'use strict';
/**
 * 微博新 API 发布器单元测试
 *
 * 测试范围：纯函数（无网络、无 CDP 依赖）
 *
 * 运行：npx vitest run publishers/weibo-publisher
 */

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
    expect(result.cookieHeader).toBe('');
    expect(result.xsrfToken).toBe(null);
  });

  test('null → 空 cookieHeader 和 null xsrfToken', () => {
    const result = parseCookieHeader(null);
    expect(result.cookieHeader).toBe('');
    expect(result.xsrfToken).toBe(null);
  });

  test('单个 cookie → 正确的 header 字符串', () => {
    const cookies = [{ name: 'SUB', value: 'abc123' }];
    const { cookieHeader } = parseCookieHeader(cookies);
    expect(cookieHeader).toBe('SUB=abc123');
  });

  test('多个 cookie → 用分号和空格连接', () => {
    const cookies = [
      { name: 'SUB', value: 'abc' },
      { name: 'SUBP', value: 'xyz' },
      { name: 'SSOLoginState', value: '12345' },
    ];
    const { cookieHeader } = parseCookieHeader(cookies);
    expect(cookieHeader).toBe('SUB=abc; SUBP=xyz; SSOLoginState=12345');
  });

  test('XSRF-TOKEN 被提取为 xsrfToken', () => {
    const cookies = [
      { name: 'SUB', value: 'abc' },
      { name: 'XSRF-TOKEN', value: 'token123' },
    ];
    const { xsrfToken } = parseCookieHeader(cookies);
    expect(xsrfToken).toBe('token123');
  });

  test('xsrf-token（小写）也被提取', () => {
    const cookies = [{ name: 'xsrf-token', value: 'mytoken' }];
    const { xsrfToken } = parseCookieHeader(cookies);
    expect(xsrfToken).toBe('mytoken');
  });

  test('_xsrf 也被提取', () => {
    const cookies = [{ name: '_xsrf', value: 'secret' }];
    const { xsrfToken } = parseCookieHeader(cookies);
    expect(xsrfToken).toBe('secret');
  });

  test('没有 XSRF Cookie 时 xsrfToken 为 null', () => {
    const cookies = [{ name: 'SUB', value: 'abc' }];
    const { xsrfToken } = parseCookieHeader(cookies);
    expect(xsrfToken).toBe(null);
  });
});

// ============================================================
// getCookieValue
// ============================================================
describe('getCookieValue', () => {
  test('提取存在的 cookie 值', () => {
    const header = 'SUB=abc123; SUBP=xyz';
    expect(getCookieValue(header, 'SUB')).toBe('abc123');
    expect(getCookieValue(header, 'SUBP')).toBe('xyz');
  });

  test('不存在的 cookie 名 → null', () => {
    const header = 'SUB=abc; SUBP=xyz';
    expect(getCookieValue(header, 'OTHER')).toBe(null);
  });

  test('空 header → null', () => {
    expect(getCookieValue('', 'SUB')).toBe(null);
    expect(getCookieValue(null, 'SUB')).toBe(null);
  });
});

// ============================================================
// isRateLimit
// ============================================================
describe('isRateLimit', () => {
  test('发帖太频繁 → true', () => {
    expect(isRateLimit('{"error":"发帖太频繁，请稍后再试"}')).toBe(true);
  });

  test('操作太频繁 → true', () => {
    expect(isRateLimit('操作太频繁，请稍后再试')).toBe(true);
  });

  test('操作过于频繁 → true', () => {
    expect(isRateLimit('您的操作过于频繁')).toBe(true);
  });

  test('频率限制 → true', () => {
    expect(isRateLimit('触发频率限制')).toBe(true);
  });

  test('限制发言 → true', () => {
    expect(isRateLimit('该账号已被限制发言')).toBe(true);
  });

  test('rate limit（英文）→ true', () => {
    expect(isRateLimit('rate limit exceeded')).toBe(true);
  });

  test('正常成功响应 → false', () => {
    expect(isRateLimit('{"ok":1,"data":{"id":"12345"}}')).toBe(false);
  });

  test('空字符串 → false', () => {
    expect(isRateLimit('')).toBe(false);
  });

  test('null → false', () => {
    expect(isRateLimit(null)).toBe(false);
  });
});

// ============================================================
// isLoginError
// ============================================================
describe('isLoginError', () => {
  test('HTTP 401 → true', () => {
    expect(isLoginError(401, '')).toBe(true);
  });

  test('HTTP 403 → true', () => {
    expect(isLoginError(403, '')).toBe(true);
  });

  test('未登录关键词 → true', () => {
    expect(isLoginError(200, '{"error":"未登录，请先登录"}')).toBe(true);
  });

  test('请登录关键词 → true', () => {
    expect(isLoginError(200, '请登录后操作')).toBe(true);
  });

  test('登录失效 → true', () => {
    expect(isLoginError(200, '登录失效，请重新登录')).toBe(true);
  });

  test('login required（英文）→ true', () => {
    expect(isLoginError(200, 'login required')).toBe(true);
  });

  test('正常 200 + 无错误关键词 → false', () => {
    expect(isLoginError(200, '{"ok":1}')).toBe(false);
  });

  test('HTTP 500 + 无登录错误 → false', () => {
    expect(isLoginError(500, 'Internal Server Error')).toBe(false);
  });

  test('null body → 仅看状态码', () => {
    expect(isLoginError(200, null)).toBe(false);
    expect(isLoginError(403, null)).toBe(true);
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
    expect(Buffer.isBuffer(result)).toBeTruthy();
  });

  test('包含 boundary 分隔符', () => {
    const result = buildPicUploadForm(testImageBuffer, 'test.jpg', boundary);
    const body = result.toString();
    expect(body.includes(`--${boundary}`)).toBeTruthy();
    expect(body.includes(`--${boundary}--`)).toBeTruthy();
  });

  test('包含文件名', () => {
    const result = buildPicUploadForm(testImageBuffer, 'photo.jpg', boundary);
    const body = result.toString();
    expect(body.includes('photo.jpg')).toBeTruthy();
  });

  test('.jpg 使用 image/jpeg Content-Type', () => {
    const result = buildPicUploadForm(testImageBuffer, 'photo.jpg', boundary);
    const body = result.toString();
    expect(body.includes('image/jpeg')).toBeTruthy();
  });

  test('.png 使用 image/png Content-Type', () => {
    const result = buildPicUploadForm(testImageBuffer, 'photo.png', boundary);
    const body = result.toString();
    expect(body.includes('image/png')).toBeTruthy();
  });

  test('.gif 使用 image/gif Content-Type', () => {
    const result = buildPicUploadForm(testImageBuffer, 'image.gif', boundary);
    const body = result.toString();
    expect(body.includes('image/gif')).toBeTruthy();
  });

  test('未知扩展名 fallback 到 image/jpeg', () => {
    const result = buildPicUploadForm(testImageBuffer, 'photo.bmp', boundary);
    const body = result.toString();
    expect(body.includes('image/jpeg')).toBeTruthy();
  });

  test('包含必要的表单字段（encoded, mark, ori, pid, type）', () => {
    const result = buildPicUploadForm(testImageBuffer, 'test.jpg', boundary);
    const body = result.toString();
    expect(body.includes('name="encoded"')).toBeTruthy();
    expect(body.includes('name="mark"')).toBeTruthy();
    expect(body.includes('name="ori"')).toBeTruthy();
    expect(body.includes('name="pid"')).toBeTruthy();
    expect(body.includes('name="type"')).toBeTruthy();
  });

  test('包含图片二进制数据', () => {
    const result = buildPicUploadForm(testImageBuffer, 'test.jpg', boundary);
    expect(result.includes(testImageBuffer)).toBeTruthy();
  });

  test('不同 boundary 生成不同结果', () => {
    const r1 = buildPicUploadForm(testImageBuffer, 'test.jpg', 'boundary1');
    const r2 = buildPicUploadForm(testImageBuffer, 'test.jpg', 'boundary2');
    expect(r1).not.toEqual(r2);
  });
});
