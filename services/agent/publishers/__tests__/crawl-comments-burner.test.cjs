'use strict';
/**
 * 回归守卫：crawl-comments-douyin.cjs 必须用 burner profile 启动自己的 Chrome，
 * 不能再依赖外部 CDP 连接。
 *
 * [BEHAVIOR] 1: 不含 connectOverCDP（已删除）
 * [BEHAVIOR] 2: 含 launchPersistentContext（burner 方式）
 * [BEHAVIOR] 3: 含 resolveBurnerProfileDir（自动发现 burner 目录）
 * [BEHAVIOR] 4: 含 BURNER_SESSION_EXPIRED（cookie 失效检测）
 */
const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.resolve(__dirname, '..', 'crawl-comments-douyin.cjs');

const { describe, it, expect } = globalThis;

describe('crawl-comments-douyin.cjs — burner session 守卫', () => {
  it('[B1] 不再使用 connectOverCDP（已删除 CDP 依赖）', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(src).not.toContain('connectOverCDP');
  });

  it('[B2] 使用 launchPersistentContext 启动 burner Chrome', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(src).toContain('launchPersistentContext');
  });

  it('[B3] 含 resolveBurnerProfileDir 自动发现 burner 目录', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(src).toContain('resolveBurnerProfileDir');
    expect(src).toContain('zj-douyin-burner-v1');
  });

  it('[B4] 含 BURNER_SESSION_EXPIRED 登录跳转检测', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(src).toContain('BURNER_SESSION_EXPIRED');
    expect(src).toContain('/login');
  });

  it('[B5] MAX_SCROLL_ROUNDS <= 20（防止单视频阻塞超过 30s）', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    const m = src.match(/MAX_SCROLL_ROUNDS\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(parseInt(m[1], 10)).toBeLessThanOrEqual(20);
  });

  it('[B6] resolveBurnerProfileDir 优先读 ZJ_MAIN_DATA_DIR env var（防止多账号时选错目录）', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    // ZJ_MAIN_DATA_DIR 必须在 resolveBurnerProfileDir 函数体内出现
    const fnMatch = src.match(/function resolveBurnerProfileDir\(\)[^}]+(?:\{[^}]*\}[^}]*)?\}/s);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch[0]).toContain('ZJ_MAIN_DATA_DIR');
    // 必须在扫目录逻辑（let root）之前检查 env var
    const envIdx = fnMatch[0].indexOf('ZJ_MAIN_DATA_DIR');
    const rootIdx = fnMatch[0].indexOf('let root');
    expect(envIdx).toBeLessThan(rootIdx);
  });
});
