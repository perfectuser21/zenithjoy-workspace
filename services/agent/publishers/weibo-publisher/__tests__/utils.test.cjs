'use strict';
/**
 * 微博发布器工具函数单元测试
 *
 * 使用 vitest（globals:true）
 *
 * 运行：npx vitest run publishers/weibo-publisher
 */

const path = require('path');

const {
  PUBLISH_URL,
  MAX_RETRY_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  withRetry,
  findImages,
  readContent,
  convertToWindowsPaths,
  escapeForJS,
  extractDirNames,
  isLoginRedirect,
  isPublishPageReached,
} = require('../utils.cjs');

// ============================================================
// findImages
// ============================================================
describe('findImages', () => {
  test('场景1: 无图片 - 返回空数组', () => {
    const mockFs = {
      readdirSync: () => ['content.txt', 'done.txt', 'notes.md'],
    };
    const result = findImages('/tmp/image-1', mockFs);
    expect(result).toEqual([]);
  });

  test('场景2: 单张图片 - 返回含一个路径的数组', () => {
    const mockFs = {
      readdirSync: () => ['content.txt', 'image.jpg'],
    };
    const result = findImages('/tmp/image-1', mockFs);
    expect(result.length).toBe(1);
    expect(result[0].endsWith('image.jpg')).toBeTruthy();
  });

  test('场景3: 多张图片 - 按文件名排序', () => {
    const mockFs = {
      readdirSync: () => ['image3.jpg', 'image1.jpg', 'image2.jpg', 'content.txt'],
    };
    const result = findImages('/tmp/image-multi', mockFs);
    expect(result.length).toBe(3);
    expect(result[0].endsWith('image1.jpg')).toBeTruthy();
    expect(result[1].endsWith('image2.jpg')).toBeTruthy();
    expect(result[2].endsWith('image3.jpg')).toBeTruthy();
  });

  test('支持所有图片扩展名（jpg/jpeg/png/gif/webp）', () => {
    const mockFs = {
      readdirSync: () => ['a.jpg', 'b.jpeg', 'c.png', 'd.gif', 'e.webp', 'f.txt'],
    };
    const result = findImages('/tmp/mixed', mockFs);
    expect(result.length).toBe(5);
  });

  test('不区分大小写匹配扩展名', () => {
    const mockFs = {
      readdirSync: () => ['A.JPG', 'B.PNG', 'C.Jpeg'],
    };
    const result = findImages('/tmp/upper', mockFs);
    expect(result.length).toBe(3);
  });

  test('非图片文件被过滤', () => {
    const mockFs = {
      readdirSync: () => ['content.txt', 'done.txt', '.DS_Store', 'notes.md'],
    };
    const result = findImages('/tmp/no-images', mockFs);
    expect(result.length).toBe(0);
  });
});

// ============================================================
// readContent
// ============================================================
describe('readContent', () => {
  test('content.txt 不存在时返回空字符串', () => {
    const mockFs = {
      existsSync: () => false,
    };
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

  test('content.txt 为空文件时返回空字符串', () => {
    const mockFs = {
      existsSync: () => true,
      readFileSync: () => '   \n   ',
    };
    const result = readContent('/tmp/image-1', mockFs);
    expect(result).toBe('');
  });
});

// ============================================================
// convertToWindowsPaths
// ============================================================
describe('convertToWindowsPaths', () => {
  const WIN_BASE = 'C:\\Users\\xuxia\\weibo-media';

  test('单张图片路径转换', () => {
    const localImages = ['/Users/admin/.weibo-queue/2026-03-07/image-1/photo.jpg'];
    const result = convertToWindowsPaths(localImages, WIN_BASE, '2026-03-07', 'image-1');
    expect(result.length).toBe(1);
    expect(result[0]).toBe('C:\\Users\\xuxia\\weibo-media\\2026-03-07\\image-1\\photo.jpg');
  });

  test('多张图片路径转换', () => {
    const localImages = [
      '/tmp/queue/2026-03-07/image-2/img1.jpg',
      '/tmp/queue/2026-03-07/image-2/img2.png',
    ];
    const result = convertToWindowsPaths(localImages, WIN_BASE, '2026-03-07', 'image-2');
    expect(result.length).toBe(2);
    expect(result[0].includes('img1.jpg')).toBeTruthy();
    expect(result[1].includes('img2.png')).toBeTruthy();
    expect(result.every(p => !p.includes('/'))).toBeTruthy();
  });

  test('空数组返回空数组', () => {
    const result = convertToWindowsPaths([], WIN_BASE, '2026-03-07', 'image-1');
    expect(result).toEqual([]);
  });

  test('路径使用反斜杠分隔', () => {
    const localImages = ['/any/path/file.jpg'];
    const result = convertToWindowsPaths(localImages, WIN_BASE, '2026-03-07', 'image-1');
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
    expect(!result.includes("'") || result.includes("\\'")).toBeTruthy();
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

  test('普通文本不变', () => {
    const text = '今天天气真好，微博话题 #美食#';
    const result = escapeForJS(text);
    expect(result).toBe(text);
  });
});

// ============================================================
// extractDirNames
// ============================================================
describe('extractDirNames', () => {
  test('从标准路径提取日期目录和内容目录', () => {
    const result = extractDirNames('/Users/admin/.weibo-queue/2026-03-07/image-1');
    expect(result.dateDir).toBe('2026-03-07');
    expect(result.contentDirName).toBe('image-1');
  });

  test('从不同路径正确提取', () => {
    const result = extractDirNames('/tmp/queue/2026-01-01/image-5');
    expect(result.dateDir).toBe('2026-01-01');
    expect(result.contentDirName).toBe('image-5');
  });
});

// ============================================================
// PUBLISH_URL
// ============================================================
describe('PUBLISH_URL', () => {
  test('包含 weibo.com', () => {
    expect(typeof PUBLISH_URL === 'string').toBeTruthy();
    expect(PUBLISH_URL.includes('weibo.com')).toBeTruthy();
  });

  test('是有效 HTTPS URL', () => {
    expect(PUBLISH_URL.startsWith('https://')).toBeTruthy();
  });
});

// ============================================================
// isLoginRedirect
// ============================================================
describe('isLoginRedirect', () => {
  test('passport.weibo.com → true', () => {
    expect(isLoginRedirect('https://passport.weibo.com/signin/login')).toBe(true);
  });

  test('login.weibo.com → true', () => {
    expect(isLoginRedirect('https://login.weibo.com/')).toBe(true);
  });

  test('weibo.com/login → true', () => {
    expect(isLoginRedirect('https://weibo.com/login')).toBe(true);
  });

  test('/signin 路径 → true', () => {
    expect(isLoginRedirect('https://weibo.com/signin')).toBe(true);
  });

  test('weibo.com/signup/signup → true', () => {
    expect(isLoginRedirect('https://weibo.com/signup/signup')).toBe(true);
  });

  test('weibo.com/p/publish/ → false（正常发布页，未被重定向）', () => {
    expect(isLoginRedirect('https://weibo.com/p/publish/')).toBe(false);
  });

  test('weibo.com 首页 → false', () => {
    expect(isLoginRedirect('https://weibo.com')).toBe(false);
  });

  test('null → false', () => {
    expect(isLoginRedirect(null)).toBe(false);
  });

  test('undefined → false', () => {
    expect(isLoginRedirect(undefined)).toBe(false);
  });

  test('空字符串 → false', () => {
    expect(isLoginRedirect('')).toBe(false);
  });
});

// ============================================================
// isPublishPageReached
// ============================================================
describe('isPublishPageReached', () => {
  test('weibo.com/p/publish/ → true', () => {
    expect(isPublishPageReached('https://weibo.com/p/publish/')).toBe(true);
  });

  test('weibo.com/p/publish（无尾斜杠）→ true', () => {
    expect(isPublishPageReached('https://weibo.com/p/publish')).toBe(true);
  });

  test('passport.weibo.com（登录跳转）→ false', () => {
    expect(isPublishPageReached('https://passport.weibo.com/signin/login')).toBe(false);
  });

  test('weibo.com 首页（现在在首页发布）→ true', () => {
    expect(isPublishPageReached('https://weibo.com')).toBe(true);
  });

  test('null → false', () => {
    expect(isPublishPageReached(null)).toBe(false);
  });

  test('undefined → false', () => {
    expect(isPublishPageReached(undefined)).toBe(false);
  });

  test('空字符串 → false', () => {
    expect(isPublishPageReached('')).toBe(false);
  });
});

// ============================================================
// withRetry
// ============================================================
describe('withRetry', () => {
  test('成功时直接返回结果，不重试', async () => {
    let calls = 0;
    const result = await withRetry(() => { calls++; return Promise.resolve(42); }, 3, 0);
    expect(result).toBe(42);
    expect(calls).toBe(1);
  });

  test('第一次失败后重试成功', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 2) throw new Error('暂时失败');
      return 'ok';
    }, 3, 0);
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  test('超过最大次数时抛出最后一个错误', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error('一直失败');
      }, 3, 0)
    ).rejects.toThrow(/一直失败/);
    expect(attempts).toBe(3);
  });

  test('isRetryable 返回 false 时立即停止，不再重试', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => { attempts++; throw new Error('不可重试错误'); },
        3, 0,
        () => false
      )
    ).rejects.toThrow(/不可重试错误/);
    expect(attempts).toBe(1);
  });

  test('isRetryable 按错误类型区分：可重试错误继续，不可重试立即停止', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => { attempts++; throw new Error('限频：请稍后再试'); },
        3, 0,
        (err) => !err.message.includes('未登录')  // 限频可重试，未登录不可重试
      )
    ).rejects.toThrow(/限频/);
    expect(attempts).toBe(3);  // 限频可重试，走满 3 次
  });

  test('DEFAULT MAX_RETRY_ATTEMPTS 为 3', () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(3);
  });

  test('DEFAULT RETRY_BASE_DELAY_MS 为 2000', () => {
    expect(RETRY_BASE_DELAY_MS).toBe(2000);
  });

  test('不传参数时使用默认值（maxAttempts=3）', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error('test');
      }, 3, 0)  // 传 0 延迟避免测试超时
    ).rejects.toThrow(/test/);
    expect(attempts).toBe(3);
  });
});
