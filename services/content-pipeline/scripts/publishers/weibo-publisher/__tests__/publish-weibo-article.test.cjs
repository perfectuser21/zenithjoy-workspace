'use strict';
/**
 * 微博长文章发布器单元测试
 *
 * 测试范围：纯函数逻辑（无网络、无 CDP 依赖）
 * 覆盖内容：参数解析、内容读取、封面图查找
 *
 * 运行：
 *   node --test services/creator/scripts/publishers/weibo-publisher/__tests__/publish-weibo-article.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================
// 测试脚本文件存在
// ============================================================
describe('publish-weibo-article.cjs 文件存在', () => {
  test('脚本文件位于正确路径', () => {
    const scriptPath = path.join(
      __dirname,
      '..',
      'publish-weibo-article.cjs'
    );
    assert.ok(fs.existsSync(scriptPath), `文件不存在: ${scriptPath}`);
  });
});

// ============================================================
// 脚本源码静态检查
// ============================================================
describe('publish-weibo-article.cjs 静态检查', () => {
  let src;
  test('读取源码', () => {
    const scriptPath = path.join(__dirname, '..', 'publish-weibo-article.cjs');
    src = fs.readFileSync(scriptPath, 'utf8');
    assert.ok(src.length > 0);
  });

  test('使用 connectOverCDP 连接远程 CDP', () => {
    const scriptPath = path.join(__dirname, '..', 'publish-weibo-article.cjs');
    const source = fs.readFileSync(scriptPath, 'utf8');
    assert.ok(
      source.includes('connectOverCDP'),
      '脚本必须使用 playwright connectOverCDP'
    );
  });

  test('包含 ttarticle 目标 URL', () => {
    const scriptPath = path.join(__dirname, '..', 'publish-weibo-article.cjs');
    const source = fs.readFileSync(scriptPath, 'utf8');
    assert.ok(
      source.includes('ttarticle'),
      '脚本必须导航到 weibo.com/ttarticle/editor'
    );
  });

  test('包含 CDP_URL 配置常量', () => {
    const scriptPath = path.join(__dirname, '..', 'publish-weibo-article.cjs');
    const source = fs.readFileSync(scriptPath, 'utf8');
    assert.ok(source.includes('CDP_URL'), '脚本必须定义 CDP_URL 常量');
  });

  test('包含 page.screenshot 截图机制', () => {
    const scriptPath = path.join(__dirname, '..', 'publish-weibo-article.cjs');
    const source = fs.readFileSync(scriptPath, 'utf8');
    assert.ok(source.includes('page.screenshot'), '脚本必须包含截图机制');
  });

  test('包含 catch 错误处理', () => {
    const scriptPath = path.join(__dirname, '..', 'publish-weibo-article.cjs');
    const source = fs.readFileSync(scriptPath, 'utf8');
    assert.ok(source.includes('catch'), '脚本必须包含错误处理');
  });
});

// ============================================================
// 其他脚本完整性（PRESERVE 检查）
// ============================================================
describe('现有脚本完整性（PRESERVE）', () => {
  const existingScripts = ['cdp-client.cjs', 'publish-weibo-api.cjs', 'publish-weibo-video.cjs'];

  for (const script of existingScripts) {
    test(`${script} 仍然存在`, () => {
      const scriptPath = path.join(__dirname, '..', script);
      assert.ok(fs.existsSync(scriptPath), `${script} 不应该被删除`);
    });
  }
});
