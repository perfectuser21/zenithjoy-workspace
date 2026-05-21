import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SMOKE_PATH = resolve(
  process.cwd(),
  '.github/workflows/scripts/smoke/acquisition-overview-smoke.sh'
);

describe('WS1 — acquisition smoke 脚本结构 [BEHAVIOR]', () => {
  it('smoke 脚本文件存在于正确路径', () => {
    expect(existsSync(SMOKE_PATH)).toBe(true);
  });

  it('smoke 脚本非占位符（≥ 10 行实质内容）', () => {
    const content = readFileSync(SMOKE_PATH, 'utf8');
    const substantiveLines = content
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#'));
    expect(substantiveLines.length).toBeGreaterThanOrEqual(10);
  });

  it('smoke 脚本包含 401 鉴权检查', () => {
    const content = readFileSync(SMOKE_PATH, 'utf8');
    expect(content).toMatch(/401/);
  });

  it('smoke 脚本使用 PRD 字面字段名 enabled（不漂移）', () => {
    const content = readFileSync(SMOKE_PATH, 'utf8');
    expect(content).toMatch(/\.enabled/);
    expect(content).not.toMatch(/\.isEnabled/);
  });

  it('smoke 脚本包含 feature == "smart_acquisition" 断言', () => {
    const content = readFileSync(SMOKE_PATH, 'utf8');
    expect(content).toMatch(/smart_acquisition/);
  });

  it('smoke 脚本包含 keys 完整性检查', () => {
    const content = readFileSync(SMOKE_PATH, 'utf8');
    expect(content).toMatch(/keys ==/);
  });
});
