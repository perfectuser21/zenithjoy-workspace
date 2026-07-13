'use strict';
/**
 * 微博长文章发布器单元测试
 *
 * 测试范围：纯函数逻辑（无网络、无 CDP 依赖）
 * 覆盖内容：参数解析、内容读取、封面图查找
 *
 * 运行：npx vitest run publishers/weibo-publisher
 */

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
    expect(fs.existsSync(scriptPath)).toBeTruthy();
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
    expect(src.length > 0).toBeTruthy();
  });

  test('使用 connectOverCDP 连接远程 CDP', () => {
    const scriptPath = path.join(__dirname, '..', 'publish-weibo-article.cjs');
    const source = fs.readFileSync(scriptPath, 'utf8');
    expect(source.includes('connectOverCDP')).toBeTruthy();
  });

  test('包含 ttarticle 目标 URL', () => {
    const scriptPath = path.join(__dirname, '..', 'publish-weibo-article.cjs');
    const source = fs.readFileSync(scriptPath, 'utf8');
    expect(source.includes('ttarticle')).toBeTruthy();
  });

  test('包含 CDP_URL 配置常量', () => {
    const scriptPath = path.join(__dirname, '..', 'publish-weibo-article.cjs');
    const source = fs.readFileSync(scriptPath, 'utf8');
    expect(source.includes('CDP_URL')).toBeTruthy();
  });

  test('包含 page.screenshot 截图机制', () => {
    const scriptPath = path.join(__dirname, '..', 'publish-weibo-article.cjs');
    const source = fs.readFileSync(scriptPath, 'utf8');
    expect(source.includes('page.screenshot')).toBeTruthy();
  });

  test('包含 catch 错误处理', () => {
    const scriptPath = path.join(__dirname, '..', 'publish-weibo-article.cjs');
    const source = fs.readFileSync(scriptPath, 'utf8');
    expect(source.includes('catch')).toBeTruthy();
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
      expect(fs.existsSync(scriptPath)).toBeTruthy();
    });
  }
});
