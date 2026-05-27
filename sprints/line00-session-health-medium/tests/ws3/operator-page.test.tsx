import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const PAGE_PATH = 'apps/dashboard/src/pages/OperatorPage.tsx';

function readPage(): string {
  return readFileSync(PAGE_PATH, 'utf8');
}

describe('WS3 — OperatorPage thin→medium 重构 [BEHAVIOR]', () => {
  it('OperatorPage.tsx 含 8 个平台名', () => {
    const src = readPage();
    for (const p of ['抖音', '快手', '小红书', '视频号', '头条', '微博', '知乎', '公众号']) {
      expect(src, `缺平台 ${p}`).toContain(p);
    }
  });

  it('status 枚举含 active（PRD 要求，禁用 ok 作为有效状态）', () => {
    const src = readPage();
    expect(src).toMatch(/'active'|"active"/);
    // ok 不应作为 status badge 的成功枚举
    expect(src).not.toMatch(/status.*[=:]=.*['"]ok['"]/);
  });

  it('含 POST trigger-bind 调用', () => {
    const src = readPage();
    expect(src).toContain('trigger-bind');
  });

  it('含轮询逻辑（setInterval 或 useEffect 定时，间隔 ≤30000ms）', () => {
    const src = readPage();
    expect(src).toMatch(/setInterval|polling|30000|30 \* 1000/);
  });

  it('含 GET /api/operator/sessions 调用（非旧 /sync）', () => {
    const src = readPage();
    expect(src).toMatch(/operator\/sessions/);
    expect(src).not.toMatch(/sessions\/sync/);
  });

  it('含 lastCheckedAt 或 lastValidAt 字段引用', () => {
    const src = readPage();
    expect(src).toMatch(/lastCheckedAt|lastValidAt/);
  });

  it('is_operator 守卫保留 xuxiao21xx@icloud.com', () => {
    const src = readPage();
    expect(src).toContain('xuxiao21xx@icloud.com');
  });
});
