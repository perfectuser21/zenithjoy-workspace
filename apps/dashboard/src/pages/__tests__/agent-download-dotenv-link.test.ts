/**
 * AgentDownloadPage — 个人 .env 下载链接源码断言
 *
 * 问题背景：COS 大包内 .env.template 写死生产地址，staging 用户拿不到正确配置。
 * 修法：在下载页加 /api/agent/install-pack/dotenv 链接，让后端动态注入当前环境地址 + license。
 *
 * 断言风格参照：no-placeholder-tenant.test.ts（源码级，不依赖 jsdom/react）
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PAGES = path.resolve(__dirname, '..');

describe('AgentDownloadPage 个人 .env 下载链接 [BEHAVIOR]', () => {
  it('页面源码含指向 /api/agent/install-pack/dotenv 的下载链接', () => {
    const src = fs.readFileSync(path.join(PAGES, 'AgentDownloadPage.tsx'), 'utf8');
    expect(src).toMatch(/\/api\/agent\/install-pack\/dotenv/);
  });

  it('dotenv 链接带 download=".env" 属性（让浏览器直接另存为 .env）', () => {
    const src = fs.readFileSync(path.join(PAGES, 'AgentDownloadPage.tsx'), 'utf8');
    expect(src).toMatch(/download=["']\.env["']/);
  });

  it('安装说明含"覆盖"或".env"指引，提示用户将下载的文件放进 agent 目录', () => {
    const src = fs.readFileSync(path.join(PAGES, 'AgentDownloadPage.tsx'), 'utf8');
    // 指引文字含"覆盖"或"把 .env 放进"等关键词
    expect(src).toMatch(/覆盖|把.*\.env.*放进|将.*\.env.*复制/);
  });
});
