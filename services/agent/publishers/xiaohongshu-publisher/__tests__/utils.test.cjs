'use strict';
/**
 * 小红书发布器工具函数单元测试
 *
 * 使用 Node.js 内置 test runner（无额外依赖，Node 18+）
 *
 * 运行：node --test packages/workflows/skills/xiaohongshu-publisher/scripts/__tests__/utils.test.cjs
 */

const path = require('path');

const {
  findImages,
  readTitle,
  readContent,
  convertToWindowsPaths,
  escapeForJS,
  extractDirNames,
} = require('../utils.cjs');

// ============================================================
// findImages
// ============================================================
describe('findImages', () => {
  test('无图片返回空数组', () => {
    const mockFs = { readdirSync: () => ['title.txt', 'content.txt', 'done.txt'] };
    const result = findImages('/tmp/image-1', mockFs);
    expect(result).toEqual([]);
  });

  test('单张图片返回一个路径', () => {
    const mockFs = { readdirSync: () => ['title.txt', 'image.jpg'] };
    const result = findImages('/tmp/image-1', mockFs);
    expect(result.length).toBe(1);
    expect(result[0].endsWith('image.jpg')).toBeTruthy();
  });

  test('多张图片按文件名排序', () => {
    const mockFs = { readdirSync: () => ['image3.jpg', 'image1.jpg', 'image2.jpg', 'title.txt'] };
    const result = findImages('/tmp/image-multi', mockFs);
    expect(result.length).toBe(3);
    expect(result[0].endsWith('image1.jpg')).toBeTruthy();
    expect(result[1].endsWith('image2.jpg')).toBeTruthy();
    expect(result[2].endsWith('image3.jpg')).toBeTruthy();
  });

  test('支持所有图片扩展名（jpg/jpeg/png/gif/webp）', () => {
    const mockFs = { readdirSync: () => ['a.jpg', 'b.jpeg', 'c.png', 'd.gif', 'e.webp', 'f.txt'] };
    const result = findImages('/tmp/mixed', mockFs);
    expect(result.length).toBe(5);
  });

  test('不区分大小写匹配扩展名', () => {
    const mockFs = { readdirSync: () => ['A.JPG', 'B.PNG', 'C.Jpeg'] };
    const result = findImages('/tmp/upper', mockFs);
    expect(result.length).toBe(3);
  });
});

// ============================================================
// readTitle
// ============================================================
describe('readTitle', () => {
  test('title.txt 不存在时返回空字符串', () => {
    const mockFs = { existsSync: () => false };
    const result = readTitle('/tmp/image-1', mockFs);
    expect(result).toBe('');
  });

  test('读取并修剪 title.txt 文本', () => {
    const mockFs = {
      existsSync: () => true,
      readFileSync: () => '  今日好天气  \n  ',
    };
    const result = readTitle('/tmp/image-1', mockFs);
    expect(result).toBe('今日好天气');
  });
});

// ============================================================
// readContent
// ============================================================
describe('readContent', () => {
  test('content.txt 不存在时返回空字符串', () => {
    const mockFs = { existsSync: () => false };
    const result = readContent('/tmp/image-1', mockFs);
    expect(result).toBe('');
  });

  test('读取并修剪 content.txt 文本', () => {
    const mockFs = {
      existsSync: () => true,
      readFileSync: () => '  今天天气真好 #话题#  \n  ',
    };
    const result = readContent('/tmp/image-1', mockFs);
    expect(result).toBe('今天天气真好 #话题#');
  });
});

// ============================================================
// convertToWindowsPaths
// ============================================================
describe('convertToWindowsPaths', () => {
  const WIN_BASE = 'C:\\Users\\xuxia\\xhs-media';

  test('单张图片路径转换', () => {
    const localImages = ['/Users/admin/.xhs-queue/2026-03-08/image-1/photo.jpg'];
    const result = convertToWindowsPaths(localImages, WIN_BASE, '2026-03-08', 'image-1');
    expect(result.length).toBe(1);
    expect(result[0]).toBe('C:\\Users\\xuxia\\xhs-media\\2026-03-08\\image-1\\photo.jpg');
  });

  test('多张图片路径转换', () => {
    const localImages = [
      '/tmp/queue/2026-03-08/image-2/img1.jpg',
      '/tmp/queue/2026-03-08/image-2/img2.png',
    ];
    const result = convertToWindowsPaths(localImages, WIN_BASE, '2026-03-08', 'image-2');
    expect(result.length).toBe(2);
    expect(result[0].includes('img1.jpg')).toBeTruthy();
    expect(result[1].includes('img2.png')).toBeTruthy();
    expect(result.every(p => !p.includes('/'))).toBeTruthy();
  });

  test('空数组返回空数组', () => {
    const result = convertToWindowsPaths([], WIN_BASE, '2026-03-08', 'image-1');
    expect(result).toEqual([]);
  });

  test('路径使用反斜杠分隔', () => {
    const localImages = ['/any/path/file.jpg'];
    const result = convertToWindowsPaths(localImages, WIN_BASE, '2026-03-08', 'image-1');
    expect(!result[0].includes('/')).toBeTruthy();
    expect(result[0].includes('\\')).toBeTruthy();
  });
});

// ============================================================
// escapeForJS
// ============================================================
describe('escapeForJS', () => {
  test('转义单引号', () => {
    const result = escapeForJS("it's a test");
    expect(result.includes("\\'")).toBeTruthy();
  });

  test('转义双引号', () => {
    const result = escapeForJS('say "hello"');
    expect(result.includes('\\"')).toBeTruthy();
  });

  test('转义换行符', () => {
    const result = escapeForJS('line1\nline2');
    expect(result.includes('\\n')).toBeTruthy();
    expect(!result.includes('\n')).toBeTruthy();
  });

  test('转义回车符', () => {
    const result = escapeForJS('line1\rline2');
    expect(result.includes('\\r')).toBeTruthy();
  });

  test('转义反斜杠', () => {
    const result = escapeForJS('path\\to\\file');
    expect(result.includes('\\\\')).toBeTruthy();
  });

  test('普通中文文本不变', () => {
    const text = '今天天气真好，小红书话题 #美食#';
    const result = escapeForJS(text);
    expect(result).toBe(text);
  });
});

// ============================================================
// extractDirNames
// ============================================================
describe('extractDirNames', () => {
  test('从标准路径提取日期目录和内容目录', () => {
    const result = extractDirNames('/Users/admin/.xhs-queue/2026-03-08/image-1');
    expect(result.dateDir).toBe('2026-03-08');
    expect(result.contentDirName).toBe('image-1');
  });

  test('从不同路径正确提取', () => {
    const result = extractDirNames('/tmp/queue/2026-01-01/image-5');
    expect(result.dateDir).toBe('2026-01-01');
    expect(result.contentDirName).toBe('image-5');
  });
});
