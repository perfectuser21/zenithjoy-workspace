/**
 * Path 4 Sprint 1 ws6 — golden-path-4-smoke.sh 形态契约（合同 RED）。
 *
 * 校验：
 *   1) .github/workflows/scripts/smoke/golden-path-4-smoke.sh 存在 + 可执行
 *   2) 内容 ≥ 30 行（不能是 ws1 的占位骨架）
 *   3) grep -cE "(curl|psql|node |python3?|ssh|playwright)" ≥ 6（每 step 至少一次真调 binary）
 *   4) grep echo/printf 占位 ≤ 12 行（防 echo 假 PASS）
 *   5) 6 个 step 标记齐全（Step 1..Step 6）
 *   6) REAL_PUBLISH 环境变量分支存在
 *
 * 注：tests/ws6/** 在 vitest.config.ts 里被 exclude，不进 CI vitest 集；
 * 由 sprint-evaluator 在合同验证阶段执行。
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SMOKE = path.join(
  REPO_ROOT,
  '.github',
  'workflows',
  'scripts',
  'smoke',
  'golden-path-4-smoke.sh'
);

describe('ws6 golden-path-4-smoke.sh — 文件形态', () => {
  it('文件存在', () => {
    expect(fs.existsSync(SMOKE)).toBe(true);
  });

  it('文件可执行', () => {
    const stat = fs.statSync(SMOKE);
    // owner execute bit (0o100)
    expect(stat.mode & 0o100).toBeTruthy();
  });

  it('内容 ≥ 30 行（不再是 ws1 占位骨架）', () => {
    const src = fs.readFileSync(SMOKE, 'utf-8');
    const lines = src.split('\n').length;
    expect(lines).toBeGreaterThanOrEqual(30);
  });

  it('真调 binary（curl|psql|node |python3?|ssh|playwright）≥ 6 次', () => {
    const src = fs.readFileSync(SMOKE, 'utf-8');
    const re = /(?:^|[^a-zA-Z_])(?:curl|psql|node |python3?|ssh|playwright)(?:[\s]|$)/gm;
    const hits = src.match(re) || [];
    expect(hits.length).toBeGreaterThanOrEqual(6);
  });

  it('echo/printf 占位 ≤ 12 行（防 echo 假 PASS）', () => {
    const src = fs.readFileSync(SMOKE, 'utf-8');
    const re = /^[\s]*(?:echo|printf)[\s]+["']?(?:Step|✅|PASS)/gm;
    const hits = src.match(re) || [];
    expect(hits.length).toBeLessThanOrEqual(12);
  });

  it('6 个 step 标记齐全（Step 1 ... Step 6）', () => {
    const src = fs.readFileSync(SMOKE, 'utf-8');
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const re = new RegExp(`Step\\s*${n}\\b`);
      expect(src).toMatch(re);
    }
  });

  it('REAL_PUBLISH 环境变量分支存在', () => {
    const src = fs.readFileSync(SMOKE, 'utf-8');
    expect(src).toMatch(/REAL_PUBLISH/);
  });

  it('set -euo pipefail（严格 bash）', () => {
    const src = fs.readFileSync(SMOKE, 'utf-8');
    expect(src).toMatch(/set\s+-euo\s+pipefail/);
  });
});
