'use strict';
/**
 * 快手新 API 发布器单元测试
 *
 * 测试范围：纯函数（无网络、无 CDP 依赖）
 *
 * 运行：node --test packages/workflows/skills/kuaishou-publisher/scripts/__tests__/publish-kuaishou-api.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
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
    assert.equal(result.cookieHeader, '');
    assert.equal(result.sessionToken, null);
    assert.equal(result.userId, null);
  });

  test('null → 空 cookieHeader', () => {
    const result = parseCookieHeader(null);
    assert.equal(result.cookieHeader, '');
    assert.equal(result.sessionToken, null);
  });

  test('单个 cookie → 正确的 header 字符串', () => {
    const cookies = [{ name: 'kuaishou.web.cp.api_st', value: 'abc123' }];
    const { cookieHeader } = parseCookieHeader(cookies);
    assert.equal(cookieHeader, 'kuaishou.web.cp.api_st=abc123');
  });

  test('多个 cookie → 用分号空格连接', () => {
    const cookies = [
      { name: 'kuaishou.web.cp.api_st', value: 'st123' },
      { name: 'userId', value: '456' },
      { name: 'did', value: 'device789' },
    ];
    const { cookieHeader } = parseCookieHeader(cookies);
    assert.equal(
      cookieHeader,
      'kuaishou.web.cp.api_st=st123; userId=456; did=device789'
    );
  });

  test('kuaishou.web.cp.api_st 被提取为 sessionToken', () => {
    const cookies = [
      { name: 'userId', value: 'user1' },
      { name: 'kuaishou.web.cp.api_st', value: 'st_token' },
    ];
    const { sessionToken } = parseCookieHeader(cookies);
    assert.equal(sessionToken, 'st_token');
  });

  test('kuaishou.web.cp.api_ph 也被提取为 sessionToken', () => {
    const cookies = [{ name: 'kuaishou.web.cp.api_ph', value: 'ph_token' }];
    const { sessionToken } = parseCookieHeader(cookies);
    assert.equal(sessionToken, 'ph_token');
  });

  test('userId 被提取', () => {
    const cookies = [
      { name: 'kuaishou.web.cp.api_st', value: 'token' },
      { name: 'userId', value: '12345' },
    ];
    const { userId } = parseCookieHeader(cookies);
    assert.equal(userId, '12345');
  });

  test('无会话 Token 时 sessionToken 为 null', () => {
    const cookies = [{ name: 'did', value: 'device123' }];
    const { sessionToken } = parseCookieHeader(cookies);
    assert.equal(sessionToken, null);
  });

  test('无 userId 时 userId 为 null', () => {
    const cookies = [{ name: 'kuaishou.web.cp.api_st', value: 'token' }];
    const { userId } = parseCookieHeader(cookies);
    assert.equal(userId, null);
  });
});

// ============================================================
// isSessionValid
// ============================================================
describe('isSessionValid', () => {
  test('空数组 → false', () => {
    assert.equal(isSessionValid([]), false);
  });

  test('null → false', () => {
    assert.equal(isSessionValid(null), false);
  });

  test('含 kuaishou.web.cp.api_st → true', () => {
    const cookies = [{ name: 'kuaishou.web.cp.api_st', value: 'abc' }];
    assert.equal(isSessionValid(cookies), true);
  });

  test('含 kuaishou.web.cp.api_ph → true', () => {
    const cookies = [{ name: 'kuaishou.web.cp.api_ph', value: 'xyz' }];
    assert.equal(isSessionValid(cookies), true);
  });

  test('不含会话 Cookie → false', () => {
    const cookies = [
      { name: 'did', value: 'device' },
      { name: 'userId', value: '123' },
    ];
    assert.equal(isSessionValid(cookies), false);
  });

  test('同时含 _st 和 _ph → true', () => {
    const cookies = [
      { name: 'kuaishou.web.cp.api_st', value: 'st' },
      { name: 'kuaishou.web.cp.api_ph', value: 'ph' },
    ];
    assert.equal(isSessionValid(cookies), true);
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

  test('HTTP 200 正常响应 → false', () => {
    assert.equal(isLoginError(200, '{"result":1}'), false);
  });

  test('body 含"未登录" → true', () => {
    assert.equal(isLoginError(200, '{"message":"未登录，请先登录"}'), true);
  });

  test('body 含"请登录" → true', () => {
    assert.equal(isLoginError(200, '操作失败，请登录后重试'), true);
  });

  test('body 含"登录失效" → true', () => {
    assert.equal(isLoginError(200, '登录失效，请重新登录'), true);
  });

  test('body 含"session expired"（大小写不敏感） → true', () => {
    assert.equal(isLoginError(200, 'Session Expired, please re-login'), true);
  });

  test('null body → false', () => {
    assert.equal(isLoginError(200, null), false);
  });
});

// ============================================================
// isRateLimit
// ============================================================
describe('isRateLimit', () => {
  test('body 含"操作频繁" → true', () => {
    assert.equal(isRateLimit('操作频繁，请稍后再试'), true);
  });

  test('body 含"频率限制" → true', () => {
    assert.equal(isRateLimit('频率限制，请稍后重试'), true);
  });

  test('body 含"too frequent" → true', () => {
    assert.equal(isRateLimit('too frequent operations'), true);
  });

  test('正常响应 → false', () => {
    assert.equal(isRateLimit('{"result":1}'), false);
  });

  test('null → false', () => {
    assert.equal(isRateLimit(null), false);
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
    assert.ok(Buffer.isBuffer(result), '应返回 Buffer');
  });

  test('包含文件名和 Content-Type', () => {
    const result = buildImageUploadForm(fakeImage, 'photo.jpg', boundary, {});
    const body = result.toString();
    assert.ok(body.includes('photo.jpg'), '应包含文件名');
    assert.ok(body.includes('image/jpeg'), 'jpg 应设置 image/jpeg');
  });

  test('png 文件 → image/png', () => {
    const result = buildImageUploadForm(fakeImage, 'photo.png', boundary, {});
    const body = result.toString();
    assert.ok(body.includes('image/png'));
  });

  test('webp 文件 → image/webp', () => {
    const result = buildImageUploadForm(fakeImage, 'photo.webp', boundary, {});
    const body = result.toString();
    assert.ok(body.includes('image/webp'));
  });

  test('未知扩展名 → image/jpeg（fallback）', () => {
    const result = buildImageUploadForm(fakeImage, 'photo.bmp', boundary, {});
    const body = result.toString();
    assert.ok(body.includes('image/jpeg'), '未知格式应 fallback 到 image/jpeg');
  });

  test('extraFields 被包含到 body', () => {
    const extraFields = { token: 'mytoken123', key: 'photos/test.jpg' };
    const result = buildImageUploadForm(fakeImage, 'test.jpg', boundary, extraFields);
    const body = result.toString();
    assert.ok(body.includes('mytoken123'), '应包含 token 值');
    assert.ok(body.includes('photos/test.jpg'), '应包含 key 值');
  });

  test('无 extraFields → 只有文件部分', () => {
    const result = buildImageUploadForm(fakeImage, 'test.jpg', boundary);
    const body = result.toString();
    assert.ok(body.includes(`--${boundary}`), '应包含 boundary');
    assert.ok(body.includes('test.jpg'));
  });

  test('包含 boundary 结束标记', () => {
    const result = buildImageUploadForm(fakeImage, 'test.jpg', boundary, {});
    const body = result.toString();
    assert.ok(body.includes(`--${boundary}--`), '应包含 boundary 结束标记');
  });

  test('图片数据被包含', () => {
    const result = buildImageUploadForm(fakeImage, 'test.jpg', boundary, {});
    assert.ok(result.includes(fakeImage), '应包含原始图片 Buffer');
  });
});

// ============================================================
// parseKuaishouResponse
// ============================================================
describe('parseKuaishouResponse', () => {
  test('result=1 → ok=true', () => {
    const { ok } = parseKuaishouResponse('{"result":1,"data":{"photo_id":"abc"}}');
    assert.equal(ok, true);
  });

  test('code=200 → ok=true', () => {
    const { ok } = parseKuaishouResponse('{"code":200,"data":{}}');
    assert.equal(ok, true);
  });

  test('code="200" → ok=true', () => {
    const { ok } = parseKuaishouResponse('{"code":"200","data":{}}');
    assert.equal(ok, true);
  });

  test('status="success" → ok=true', () => {
    const { ok } = parseKuaishouResponse('{"status":"success","data":{}}');
    assert.equal(ok, true);
  });

  test('result=0 → ok=false，errorMsg 包含 error_msg', () => {
    const { ok, errorMsg } = parseKuaishouResponse(
      '{"result":0,"error_msg":"内容违规"}'
    );
    assert.equal(ok, false);
    assert.ok(errorMsg && errorMsg.includes('内容违规'));
  });

  test('result=0 fallback 到 message 字段', () => {
    const { ok, errorMsg } = parseKuaishouResponse('{"result":0,"message":"失败了"}');
    assert.equal(ok, false);
    assert.ok(errorMsg && errorMsg.includes('失败了'));
  });

  test('data 字段被正确提取', () => {
    const { ok, data } = parseKuaishouResponse(
      '{"result":1,"data":{"photo_id":"img123"}}'
    );
    assert.equal(ok, true);
    assert.equal(data.photo_id, 'img123');
  });

  test('JSON 解析失败 → ok=false，errorMsg 包含"响应解析失败"', () => {
    const { ok, errorMsg } = parseKuaishouResponse('not-json');
    assert.equal(ok, false);
    assert.ok(errorMsg && errorMsg.includes('响应解析失败'));
  });

  test('无 data 字段 → 返回整个 parsed 对象', () => {
    const { ok, data } = parseKuaishouResponse('{"result":1,"photo_id":"xyz"}');
    assert.equal(ok, true);
    assert.ok(data !== null && data !== undefined);
  });
});
