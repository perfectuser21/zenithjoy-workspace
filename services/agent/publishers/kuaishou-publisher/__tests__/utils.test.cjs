'use strict';
/**
 * 快手发布器工具函数单元测试
 *
 * 覆盖：图片查找、文案读取、Windows 路径转换、JS 转义、
 *       目录名提取、OAuth 登录重定向检测、发布页面检测。
 *
 * 运行：
 *   npx vitest run publishers/kuaishou-publisher
 */

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
    expect(Array.isArray(PUBLISH_URLS)).toBeTruthy();
    expect(PUBLISH_URLS.length >= 2).toBeTruthy();
  });

  test('第一个候选 URL 包含 cp.kuaishou.com', () => {
    expect(PUBLISH_URLS[0].includes('cp.kuaishou.com')).toBeTruthy();
  });

  test('所有 URL 以 https 开头', () => {
    for (const url of PUBLISH_URLS) {
      expect(url.startsWith('https://')).toBeTruthy();
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
    expect(images.length).toBe(3);
    expect(images[0].endsWith('image1.png')).toBeTruthy();
    expect(images[1].endsWith('image2.jpg')).toBeTruthy();
    expect(images[2].endsWith('image3.gif')).toBeTruthy();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('忽略非图片文件', () => {
    setup();
    fs.writeFileSync(path.join(tmpDir, 'photo.jpg'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'content.txt'), '文案');
    fs.writeFileSync(path.join(tmpDir, 'done.txt'), '已完成');

    const images = findImages(tmpDir);
    expect(images.length).toBe(1);
    expect(images[0].endsWith('photo.jpg')).toBeTruthy();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('空目录返回空数组', () => {
    setup();
    const images = findImages(tmpDir);
    expect(images.length).toBe(0);
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
    expect(result).toBe('这是快手文案');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('无 content.txt 时返回空字符串', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-content-'));
    const result = readContent(tmpDir);
    expect(result).toBe('');
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
    expect(result[0]).toBe('C:\\Users\\xuxia\\kuaishou-media\\2026-03-08\\image-1\\photo.jpg');
  });

  test('路径使用反斜杠，无正斜杠', () => {
    const localImages = ['/tmp/queue/2026-03-08/image-2/cover.png'];
    const result = convertToWindowsPaths(localImages, WINDOWS_BASE_DIR, '2026-03-08', 'image-2');
    expect(!result[0].includes('/')).toBeTruthy();
    expect(result[0].includes('\\')).toBeTruthy();
  });

  test('多张图片路径转换', () => {
    const localImages = [
      '/tmp/.kuaishou-queue/2026-03-08/image-3/img1.jpg',
      '/tmp/.kuaishou-queue/2026-03-08/image-3/img2.jpg',
    ];
    const result = convertToWindowsPaths(localImages, WINDOWS_BASE_DIR, '2026-03-08', 'image-3');
    expect(result.length).toBe(2);
    expect(result[0].endsWith('\\img1.jpg')).toBeTruthy();
    expect(result[1].endsWith('\\img2.jpg')).toBeTruthy();
  });
});

// ============================================================
// Test 5: escapeForJS — JS 注入转义
// ============================================================
describe('escapeForJS（JS 注入转义）', () => {
  test('换行符正确转义', () => {
    const result = escapeForJS('第一段\n第二段');
    expect(result.includes('\\n')).toBeTruthy();
    expect(!result.includes('\n')).toBeTruthy();
  });

  test('中文内容不被破坏', () => {
    const text = '快手发布测试，中文正常';
    const result = escapeForJS(text);
    expect(result).toBe(text);
  });

  test('单引号正确转义', () => {
    const result = escapeForJS("it's fine");
    expect(result.includes("\\'")).toBeTruthy();
  });
});

// ============================================================
// Test 6: extractDirNames — 目录名提取
// ============================================================
describe('extractDirNames（目录名提取）', () => {
  test('正确提取快手队列路径的日期和内容目录名', () => {
    const result = extractDirNames('/Users/admin/.kuaishou-queue/2026-03-08/image-1');
    expect(result.dateDir).toBe('2026-03-08');
    expect(result.contentDirName).toBe('image-1');
  });

  test('标准路径分隔正确', () => {
    const result = extractDirNames('/tmp/queue/2026-03-10/image-5');
    expect(result.dateDir).toBe('2026-03-10');
    expect(result.contentDirName).toBe('image-5');
  });
});

// ============================================================
// Test 7: isLoginRedirect — OAuth 登录重定向检测
// ============================================================
describe('isLoginRedirect（OAuth 登录重定向检测）', () => {
  test('识别 passport.kuaishou.com 重定向', () => {
    expect(
      isLoginRedirect('https://passport.kuaishou.com/pc/account/login/?sid=kuaishou.web.cp.api')
    ).toBeTruthy();
  });

  test('识别 /account/login 重定向', () => {
    expect(
      isLoginRedirect('https://some.kuaishou.com/account/login?redirect=...')
    ).toBeTruthy();
  });

  test('识别 cp.kuaishou.com/profile 重定向（会话过期）', () => {
    expect(
      isLoginRedirect('https://cp.kuaishou.com/profile')
    ).toBeTruthy();
  });

  test('正常发布页面不被误判为重定向', () => {
    expect(
      !isLoginRedirect('https://cp.kuaishou.com/article/publish/photo-video')
    ).toBeTruthy();
  });

  test('创作者中心管理页面不被误判', () => {
    expect(
      !isLoginRedirect('https://cp.kuaishou.com/article/manage/video')
    ).toBeTruthy();
  });

  test('空值返回 false', () => {
    expect(isLoginRedirect('')).toBe(false);
    expect(isLoginRedirect(null)).toBe(false);
    expect(isLoginRedirect(undefined)).toBe(false);
  });
});

// ============================================================
// Test 8: formatSessionStatus — 会话状态格式化
// ============================================================
describe('formatSessionStatus（会话状态格式化）', () => {
  test('ok 状态返回 [SESSION_OK] 和 exitCode 0', () => {
    const result = formatSessionStatus('ok');
    expect(result.tag).toBe('[SESSION_OK]');
    expect(result.exitCode).toBe(0);
    expect(result.message.length > 0).toBeTruthy();
  });

  test('expired 状态返回 [SESSION_EXPIRED] 和 exitCode 2', () => {
    const result = formatSessionStatus('expired');
    expect(result.tag).toBe('[SESSION_EXPIRED]');
    expect(result.exitCode).toBe(2);
  });

  test('cdp_error 状态返回 [CDP_ERROR] 和 exitCode 1', () => {
    const result = formatSessionStatus('cdp_error');
    expect(result.tag).toBe('[CDP_ERROR]');
    expect(result.exitCode).toBe(1);
  });

  test('timeout 状态返回 [TIMEOUT] 和 exitCode 1', () => {
    const result = formatSessionStatus('timeout');
    expect(result.tag).toBe('[TIMEOUT]');
    expect(result.exitCode).toBe(1);
  });

  test('url 参数附加到 message 中', () => {
    const url = 'https://passport.kuaishou.com/login';
    const result = formatSessionStatus('expired', url);
    expect(result.message.includes(url)).toBeTruthy();
  });

  test('无 url 时 message 不包含括号', () => {
    const result = formatSessionStatus('ok');
    expect(!result.message.includes('(https')).toBeTruthy();
  });

  test('未知状态返回 [UNKNOWN] 和 exitCode 1', () => {
    const result = formatSessionStatus('whatever');
    expect(result.tag).toBe('[UNKNOWN]');
    expect(result.exitCode).toBe(1);
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
    expect(result).toBe('1234567890');
  });

  test('从 URL query 参数 id 提取', () => {
    const result = extractPublishId(
      'https://cp.kuaishou.com/article/manage/photo-video?id=9876543210'
    );
    expect(result).toBe('9876543210');
  });

  test('从 URL query 参数 photo_id 提取', () => {
    const result = extractPublishId(
      'https://cp.kuaishou.com/article/manage?photo_id=11223344556'
    );
    expect(result).toBe('11223344556');
  });

  test('从 URL 路径片段提取数字 ID', () => {
    const result = extractPublishId(
      'https://cp.kuaishou.com/photo/detail/98765432100'
    );
    expect(result).toBe('98765432100');
  });

  test('从页面正文 JSON 字段提取 photoId', () => {
    const body = 'some text "photoId":"1122334455" more text';
    expect(extractPublishId(null, body)).toBe('1122334455');
  });

  test('从中文提示文本提取作品 ID', () => {
    const body = '发布成功！作品ID：55667788990';
    expect(extractPublishId(null, body)).toBe('55667788990');
  });

  test('无法提取时返回 null', () => {
    expect(extractPublishId('https://cp.kuaishou.com/article/publish/photo-video')).toBe(null);
    expect(extractPublishId(null, '发布成功')).toBe(null);
    expect(extractPublishId(null, null)).toBe(null);
    expect(extractPublishId('', '')).toBe(null);
  });

  test('URL 和 bodyText 均为空时返回 null', () => {
    expect(extractPublishId(undefined, undefined)).toBe(null);
  });
});

// ============================================================
// Test 10: truncateHashtags — 话题标签截断（快手 ≤4 个限制）
// ============================================================
describe('truncateHashtags（话题标签截断）', () => {
  test('MAX_HASHTAGS 常量为 4', () => {
    expect(MAX_HASHTAGS).toBe(4);
  });

  test('标签数量 ≤4 时原样返回', () => {
    const text = '今天天气好 #天气 #晴天 #快手';
    expect(truncateHashtags(text)).toBe(text);
  });

  test('恰好 4 个标签时原样返回', () => {
    const text = '文案 #标签1 #标签2 #标签3 #标签4';
    expect(truncateHashtags(text)).toBe(text);
  });

  test('5 个标签时截断为 4 个', () => {
    const text = '文案 #标签1 #标签2 #标签3 #标签4 #标签5';
    const result = truncateHashtags(text);
    const remaining = (result.match(/#[一-龥a-zA-Z0-9_]+/g) || []);
    expect(remaining.length).toBe(4);
    expect(!result.includes('#标签5')).toBeTruthy();
  });

  test('6 个标签截断后保留前 4 个', () => {
    const text = '#A #B #C #D #E #F';
    const result = truncateHashtags(text);
    const tags = (result.match(/#[A-Z]/g) || []);
    expect(tags.length).toBe(4);
    expect(tags).toEqual(['#A', '#B', '#C', '#D']);
  });

  test('无标签时原样返回', () => {
    const text = '今天天气不错，出去走走吧';
    expect(truncateHashtags(text)).toBe(text);
  });

  test('支持中文标签', () => {
    const text = '#一人公司 #赚钱 #副业 #AI #自媒体 #多余的标签';
    const result = truncateHashtags(text);
    const tags = (result.match(/#[一-龥a-zA-Z0-9_]+/g) || []);
    expect(tags.length).toBe(4);
    expect(!result.includes('#多余的标签')).toBeTruthy();
  });
});

// ============================================================
// Test 11: readMusicQuery — 音乐搜索词读取
// ============================================================
describe('readMusicQuery（音乐搜索词读取）', () => {
  test('DEFAULT_MUSIC_QUERY 常量为 热歌', () => {
    expect(DEFAULT_MUSIC_QUERY).toBe('热歌');
  });

  test('有 music.txt 时读取其内容', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-music-'));
    fs.writeFileSync(path.join(tmpDir, 'music.txt'), '  抖音热歌  ');
    const result = readMusicQuery(tmpDir);
    expect(result).toBe('抖音热歌');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('music.txt 为空时返回默认值', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-music-'));
    fs.writeFileSync(path.join(tmpDir, 'music.txt'), '   ');
    const result = readMusicQuery(tmpDir);
    expect(result).toBe(DEFAULT_MUSIC_QUERY);
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('无 music.txt 时返回默认值', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-music-'));
    const result = readMusicQuery(tmpDir);
    expect(result).toBe(DEFAULT_MUSIC_QUERY);
    fs.rmSync(tmpDir, { recursive: true });
  });
});
