'use strict';
/**
 * 快手新 API 发布器单元测试
 *
 * 测试范围：纯函数（无网络、无 CDP 依赖）
 *
 * 运行：npx vitest run publishers/kuaishou-publisher
 */

const path = require('path');

const {
  parseCookieHeader,
  isSessionValid,
  isLoginError,
  isRateLimit,
  buildImageUploadForm,
  parseKuaishouResponse,
} = require('../publish-kuaishou-api.cjs');

// ============================================================
// parseCookieHeader
// ============================================================
describe('parseCookieHeader', () => {
  test('空数组 → 空 cookieHeader、null sessionToken 和 null userId', () => {
    const result = parseCookieHeader([]);
    expect(result.cookieHeader).toBe('');
    expect(result.sessionToken).toBe(null);
    expect(result.userId).toBe(null);
  });

  test('null → 空 cookieHeader', () => {
    const result = parseCookieHeader(null);
    expect(result.cookieHeader).toBe('');
    expect(result.sessionToken).toBe(null);
  });

  test('单个 cookie → 正确的 header 字符串', () => {
    const cookies = [{ name: 'kuaishou.web.cp.api_st', value: 'abc123' }];
    const { cookieHeader } = parseCookieHeader(cookies);
    expect(cookieHeader).toBe('kuaishou.web.cp.api_st=abc123');
  });

  test('多个 cookie → 用分号空格连接', () => {
    const cookies = [
      { name: 'kuaishou.web.cp.api_st', value: 'st123' },
      { name: 'userId', value: '456' },
      { name: 'did', value: 'device789' },
    ];
    const { cookieHeader } = parseCookieHeader(cookies);
    expect(cookieHeader).toBe(
      'kuaishou.web.cp.api_st=st123; userId=456; did=device789'
    );
  });

  test('kuaishou.web.cp.api_st 被提取为 sessionToken', () => {
    const cookies = [
      { name: 'userId', value: 'user1' },
      { name: 'kuaishou.web.cp.api_st', value: 'st_token' },
    ];
    const { sessionToken } = parseCookieHeader(cookies);
    expect(sessionToken).toBe('st_token');
  });

  test('kuaishou.web.cp.api_ph 也被提取为 sessionToken', () => {
    const cookies = [{ name: 'kuaishou.web.cp.api_ph', value: 'ph_token' }];
    const { sessionToken } = parseCookieHeader(cookies);
    expect(sessionToken).toBe('ph_token');
  });

  test('userId 被提取', () => {
    const cookies = [
      { name: 'kuaishou.web.cp.api_st', value: 'token' },
      { name: 'userId', value: '12345' },
    ];
    const { userId } = parseCookieHeader(cookies);
    expect(userId).toBe('12345');
  });

  test('无会话 Token 时 sessionToken 为 null', () => {
    const cookies = [{ name: 'did', value: 'device123' }];
    const { sessionToken } = parseCookieHeader(cookies);
    expect(sessionToken).toBe(null);
  });

  test('无 userId 时 userId 为 null', () => {
    const cookies = [{ name: 'kuaishou.web.cp.api_st', value: 'token' }];
    const { userId } = parseCookieHeader(cookies);
    expect(userId).toBe(null);
  });
});

// ============================================================
// isSessionValid
// ============================================================
describe('isSessionValid', () => {
  test('空数组 → false', () => {
    expect(isSessionValid([])).toBe(false);
  });

  test('null → false', () => {
    expect(isSessionValid(null)).toBe(false);
  });

  test('含 kuaishou.web.cp.api_st → true', () => {
    const cookies = [{ name: 'kuaishou.web.cp.api_st', value: 'abc' }];
    expect(isSessionValid(cookies)).toBe(true);
  });

  test('含 kuaishou.web.cp.api_ph → true', () => {
    const cookies = [{ name: 'kuaishou.web.cp.api_ph', value: 'xyz' }];
    expect(isSessionValid(cookies)).toBe(true);
  });

  test('不含会话 Cookie → false', () => {
    const cookies = [
      { name: 'did', value: 'device' },
      { name: 'userId', value: '123' },
    ];
    expect(isSessionValid(cookies)).toBe(false);
  });

  test('同时含 _st 和 _ph → true', () => {
    const cookies = [
      { name: 'kuaishou.web.cp.api_st', value: 'st' },
      { name: 'kuaishou.web.cp.api_ph', value: 'ph' },
    ];
    expect(isSessionValid(cookies)).toBe(true);
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

  test('HTTP 200 正常响应 → false', () => {
    expect(isLoginError(200, '{"result":1}')).toBe(false);
  });

  test('body 含"未登录" → true', () => {
    expect(isLoginError(200, '{"message":"未登录，请先登录"}')).toBe(true);
  });

  test('body 含"请登录" → true', () => {
    expect(isLoginError(200, '操作失败，请登录后重试')).toBe(true);
  });

  test('body 含"登录失效" → true', () => {
    expect(isLoginError(200, '登录失效，请重新登录')).toBe(true);
  });

  test('body 含"session expired"（大小写不敏感） → true', () => {
    expect(isLoginError(200, 'Session Expired, please re-login')).toBe(true);
  });

  test('null body → false', () => {
    expect(isLoginError(200, null)).toBe(false);
  });
});

// ============================================================
// isRateLimit
// ============================================================
describe('isRateLimit', () => {
  test('body 含"操作频繁" → true', () => {
    expect(isRateLimit('操作频繁，请稍后再试')).toBe(true);
  });

  test('body 含"频率限制" → true', () => {
    expect(isRateLimit('频率限制，请稍后重试')).toBe(true);
  });

  test('body 含"too frequent" → true', () => {
    expect(isRateLimit('too frequent operations')).toBe(true);
  });

  test('正常响应 → false', () => {
    expect(isRateLimit('{"result":1}')).toBe(false);
  });

  test('null → false', () => {
    expect(isRateLimit(null)).toBe(false);
  });
});

// ============================================================
// buildImageUploadForm
// ============================================================
describe('buildImageUploadForm', () => {
  const fakeImage = Buffer.from('fake-image-data');
  const boundary = 'testBoundary123';

  test('返回 Buffer 类型', () => {
    const result = buildImageUploadForm(fakeImage, 'test.jpg', boundary, {});
    expect(Buffer.isBuffer(result)).toBeTruthy();
  });

  test('包含文件名和 Content-Type', () => {
    const result = buildImageUploadForm(fakeImage, 'photo.jpg', boundary, {});
    const body = result.toString();
    expect(body.includes('photo.jpg')).toBeTruthy();
    expect(body.includes('image/jpeg')).toBeTruthy();
  });

  test('png 文件 → image/png', () => {
    const result = buildImageUploadForm(fakeImage, 'photo.png', boundary, {});
    const body = result.toString();
    expect(body.includes('image/png')).toBeTruthy();
  });

  test('webp 文件 → image/webp', () => {
    const result = buildImageUploadForm(fakeImage, 'photo.webp', boundary, {});
    const body = result.toString();
    expect(body.includes('image/webp')).toBeTruthy();
  });

  test('未知扩展名 → image/jpeg（fallback）', () => {
    const result = buildImageUploadForm(fakeImage, 'photo.bmp', boundary, {});
    const body = result.toString();
    expect(body.includes('image/jpeg')).toBeTruthy();
  });

  test('extraFields 被包含到 body', () => {
    const extraFields = { token: 'mytoken123', key: 'photos/test.jpg' };
    const result = buildImageUploadForm(fakeImage, 'test.jpg', boundary, extraFields);
    const body = result.toString();
    expect(body.includes('mytoken123')).toBeTruthy();
    expect(body.includes('photos/test.jpg')).toBeTruthy();
  });

  test('无 extraFields → 只有文件部分', () => {
    const result = buildImageUploadForm(fakeImage, 'test.jpg', boundary);
    const body = result.toString();
    expect(body.includes(`--${boundary}`)).toBeTruthy();
    expect(body.includes('test.jpg')).toBeTruthy();
  });

  test('包含 boundary 结束标记', () => {
    const result = buildImageUploadForm(fakeImage, 'test.jpg', boundary, {});
    const body = result.toString();
    expect(body.includes(`--${boundary}--`)).toBeTruthy();
  });

  test('图片数据被包含', () => {
    const result = buildImageUploadForm(fakeImage, 'test.jpg', boundary, {});
    expect(result.includes(fakeImage)).toBeTruthy();
  });
});

// ============================================================
// parseKuaishouResponse
// ============================================================
describe('parseKuaishouResponse', () => {
  test('result=1 → ok=true', () => {
    const { ok } = parseKuaishouResponse('{"result":1,"data":{"photo_id":"abc"}}');
    expect(ok).toBe(true);
  });

  test('code=200 → ok=true', () => {
    const { ok } = parseKuaishouResponse('{"code":200,"data":{}}');
    expect(ok).toBe(true);
  });

  test('code="200" → ok=true', () => {
    const { ok } = parseKuaishouResponse('{"code":"200","data":{}}');
    expect(ok).toBe(true);
  });

  test('status="success" → ok=true', () => {
    const { ok } = parseKuaishouResponse('{"status":"success","data":{}}');
    expect(ok).toBe(true);
  });

  test('result=0 → ok=false，errorMsg 包含 error_msg', () => {
    const { ok, errorMsg } = parseKuaishouResponse(
      '{"result":0,"error_msg":"内容违规"}'
    );
    expect(ok).toBe(false);
    expect(errorMsg && errorMsg.includes('内容违规')).toBeTruthy();
  });

  test('result=0 fallback 到 message 字段', () => {
    const { ok, errorMsg } = parseKuaishouResponse('{"result":0,"message":"失败了"}');
    expect(ok).toBe(false);
    expect(errorMsg && errorMsg.includes('失败了')).toBeTruthy();
  });

  test('data 字段被正确提取', () => {
    const { ok, data } = parseKuaishouResponse(
      '{"result":1,"data":{"photo_id":"img123"}}'
    );
    expect(ok).toBe(true);
    expect(data.photo_id).toBe('img123');
  });

  test('JSON 解析失败 → ok=false，errorMsg 包含"响应解析失败"', () => {
    const { ok, errorMsg } = parseKuaishouResponse('not-json');
    expect(ok).toBe(false);
    expect(errorMsg && errorMsg.includes('响应解析失败')).toBeTruthy();
  });

  test('无 data 字段 → 返回整个 parsed 对象', () => {
    const { ok, data } = parseKuaishouResponse('{"result":1,"photo_id":"xyz"}');
    expect(ok).toBe(true);
    expect(data !== null && data !== undefined).toBeTruthy();
  });
});
