import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

const SPEC_PATH = 'apps/dashboard/e2e/operator-sessions.spec.ts';

describe('WS4 — operator-sessions Playwright spec [BEHAVIOR]', () => {
  it('operator-sessions.spec.ts 存在', () => {
    expect(existsSync(SPEC_PATH), `文件不存在: ${SPEC_PATH}`).toBe(true);
  });

  it('spec 含 page.route stub（不依赖真实后端）', () => {
    const src = readFileSync(SPEC_PATH, 'utf8');
    expect(src).toMatch(/page\.route/);
  });

  it('spec 含 8 个平台名断言', () => {
    const src = readFileSync(SPEC_PATH, 'utf8');
    for (const p of ['抖音', '快手', '小红书', '视频号', '头条', '微博', '知乎', '公众号']) {
      expect(src, `spec 缺平台 ${p} 断言`).toContain(p);
    }
  });

  it('spec 含至少 3 个 test/it 块', () => {
    const src = readFileSync(SPEC_PATH, 'utf8');
    const matches = src.match(/^\s*(test|it)\s*\(/gm) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('spec mock 使用 active 而非 ok 作为成功 status', () => {
    const src = readFileSync(SPEC_PATH, 'utf8');
    expect(src).toMatch(/"active"|'active'/);
    expect(src).not.toMatch(/"status"\s*:\s*"ok"/);
  });

  it('spec mock response 含 platform/status/secretName 字段', () => {
    const src = readFileSync(SPEC_PATH, 'utf8');
    expect(src).toContain('platform');
    expect(src).toContain('status');
    expect(src).toContain('secretName');
  });
});
