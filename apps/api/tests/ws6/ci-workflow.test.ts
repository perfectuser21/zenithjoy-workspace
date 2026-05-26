/**
 * Path 4 Sprint 1 ws6 — CI workflow + test-registry + lint 防作弊（合同 RED）。
 *
 * 校验：
 *   1) .github/workflows/golden-path-4-smoke.yml 存在
 *   2) workflow 含 needs:[ws1, ws2, ws3, ws4, ws5]（依赖 enforce）
 *   3) test-registry.yaml 含 tests/ws1/ ... tests/ws6/
 *   4) lint-feature-has-smoke.yml 含 path-4 / golden-path-4 / wechat-rpa 关键字（防作弊 2）
 *   5) ws-level smoke scripts 齐：path4-sprint-1-ws1/2/3/4/5/6-smoke.sh
 *
 * 注：tests/ws6/** 在 vitest.config.ts 里被 exclude，不进 CI vitest 集。
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const WORKFLOW = path.join(
  REPO_ROOT,
  '.github',
  'workflows',
  'golden-path-4-smoke.yml'
);
const REGISTRY = path.join(REPO_ROOT, 'test-registry.yaml');
const LINT_FEATURE_HAS_SMOKE_YML = path.join(
  REPO_ROOT,
  '.github',
  'workflows',
  'lint-feature-has-smoke.yml'
);

describe('ws6 golden-path-4-smoke.yml — CI workflow', () => {
  it('文件存在', () => {
    expect(fs.existsSync(WORKFLOW)).toBe(true);
  });

  it('含 needs:[ws1, ws2, ws3, ws4, ws5] 依赖 enforce', () => {
    const src = fs.readFileSync(WORKFLOW, 'utf-8');
    // YAML 数组形式 [ws1, ws2, ws3, ws4, ws5] 或 多行 - ws1\n  - ws2 ...
    const inlineForm =
      /needs:\s*\[\s*ws1\s*,\s*ws2\s*,\s*ws3\s*,\s*ws4\s*,\s*ws5\s*\]/;
    const blockForm =
      /needs:[\s\S]{0,200}-\s*ws1[\s\S]{0,80}-\s*ws2[\s\S]{0,80}-\s*ws3[\s\S]{0,80}-\s*ws4[\s\S]{0,80}-\s*ws5/;
    expect(inlineForm.test(src) || blockForm.test(src)).toBe(true);
  });

  it('含 jobs ws1..ws5（每个 ws 跑独立 smoke）', () => {
    const src = fs.readFileSync(WORKFLOW, 'utf-8');
    for (const ws of ['ws1', 'ws2', 'ws3', 'ws4', 'ws5']) {
      const re = new RegExp(`^\\s{2}${ws}:`, 'm');
      expect(src).toMatch(re);
    }
  });

  it('最终 job 跑完整 golden-path-4-smoke.sh', () => {
    const src = fs.readFileSync(WORKFLOW, 'utf-8');
    expect(src).toMatch(/golden-path-4-smoke\.sh/);
  });
});

describe('ws6 test-registry.yaml — ws1..ws6 注册', () => {
  it('含 tests/ws1/..tests/ws6/', () => {
    const src = fs.readFileSync(REGISTRY, 'utf-8');
    for (const ws of ['ws1', 'ws2', 'ws3', 'ws4', 'ws5', 'ws6']) {
      const re = new RegExp(`tests/${ws}/`);
      expect(src).toMatch(re);
    }
  });
});

describe('ws6 lint-feature-has-smoke.yml — Path 4 关键字注册', () => {
  it('文件存在', () => {
    expect(fs.existsSync(LINT_FEATURE_HAS_SMOKE_YML)).toBe(true);
  });

  it('含 golden-path-4 / path-4 / wechat-rpa 任一关键字', () => {
    const src = fs.readFileSync(LINT_FEATURE_HAS_SMOKE_YML, 'utf-8');
    expect(src).toMatch(/golden-path-4|path-4|wechat-rpa/);
  });
});

describe('ws6 ws-level smoke scripts — 6 个全在', () => {
  it.each(['ws1', 'ws2', 'ws3', 'ws4', 'ws5', 'ws6'])(
    '%s smoke 脚本存在',
    (ws) => {
      const p = path.join(
        REPO_ROOT,
        '.github',
        'workflows',
        'scripts',
        'smoke',
        `path4-sprint-1-${ws}-smoke.sh`
      );
      expect(fs.existsSync(p)).toBe(true);
    }
  );
});
