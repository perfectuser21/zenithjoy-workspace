'use strict';
/**
 * 快手发布器工具函数单元测试
 *
 * 覆盖：图片查找、文案读取、Windows 路径转换、JS 转义、
 *       目录名提取、OAuth 登录重定向检测、发布页面检测。
 *
 * 运行：
 *   node --test packages/workflows/skills/kuaishou-publisher/scripts/__tests__/utils.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  PUBLISH_URLS,
  MAX_HASHTAGS,
  DEFAULT_MUSIC_QUERY,
  findImages,
  readContent,
  convertToWindowsPaths,
  escapeForJS,
  extractDirNames,
  isLoginRedirect,
  isPublishPageReached,
  formatSessionStatus,
  extractPublishId,
  truncateHashtags,
  readMusicQuery,
} = require('../utils.cjs');

// ============================================================
// Test 1: PUBLISH_URLS — 候选发布 URL 数组
// ============================================================
describe('PUBLISH_URLS（候选发布 URL）', () => {
  test('包含至少两个候选 URL', () => {
    assert.ok(Array.isArray(PUBLISH_URLS), 'PUBLISH_URLS 应为数组');
    assert.ok(PUBLISH_URLS.length >= 2, '至少应有 2 个候选 URL');
  });

  test('第一个候选 URL 包含 cp.kuaishou.com', () => {
    assert.ok(PUBLISH_URLS[0].includes('cp.kuaishou.com'), '首选 URL 应在创作者中心');
  });

  test('所有 URL 以 https 开头', () => {
    for (const url of PUBLISH_URLS) {
      assert.ok(url.startsWith('https://'), `${url} 应以 https:// 开头`);
    }
  });
});

// ============================================================
// Test 2: findImages — 图片查找
// ============================================================
describe('findImages（图片查找）', () => {
  let tmpDir;

  function setup() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-find-images-'));
    return tmpDir;
  }

  test('找到 jpg/png/gif/webp 图片并排序', () => {
    setup();
    fs.writeFileSync(path.join(tmpDir, 'image2.jpg'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'image1.png'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'image3.gif'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'content.txt'), '文案');

    const images = findImages(tmpDir);
    assert.equal(images.length, 3, '应找到 3 张图片');
    assert.ok(images[0].endsWith('image1.png'), '应按字母排序');
    assert.ok(images[1].endsWith('image2.jpg'));
    assert.ok(images[2].endsWith('image3.gif'));
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('忽略非图片文件', () => {
    setup();
    fs.writeFileSync(path.join(tmpDir, 'photo.jpg'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'content.txt'), '文案');
    fs.writeFileSync(path.join(tmpDir, 'done.txt'), '已完成');

    const images = findImages(tmpDir);
    assert.equal(images.length, 1, '只应找到 1 张图片');
    assert.ok(images[0].endsWith('photo.jpg'));
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('空目录返回空数组', () => {
    setup();
    const images = findImages(tmpDir);
    assert.equal(images.length, 0, '空目录应返回空数组');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ============================================================
// Test 3: readContent — 文案读取
// ============================================================
describe('readContent（文案读取）', () => {
  let tmpDir;

  test('正确读取 content.txt 文案', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-content-'));
    fs.writeFileSync(path.join(tmpDir, 'content.txt'), '  这是快手文案  ');
    const result = readContent(tmpDir);
    assert.equal(result, '这是快手文案', '应去除首尾空格');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('无 content.txt 时返回空字符串', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-content-'));
    const result = readContent(tmpDir);
    assert.equal(result, '', '无文案时应返回空字符串');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ============================================================
// Test 4: convertToWindowsPaths — Windows 路径转换
// ============================================================
describe('convertToWindowsPaths（Windows 路径转换）', () => {
  const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\kuaishou-media';

  test('生成正确的 Windows 路径', () => {
    const localImages = ['/Users/admin/.kuaishou-queue/2026-03-08/image-1/photo.jpg'];
    const result = convertToWindowsPaths(localImages, WINDOWS_BASE_DIR, '2026-03-08', 'image-1');
    assert.equal(result[0], 'C:\\Users\\xuxia\\kuaishou-media\\2026-03-08\\image-1\\photo.jpg');
  });

  test('路径使用反斜杠，无正斜杠', () => {
    const localImages = ['/tmp/queue/2026-03-08/image-2/cover.png'];
    const result = convertToWindowsPaths(localImages, WINDOWS_BASE_DIR, '2026-03-08', 'image-2');
    assert.ok(!result[0].includes('/'), '不应含正斜杠');
    assert.ok(result[0].includes('\\'), '应含反斜杠');
  });

  test('多张图片路径转换', () => {
    const localImages = [
      '/tmp/.kuaishou-queue/2026-03-08/image-3/img1.jpg',
      '/tmp/.kuaishou-queue/2026-03-08/image-3/img2.jpg',
    ];
    const result = convertToWindowsPaths(localImages, WINDOWS_BASE_DIR, '2026-03-08', 'image-3');
    assert.equal(result.length, 2);
    assert.ok(result[0].endsWith('\\img1.jpg'));
    assert.ok(result[1].endsWith('\\img2.jpg'));
  });
});

// ============================================================
// Test 5: escapeForJS — JS 注入转义
// ============================================================
describe('escapeForJS（JS 注入转义）', () => {
  test('换行符正确转义', () => {
    const result = escapeForJS('第一段\n第二段');
    assert.ok(result.includes('\\n'), '换行应转义为 \\n');
    assert.ok(!result.includes('\n'), '不应含原始换行符');
  });

  test('中文内容不被破坏', () => {
    const text = '快手发布测试，中文正常';
    const result = escapeForJS(text);
    assert.equal(result, text, '中文内容应原样保留');
  });

  test('单引号正确转义', () => {
    const result = escapeForJS("it's fine");
    assert.ok(result.includes("\\'"), '单引号应被转义');
  });
});

// ============================================================
// Test 6: extractDirNames — 目录名提取
// ============================================================
describe('extractDirNames（目录名提取）', () => {
  test('正确提取快手队列路径的日期和内容目录名', () => {
    const result = extractDirNames('/Users/admin/.kuaishou-queue/2026-03-08/image-1');
    assert.equal(result.dateDir, '2026-03-08');
    assert.equal(result.contentDirName, 'image-1');
  });

  test('标准路径分隔正确', () => {
    const result = extractDirNames('/tmp/queue/2026-03-10/image-5');
    assert.equal(result.dateDir, '2026-03-10');
    assert.equal(result.contentDirName, 'image-5');
  });
});

// ============================================================
// Test 7: isLoginRedirect — OAuth 登录重定向检测
// ============================================================
describe('isLoginRedirect（OAuth 登录重定向检测）', () => {
  test('识别 passport.kuaishou.com 重定向', () => {
    assert.ok(
      isLoginRedirect('https://passport.kuaishou.com/pc/account/login/?sid=kuaishou.web.cp.api'),
      '应识别 passport.kuaishou.com 为登录重定向'
    );
  });

  test('识别 /account/login 重定向', () => {
    assert.ok(
      isLoginRedirect('https://some.kuaishou.com/account/login?redirect=...'),
      '应识别 /account/login 为登录重定向'
    );
  });

  test('识别 cp.kuaishou.com/profile 重定向（会话过期）', () => {
    assert.ok(
      isLoginRedirect('https://cp.kuaishou.com/profile'),
      '应识别 /profile 为会话过期重定向'
    );
  });

  test('正常发布页面不被误判为重定向', () => {
    assert.ok(
      !isLoginRedirect('https://cp.kuaishou.com/article/publish/photo-video'),
      '发布页面不应被判断为登录重定向'
    );
  });

  test('创作者中心管理页面不被误判', () => {
    assert.ok(
      !isLoginRedirect('https://cp.kuaishou.com/article/manage/video'),
      '管理页面不应被判断为登录重定向'
    );
  });

  test('空值返回 false', () => {
    assert.equal(isLoginRedirect(''), false);
    assert.equal(isLoginRedirect(null), false);
    assert.equal(isLoginRedirect(undefined), false);
  });
});

// ============================================================
// Test 8: formatSessionStatus — 会话状态格式化
// ============================================================
describe('formatSessionStatus（会话状态格式化）', () => {
  test('ok 状态返回 [SESSION_OK] 和 exitCode 0', () => {
    const result = formatSessionStatus('ok');
    assert.equal(result.tag, '[SESSION_OK]');
    assert.equal(result.exitCode, 0);
    assert.ok(result.message.length > 0, 'message 不应为空');
  });

  test('expired 状态返回 [SESSION_EXPIRED] 和 exitCode 2', () => {
    const result = formatSessionStatus('expired');
    assert.equal(result.tag, '[SESSION_EXPIRED]');
    assert.equal(result.exitCode, 2);
  });

  test('cdp_error 状态返回 [CDP_ERROR] 和 exitCode 1', () => {
    const result = formatSessionStatus('cdp_error');
    assert.equal(result.tag, '[CDP_ERROR]');
    assert.equal(result.exitCode, 1);
  });

  test('timeout 状态返回 [TIMEOUT] 和 exitCode 1', () => {
    const result = formatSessionStatus('timeout');
    assert.equal(result.tag, '[TIMEOUT]');
    assert.equal(result.exitCode, 1);
  });

  test('url 参数附加到 message 中', () => {
    const url = 'https://passport.kuaishou.com/login';
    const result = formatSessionStatus('expired', url);
    assert.ok(result.message.includes(url), 'message 应包含 url');
  });

  test('无 url 时 message 不包含括号', () => {
    const result = formatSessionStatus('ok');
    assert.ok(!result.message.includes('(https'), 'message 不应含 url 括号');
  });

  test('未知状态返回 [UNKNOWN] 和 exitCode 1', () => {
    const result = formatSessionStatus('whatever');
    assert.equal(result.tag, '[UNKNOWN]');
    assert.equal(result.exitCode, 1);
  });
});

// ============================================================
// Test 9: extractPublishId — 发布 ID 提取
// ============================================================
describe('extractPublishId（发布 ID 提取）', () => {
  test('从 URL query 参数 photoId 提取', () => {
    const result = extractPublishId(
      'https://cp.kuaishou.com/article/manage/photo-video?photoId=1234567890'
    );
    assert.equal(result, '1234567890');
  });

  test('从 URL query 参数 id 提取', () => {
    const result = extractPublishId(
      'https://cp.kuaishou.com/article/manage/photo-video?id=9876543210'
    );
    assert.equal(result, '9876543210');
  });

  test('从 URL query 参数 photo_id 提取', () => {
    const result = extractPublishId(
      'https://cp.kuaishou.com/article/manage?photo_id=11223344556'
    );
    assert.equal(result, '11223344556');
  });

  test('从 URL 路径片段提取数字 ID', () => {
    const result = extractPublishId(
      'https://cp.kuaishou.com/photo/detail/98765432100'
    );
    assert.equal(result, '98765432100');
  });

  test('从页面正文 JSON 字段提取 photoId', () => {
    const body = 'some text "photoId":"1122334455" more text';
    assert.equal(extractPublishId(null, body), '1122334455');
  });

  test('从中文提示文本提取作品 ID', () => {
    const body = '发布成功！作品ID：55667788990';
    assert.equal(extractPublishId(null, body), '55667788990');
  });

  test('无法提取时返回 null', () => {
    assert.equal(extractPublishId('https://cp.kuaishou.com/article/publish/photo-video'), null);
    assert.equal(extractPublishId(null, '发布成功'), null);
    assert.equal(extractPublishId(null, null), null);
    assert.equal(extractPublishId('', ''), null);
  });

  test('URL 和 bodyText 均为空时返回 null', () => {
    assert.equal(extractPublishId(undefined, undefined), null);
  });
});

// ============================================================
// Test 10: truncateHashtags — 话题标签截断（快手 ≤4 个限制）
// ============================================================
describe('truncateHashtags（话题标签截断）', () => {
  test('MAX_HASHTAGS 常量为 4', () => {
    assert.equal(MAX_HASHTAGS, 4);
  });

  test('标签数量 ≤4 时原样返回', () => {
    const text = '今天天气好 #天气 #晴天 #快手';
    assert.equal(truncateHashtags(text), text);
  });

  test('恰好 4 个标签时原样返回', () => {
    const text = '文案 #标签1 #标签2 #标签3 #标签4';
    assert.equal(truncateHashtags(text), text);
  });

  test('5 个标签时截断为 4 个', () => {
    const text = '文案 #标签1 #标签2 #标签3 #标签4 #标签5';
    const result = truncateHashtags(text);
    const remaining = (result.match(/#[\u4e00-\u9fa5a-zA-Z0-9_]+/g) || []);
    assert.equal(remaining.length, 4, '截断后应剩 4 个标签');
    assert.ok(!result.includes('#标签5'), '第 5 个标签应被截断');
  });

  test('6 个标签截断后保留前 4 个', () => {
    const text = '#A #B #C #D #E #F';
    const result = truncateHashtags(text);
    const tags = (result.match(/#[A-Z]/g) || []);
    assert.equal(tags.length, 4);
    assert.deepEqual(tags, ['#A', '#B', '#C', '#D']);
  });

  test('无标签时原样返回', () => {
    const text = '今天天气不错，出去走走吧';
    assert.equal(truncateHashtags(text), text);
  });

  test('支持中文标签', () => {
    const text = '#一人公司 #赚钱 #副业 #AI #自媒体 #多余的标签';
    const result = truncateHashtags(text);
    const tags = (result.match(/#[\u4e00-\u9fa5a-zA-Z0-9_]+/g) || []);
    assert.equal(tags.length, 4);
    assert.ok(!result.includes('#多余的标签'));
  });
});

// ============================================================
// Test 11: readMusicQuery — 音乐搜索词读取
// ============================================================
describe('readMusicQuery（音乐搜索词读取）', () => {
  test('DEFAULT_MUSIC_QUERY 常量为 热歌', () => {
    assert.equal(DEFAULT_MUSIC_QUERY, '热歌');
  });

  test('有 music.txt 时读取其内容', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-music-'));
    fs.writeFileSync(path.join(tmpDir, 'music.txt'), '  抖音热歌  ');
    const result = readMusicQuery(tmpDir);
    assert.equal(result, '抖音热歌', '应去除首尾空格');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('music.txt 为空时返回默认值', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-music-'));
    fs.writeFileSync(path.join(tmpDir, 'music.txt'), '   ');
    const result = readMusicQuery(tmpDir);
    assert.equal(result, DEFAULT_MUSIC_QUERY, '空文件应返回默认搜索词');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('无 music.txt 时返回默认值', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-music-'));
    const result = readMusicQuery(tmpDir);
    assert.equal(result, DEFAULT_MUSIC_QUERY);
    fs.rmSync(tmpDir, { recursive: true });
  });
});
