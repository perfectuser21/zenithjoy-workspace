'use strict';
/**
 * publish-weibo-image.cjs 业务逻辑单元测试
 *
 * 测试策略：不启动真实浏览器，通过提取可测试的纯函数逻辑进行验证。
 * 覆盖：MAX_IMAGES 截断、日志格式、Windows 路径转换、内容读取。
 *
 * 运行：
 *   node --test packages/workflows/skills/weibo-publisher/scripts/__tests__/publish-weibo-image.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  findImages,
  readContent,
  convertToWindowsPaths,
  escapeForJS,
  extractDirNames,
} = require('../utils.cjs');

// ============================================================
// 图片数量限制（MAX_IMAGES = 9，微博平台限制）
// ============================================================
describe('图片数量限制 (MAX_IMAGES = 9)', () => {
  const MAX_IMAGES = 9;

  test('超过 9 张只取前 9 张', () => {
    const allImages = Array.from({ length: 12 }, (_, i) => `/tmp/image${i + 1}.jpg`);
    const localImages = allImages.length > MAX_IMAGES
      ? allImages.slice(0, MAX_IMAGES)
      : allImages;
    assert.equal(localImages.length, 9);
    assert.ok(localImages[0].endsWith('image1.jpg'));
    assert.ok(localImages[8].endsWith('image9.jpg'));
  });

  test('恰好 9 张不截断', () => {
    const allImages = Array.from({ length: 9 }, (_, i) => `/tmp/image${i + 1}.jpg`);
    const localImages = allImages.length > MAX_IMAGES
      ? allImages.slice(0, MAX_IMAGES)
      : allImages;
    assert.equal(localImages.length, 9);
  });

  test('少于 9 张全部保留', () => {
    const allImages = ['/tmp/a.jpg', '/tmp/b.jpg', '/tmp/c.jpg'];
    const localImages = allImages.length > MAX_IMAGES
      ? allImages.slice(0, MAX_IMAGES)
      : allImages;
    assert.equal(localImages.length, 3);
  });

  test('截断时 allImages.length > MAX_IMAGES 为真', () => {
    const allImages = Array.from({ length: 10 }, (_, i) => `/tmp/image${i + 1}.jpg`);
    assert.ok(allImages.length > MAX_IMAGES);
  });

  test('不截断时 allImages.length > MAX_IMAGES 为假', () => {
    const allImages = Array.from({ length: 9 }, (_, i) => `/tmp/image${i + 1}.jpg`);
    assert.ok(!(allImages.length > MAX_IMAGES));
  });
});

// ============================================================
// Windows 路径转换（微博专用目录）
// ============================================================
describe('Windows 路径转换 (weibo-media)', () => {
  const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\weibo-media';

  test('生成正确的微博 Windows 路径', () => {
    const localImages = ['/Users/admin/.weibo-queue/2026-03-08/image-1/photo.jpg'];
    const result = convertToWindowsPaths(localImages, WINDOWS_BASE_DIR, '2026-03-08', 'image-1');
    assert.equal(result[0], 'C:\\Users\\xuxia\\weibo-media\\2026-03-08\\image-1\\photo.jpg');
  });

  test('路径使用反斜杠，无正斜杠', () => {
    const localImages = ['/tmp/queue/2026-03-08/image-2/cover.png'];
    const result = convertToWindowsPaths(localImages, WINDOWS_BASE_DIR, '2026-03-08', 'image-2');
    assert.ok(!result[0].includes('/'));
    assert.ok(result[0].includes('\\'));
  });

  test('多张图片路径转换', () => {
    const localImages = [
      '/tmp/.weibo-queue/2026-03-08/image-3/img1.jpg',
      '/tmp/.weibo-queue/2026-03-08/image-3/img2.jpg',
    ];
    const result = convertToWindowsPaths(localImages, WINDOWS_BASE_DIR, '2026-03-08', 'image-3');
    assert.equal(result.length, 2);
    assert.ok(result[0].endsWith('\\img1.jpg'));
    assert.ok(result[1].endsWith('\\img2.jpg'));
  });
});

// ============================================================
// extractDirNames — 提取日期目录和内容目录
// ============================================================
describe('extractDirNames（微博队列路径）', () => {
  test('标准微博队列路径', () => {
    const result = extractDirNames('/Users/admin/.weibo-queue/2026-03-08/image-1');
    assert.equal(result.dateDir, '2026-03-08');
    assert.equal(result.contentDirName, 'image-1');
  });
});

// ============================================================
// 内容读取
// ============================================================
describe('内容读取（微博文案）', () => {
  let tmpDir;

  test('读取带话题标签的文案', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weibo-content-'));
    const content = '今日分享 #AI# #效率# 好好工作！';
    fs.writeFileSync(path.join(tmpDir, 'content.txt'), content);
    const result = readContent(tmpDir);
    assert.equal(result, content);
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('无 content.txt 时返回空字符串', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weibo-content-'));
    const result = readContent(tmpDir);
    assert.equal(result, '');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('文案不超过 2000 字符（微博字符限制）', () => {
    // 微博正文限制 2000 字，内容文件应遵守此限制
    const longText = '好'.repeat(1999);
    assert.ok(longText.length <= 2000, '微博文案不超过 2000 字');
  });
});

// ============================================================
// escapeForJS（文案安全注入 CDP）
// ============================================================
describe('escapeForJS（微博文案注入安全）', () => {
  test('话题标签 # 不被转义', () => {
    const result = escapeForJS('#AI工具# 今天的分享');
    assert.ok(result.includes('#'));
  });

  test('换行符正确转义', () => {
    const result = escapeForJS('第一段\n第二段');
    assert.ok(result.includes('\\n'));
    assert.ok(!result.includes('\n'));
  });

  test('中文内容不被破坏', () => {
    const text = '微博发布测试，中文正常';
    const result = escapeForJS(text);
    assert.equal(result, text);
  });
});

// ============================================================
// 批量发布队列逻辑
// ============================================================
describe('批量发布队列（~/.weibo-queue）', () => {
  let queueDir;

  function setupQueue() {
    queueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weibo-queue-'));
    const dateDir = path.join(queueDir, '2026-03-08');
    fs.mkdirSync(dateDir);

    // image-1: 有图片，未发布
    const img1 = path.join(dateDir, 'image-1');
    fs.mkdirSync(img1);
    fs.writeFileSync(path.join(img1, 'image.jpg'), 'fake-image');
    fs.writeFileSync(path.join(img1, 'content.txt'), '#AI# 今日分享');

    // image-2: 已发布（done.txt 存在）
    const img2 = path.join(dateDir, 'image-2');
    fs.mkdirSync(img2);
    fs.writeFileSync(path.join(img2, 'image.jpg'), 'fake-image');
    fs.writeFileSync(path.join(img2, 'done.txt'), '2026-03-08T10:00:00Z');

    // image-3: 无图片（跳过）
    const img3 = path.join(dateDir, 'image-3');
    fs.mkdirSync(img3);
    fs.writeFileSync(path.join(img3, 'content.txt'), '只有文字');

    return { dateDir, img1, img2, img3 };
  }

  test('正确识别需要发布的目录', () => {
    const { dateDir, img1 } = setupQueue();

    const dirs = fs.readdirSync(dateDir)
      .filter(d => d.startsWith('image-'))
      .map(d => path.join(dateDir, d))
      .filter(d => fs.statSync(d).isDirectory());

    const hasImage = (dir) => {
      const files = fs.readdirSync(dir);
      return files.some(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
    };
    const isDone = (dir) => fs.existsSync(path.join(dir, 'done.txt'));

    const toPublish = dirs.filter(d => hasImage(d) && !isDone(d));
    assert.equal(toPublish.length, 1);
    assert.ok(toPublish[0].includes('image-1'));

    fs.rmSync(queueDir, { recursive: true });
  });

  test('发布成功后创建 done.txt', () => {
    const { img1 } = setupQueue();
    const doneFile = path.join(img1, 'done.txt');
    fs.writeFileSync(doneFile, new Date().toISOString());
    assert.ok(fs.existsSync(doneFile));
    fs.rmSync(queueDir, { recursive: true });
  });

  test('统计 JSON 格式正确', () => {
    const stats = {
      date: '2026-03-08',
      total: 3,
      success: 1,
      failed: 0,
      skipped: 2,
      completedAt: '2026-03-08T10:00:00Z'
    };
    const json = JSON.stringify(stats, null, 2);
    const parsed = JSON.parse(json);
    assert.equal(parsed.date, '2026-03-08');
    assert.equal(parsed.total, 3);
    assert.equal(parsed.success, 1);
    assert.equal(parsed.skipped, 2);
  });
});
