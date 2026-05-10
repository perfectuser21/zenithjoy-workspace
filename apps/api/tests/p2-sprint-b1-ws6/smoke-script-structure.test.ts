/**
 * WS6 — smoke 脚本结构 + fake-feishu-server seen-records 增量 (CI 实跑落点)
 *
 * Path: apps/api/tests/p2-sprint-b1-ws6/ (3 deep) → ../../../...
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SMOKE = path.resolve(
  __dirname,
  '../../../../.github/workflows/scripts/smoke/golden-path-2-b1-smoke.sh'
);
const FAKE_FEISHU = path.resolve(__dirname, '../../test-utils/fake-feishu-server.ts');

describe('Workstream 6 — smoke 脚本结构 [BEHAVIOR]', () => {
  it('smoke 脚本存在 + 可执行', () => {
    expect(fs.existsSync(SMOKE)).toBe(true);
    const stat = fs.statSync(SMOKE);
    expect((stat.mode & 0o111) !== 0).toBe(true);
  });

  it('脚本头部含 4 ENV 自检', () => {
    const c = fs.readFileSync(SMOKE, 'utf8');
    const head = c.split('\n').slice(0, 30).join('\n');
    ['API_BASE', 'DB', 'FEISHU_API_BASE', 'SMOKE_TOKEN'].forEach((k) => {
      expect(head).toMatch(new RegExp(`-z\\s+"\\$\\{?${k}`));
    });
  });

  it('脚本含 10 个 Step 标识', () => {
    const c = fs.readFileSync(SMOKE, 'utf8');
    for (let i = 1; i <= 10; i++) {
      expect(c).toContain(`Step ${i}`);
    }
  });

  it('所有 SELECT count 含 interval 时间窗口（防造假通过）', () => {
    const c = fs.readFileSync(SMOKE, 'utf8');
    const lines = c.split('\n');
    const bad = lines.filter(
      (l) => /SELECT count\(/.test(l) && !/interval\s+'/.test(l)
    );
    expect(bad, `这些行 SELECT count 缺时间窗口: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it('fake-feishu-server seen-records helper 端点 + 内存 store', () => {
    const c = fs.readFileSync(FAKE_FEISHU, 'utf8');
    expect(c).toContain('__test/seen-records');
    expect(c).toContain('seenRecords');
  });
});
