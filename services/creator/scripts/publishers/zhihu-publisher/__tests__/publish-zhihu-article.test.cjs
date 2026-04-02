'use strict';
/**
 * publish-zhihu-article 单元测试
 *
 * 测试策略：
 * - 不启动真实浏览器，仅测试纯函数逻辑
 * - 覆盖：isLoginError、isPublishSuccess、findCoverImage、toWindowsCoverPath
 *
 * 运行：
 *   node --test packages/workflows/skills/zhihu-publisher/scripts/__tests__/publish-zhihu-article.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const {
  isLoginError,
  isPublishSuccess,
  findCoverImage,
  toWindowsCoverPath,
} = require('../publish-zhihu-article.cjs');

// ============================================================
// isLoginError
// ============================================================

describe('isLoginError', () => {
  test('空/非字符串 → false', () => {
    assert.equal(isLoginError(null), false);
    assert.equal(isLoginError(undefined), false);
    assert.equal(isLoginError(123), false);
    assert.equal(isLoginError(''), false);
  });

  test('知乎登录页 URL → true', () => {
    assert.equal(isLoginError('https://www.zhihu.com/signin'), true);
    assert.equal(isLoginError('https://www.zhihu.com/signup?next=/'), true);
    assert.equal(isLoginError('https://passport.zhihu.com/login'), true);
  });

  test('正常知乎页面 → false', () => {
    assert.equal(isLoginError('https://zhuanlan.zhihu.com/write'), false);
    assert.equal(isLoginError('https://zhuanlan.zhihu.com/p/12345678'), false);
    assert.equal(isLoginError('https://www.zhihu.com/'), false);
  });
});

// ============================================================
// isPublishSuccess
// ============================================================

describe('isPublishSuccess', () => {
  test('空/非字符串 → false', () => {
    assert.equal(isPublishSuccess(null, ''), false);
    assert.equal(isPublishSuccess(undefined, ''), false);
    assert.equal(isPublishSuccess('', ''), false);
  });

  test('跳转到文章页（/p/数字）→ true', () => {
    assert.equal(isPublishSuccess('https://zhuanlan.zhihu.com/p/12345678', ''), true);
    assert.equal(isPublishSuccess('https://zhuanlan.zhihu.com/p/9876543210', ''), true);
  });

  test('页面包含"发布成功" → true', () => {
    assert.equal(isPublishSuccess('https://zhuanlan.zhihu.com/write', '发布成功，请查看'), true);
    assert.equal(isPublishSuccess('https://zhuanlan.zhihu.com/write', '文章已发布'), true);
  });

  test('仍在发布页且无成功提示 → false', () => {
    assert.equal(isPublishSuccess('https://zhuanlan.zhihu.com/write', '请填写标题'), false);
    assert.equal(isPublishSuccess('https://zhuanlan.zhihu.com/', ''), false);
  });
});

// ============================================================
// findCoverImage
// ============================================================

describe('findCoverImage', () => {
  test('目录无封面图 → null', () => {
    const mockFs = {
      existsSync: () => false,
    };
    assert.equal(findCoverImage('/some/dir', mockFs), null);
  });

  test('找到 cover.jpg → 返回路径', () => {
    const mockFs = {
      existsSync: p => p.endsWith('cover.jpg'),
    };
    const result = findCoverImage('/some/dir', mockFs);
    assert.equal(result, path.join('/some/dir', 'cover.jpg'));
  });

  test('找到 cover.jpeg（jpg 不存在）→ 返回路径', () => {
    const mockFs = {
      existsSync: p => p.endsWith('cover.jpeg'),
    };
    const result = findCoverImage('/some/dir', mockFs);
    assert.equal(result, path.join('/some/dir', 'cover.jpeg'));
  });

  test('找到 cover.png（jpg/jpeg 不存在）→ 返回路径', () => {
    const mockFs = {
      existsSync: p => p.endsWith('cover.png'),
    };
    const result = findCoverImage('/some/dir', mockFs);
    assert.equal(result, path.join('/some/dir', 'cover.png'));
  });
});

// ============================================================
// toWindowsCoverPath
// ============================================================

describe('toWindowsCoverPath', () => {
  test('转换正确 Windows 路径', () => {
    const result = toWindowsCoverPath(
      '/Users/admin/zhihu-queue/2026-03-10/article-1/cover.jpg',
      'C:\\Users\\xuxia\\zhihu-media',
      '2026-03-10',
      'article-1'
    );
    assert.equal(result, 'C:\\Users\\xuxia\\zhihu-media\\2026-03-10\\article-1\\cover.jpg');
  });

  test('支持 .png 扩展名', () => {
    const result = toWindowsCoverPath(
      '/path/to/cover.png',
      'C:\\media',
      '2026-03-10',
      'art-2'
    );
    assert.equal(result, 'C:\\media\\2026-03-10\\art-2\\cover.png');
  });
});
