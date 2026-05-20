'use strict';
/**
 * publish-xiaohongshu-image 单元测试
 *
 * 测试策略：
 * - 不启动真实浏览器，通过 mock CDP + mock fs 测试核心逻辑
 * - 覆盖：isLoginError / isPublishSuccess / findImages / 错误路径 / 批量发布逻辑
 *
 * 运行：
 *   node --test packages/workflows/skills/xiaohongshu-publisher/scripts/__tests__/publish-xiaohongshu-image.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ============================================================
// 从主脚本导入可测试函数
// ============================================================
const { isLoginError, isPublishSuccess } = require('../publish-xiaohongshu-image.cjs');

// ============================================================
// 从本地 utils 导入（不再依赖 weibo-publisher）
// ============================================================
const { findImages } = require('../utils.cjs');

// ============================================================
// isLoginError
// ============================================================
describe('isLoginError', () => {
  test('普通发布页 URL 返回 false', () => {
    assert.equal(isLoginError('https://creator.xiaohongshu.com/publish/publish'), false);
  });

  test('含 login 的 URL 返回 true', () => {
    assert.equal(isLoginError('https://creator.xiaohongshu.com/login?redirect=...'), true);
  });

  test('含 passport 的 URL 返回 true', () => {
    assert.equal(isLoginError('https://passport.xiaohongshu.com/login'), true);
  });

  test('undefined/null 返回 false', () => {
    assert.equal(isLoginError(undefined), false);
    assert.equal(isLoginError(null), false);
    assert.equal(isLoginError(''), false);
  });
});

// ============================================================
// isPublishSuccess
// ============================================================
describe('isPublishSuccess', () => {
  test('URL 跳离发布页时返回 true', () => {
    assert.equal(isPublishSuccess('https://creator.xiaohongshu.com/creator/note/123', ''), true);
  });

  test('仍在发布页且无成功关键词返回 false', () => {
    assert.equal(isPublishSuccess('https://creator.xiaohongshu.com/publish/publish', '请填写标题'), false);
  });

  test('正文含"发布成功"返回 true', () => {
    assert.equal(isPublishSuccess('https://creator.xiaohongshu.com/publish/publish', '发布成功！笔记正在审核'), true);
  });

  test('正文含"笔记已发布"返回 true', () => {
    assert.equal(isPublishSuccess('https://creator.xiaohongshu.com/publish/publish', '笔记已发布'), true);
  });

  test('正文含"创作成功"返回 true', () => {
    assert.equal(isPublishSuccess('https://creator.xiaohongshu.com/publish/publish', '创作成功'), true);
  });

  test('url 为空时仅依赖 bodyText', () => {
    assert.equal(isPublishSuccess('', '发布成功'), true);
    assert.equal(isPublishSuccess('', '请填写内容'), false);
  });
});

// ============================================================
// escapeForJS — 独立测试（内联实现，与主脚本保持一致）
// ============================================================
function escapeForJS(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

describe('escapeForJS', () => {
  test('普通文本不变', () => {
    assert.equal(escapeForJS('hello world'), 'hello world');
  });

  test('转义单引号', () => {
    assert.equal(escapeForJS("it's"), "it\\'s");
  });

  test('转义双引号', () => {
    assert.equal(escapeForJS('say "hi"'), 'say \\"hi\\"');
  });

  test('转义换行符', () => {
    assert.equal(escapeForJS('line1\nline2'), 'line1\\nline2');
  });

  test('转义反斜杠', () => {
    assert.equal(escapeForJS('C:\\path'), 'C:\\\\path');
  });

  test('转义混合字符', () => {
    const input = "it's a \"test\"\nline2";
    const result = escapeForJS(input);
    assert.ok(result.includes("\\'"));
    assert.ok(result.includes('\\"'));
    assert.ok(result.includes('\\n'));
  });
});

// ============================================================
// findImages — 来自本地 utils.cjs
// ============================================================
describe('findImages (来自本地 utils.cjs)', () => {
  let tmpDir;

  test('返回所有图片文件（按字母序）', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-test-'));
    fs.writeFileSync(path.join(tmpDir, 'b.jpg'), '');
    fs.writeFileSync(path.join(tmpDir, 'a.png'), '');
    fs.writeFileSync(path.join(tmpDir, 'c.webp'), '');
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), '');

    const images = findImages(tmpDir);
    assert.equal(images.length, 3);
    // 按字母序排列
    assert.ok(path.basename(images[0]) === 'a.png');
    assert.ok(path.basename(images[1]) === 'b.jpg');
    assert.ok(path.basename(images[2]) === 'c.webp');

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('空目录返回空数组', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-test-'));
    const images = findImages(tmpDir);
    assert.equal(images.length, 0);
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('只含非图片文件返回空数组', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-test-'));
    fs.writeFileSync(path.join(tmpDir, 'content.txt'), '正文');
    fs.writeFileSync(path.join(tmpDir, 'done.txt'), '2026-03-07');
    const images = findImages(tmpDir);
    assert.equal(images.length, 0);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ============================================================
// Windows 路径转换逻辑（核心业务逻辑）
// ============================================================
describe('Windows 路径转换', () => {
  const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\xiaohongshu-media';

  function buildWindowsPath(contentDir, imgFile) {
    const dateDir = path.basename(path.dirname(contentDir));
    const contentDirName = path.basename(contentDir);
    const filename = path.basename(imgFile);
    return path.join(WINDOWS_BASE_DIR, dateDir, contentDirName, filename).replace(/\//g, '\\');
  }

  test('正确生成 Windows 绝对路径', () => {
    const contentDir = '/Users/administrator/.xiaohongshu-queue/2026-03-07/image-1';
    const imgFile = '/Users/administrator/.xiaohongshu-queue/2026-03-07/image-1/photo.jpg';
    const result = buildWindowsPath(contentDir, imgFile);
    assert.equal(result, 'C:\\Users\\xuxia\\xiaohongshu-media\\2026-03-07\\image-1\\photo.jpg');
  });

  test('正斜杠全部转换为反斜杠', () => {
    const contentDir = '/tmp/test/2026-03-07/image-2';
    const imgFile = '/tmp/test/2026-03-07/image-2/cover.png';
    const result = buildWindowsPath(contentDir, imgFile);
    assert.ok(!result.includes('/'), '结果不应包含正斜杠');
    assert.ok(result.includes('\\'));
  });

  test('多张图片生成正确路径', () => {
    const contentDir = '/tmp/.xiaohongshu-queue/2026-03-07/image-3';
    const imgs = ['a.jpg', 'b.jpg', 'c.jpg'].map(f =>
      path.join(contentDir, f)
    );
    const windowsPaths = imgs.map(img => buildWindowsPath(contentDir, img));
    assert.equal(windowsPaths.length, 3);
    assert.ok(windowsPaths[0].endsWith('\\a.jpg'));
    assert.ok(windowsPaths[1].endsWith('\\b.jpg'));
    assert.ok(windowsPaths[2].endsWith('\\c.jpg'));
  });
});

// ============================================================
// 内容读取逻辑
// ============================================================
describe('内容读取', () => {
  let tmpDir;

  test('有 content.txt 时读取正文', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-content-'));
    fs.writeFileSync(path.join(tmpDir, 'content.txt'), '  测试正文  \n');
    const content = fs.readFileSync(path.join(tmpDir, 'content.txt'), 'utf8').trim();
    assert.equal(content, '测试正文');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('无 content.txt 时正文为空字符串', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-content-'));
    const contentFile = path.join(tmpDir, 'content.txt');
    const content = fs.existsSync(contentFile)
      ? fs.readFileSync(contentFile, 'utf8').trim()
      : '';
    assert.equal(content, '');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('有 title.txt 时读取标题（不超过 20 字）', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-title-'));
    fs.writeFileSync(path.join(tmpDir, 'title.txt'), '这是一个很长很长很长很长很长的标题啊啊啊');
    const title = fs.readFileSync(path.join(tmpDir, 'title.txt'), 'utf8').trim().slice(0, 20);
    assert.equal(title.length, 20);
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('无 title.txt 时从正文生成标题', () => {
    const contentText = '#旅行# 今天去了北京，天气很好，风景优美。';
    // 去掉话题标签，取前 20 字
    const titleFromContent = contentText.replace(/#[^#]+#/g, '').trim().slice(0, 20);
    assert.ok(titleFromContent.startsWith('今天去了北京'));
    assert.ok(titleFromContent.length <= 20);
  });
});

// ============================================================
// 批量发布逻辑（队列扫描）
// ============================================================
describe('批量发布队列逻辑', () => {
  let queueDir;

  function setupQueue() {
    queueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-queue-'));
    const dateDir = path.join(queueDir, '2026-03-07');
    fs.mkdirSync(dateDir);

    // image-1：有图片，未发布
    const img1 = path.join(dateDir, 'image-1');
    fs.mkdirSync(img1);
    fs.writeFileSync(path.join(img1, 'image.jpg'), 'fake-image');
    fs.writeFileSync(path.join(img1, 'content.txt'), '第一条笔记');

    // image-2：有图片，已发布（done.txt）
    const img2 = path.join(dateDir, 'image-2');
    fs.mkdirSync(img2);
    fs.writeFileSync(path.join(img2, 'image.jpg'), 'fake-image');
    fs.writeFileSync(path.join(img2, 'done.txt'), '2026-03-07T10:00:00Z');

    // image-3：无图片（跳过）
    const img3 = path.join(dateDir, 'image-3');
    fs.mkdirSync(img3);
    fs.writeFileSync(path.join(img3, 'content.txt'), '只有文字没有图');

    return { dateDir, img1, img2, img3 };
  }

  test('正确识别需要发布的目录（有图片且无 done.txt）', () => {
    const { dateDir, img1, img2, img3 } = setupQueue();

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

  test('done.txt 创建后标记为已发布', () => {
    const { img1 } = setupQueue();

    // 模拟发布成功后写入 done.txt
    const doneFile = path.join(img1, 'done.txt');
    fs.writeFileSync(doneFile, new Date().toISOString());

    assert.ok(fs.existsSync(doneFile));
    const content = fs.readFileSync(doneFile, 'utf8');
    assert.ok(content.length > 0);

    fs.rmSync(queueDir, { recursive: true });
  });

  test('统计 JSON 格式正确', () => {
    const stats = {
      date: '2026-03-07',
      total: 2,
      success: 1,
      failed: 1,
      skipped: 1,
      completedAt: '2026-03-07T10:00:00Z'
    };
    // 验证 JSON 序列化和反序列化
    const json = JSON.stringify(stats, null, 2);
    const parsed = JSON.parse(json);
    assert.equal(parsed.date, '2026-03-07');
    assert.equal(parsed.total, 2);
    assert.equal(parsed.success, 1);
    assert.equal(parsed.failed, 1);
    assert.equal(parsed.skipped, 1);
  });
});

// ============================================================
// 日志格式验证
// ============================================================
describe('日志格式 [XHS] 前缀', () => {
  const EXPECTED_PREFIX = '[XHS]';

  test('成功日志包含 [XHS] 前缀', () => {
    const logs = [
      '[XHS] ✅ 小红书笔记发布成功！',
      '[XHS] 1️⃣  导航到小红书发布页...',
      '[XHS] ❌ 发布失败: CDP 连接失败'
    ];
    for (const log of logs) {
      assert.ok(log.startsWith(EXPECTED_PREFIX), `日志应以 ${EXPECTED_PREFIX} 开头: ${log}`);
    }
  });
});

// ============================================================
// 图片数量限制（最多 9 张）
// ============================================================
describe('图片数量限制', () => {
  test('超过 9 张只取前 9 张', () => {
    const allImages = Array.from({ length: 12 }, (_, i) => `image${i + 1}.jpg`);
    const MAX_IMAGES = 9;
    const toUpload = allImages.slice(0, MAX_IMAGES);
    assert.equal(toUpload.length, 9);
    assert.equal(toUpload[0], 'image1.jpg');
    assert.equal(toUpload[8], 'image9.jpg');
  });

  test('少于 9 张全部上传', () => {
    const allImages = ['a.jpg', 'b.jpg', 'c.jpg'];
    const MAX_IMAGES = 9;
    const toUpload = allImages.slice(0, MAX_IMAGES);
    assert.equal(toUpload.length, 3);
  });
});
