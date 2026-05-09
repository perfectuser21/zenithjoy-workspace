/**
 * WS5 — Path 1 隔离 + smoke 脚本 + DEV helper 端点门禁
 *
 * commit-1 RED；commit-2 GREEN。
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');

function gitDiffNames(file: string): string {
  try {
    return execSync(`git diff --name-only origin/main...HEAD -- ${file}`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

describe('Workstream 5 — Path 1 隔离 + smoke 脚本 [BEHAVIOR]', () => {
  it('本 sprint 不修改 services/agent/src/handlers/qr-bind-douyin.ts', () => {
    const changed = gitDiffNames('services/agent/src/handlers/qr-bind-douyin.ts');
    expect(changed, '不允许改 Path 1 抖音扫码 handler').toBe('');
  });

  it('本 sprint 不修改 apps/api/src/services/feishu-bitable.ts（单租户原版保留）', () => {
    const changed = gitDiffNames('apps/api/src/services/feishu-bitable.ts');
    expect(changed, '不允许改单租户飞书 Bitable 服务').toBe('');
  });

  it('本 sprint 不修改 apps/dashboard/src/pages/DouyinBindPage.tsx', () => {
    const changed = gitDiffNames('apps/dashboard/src/pages/DouyinBindPage.tsx');
    expect(changed).toBe('');
  });

  it('本 sprint 不动 agent_platform_sessions schema', () => {
    let diff = '';
    try {
      diff = execSync("git diff origin/main...HEAD -- 'apps/api/db/migrations/*.sql'", {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
    } catch {}
    expect(diff.includes('agent_platform_sessions'), 'sprint 不应触碰 agent_platform_sessions').toBe(
      false
    );
  });

  it('golden-path-2-smoke.sh 存在 + 可执行', () => {
    const smokePath = path.join(
      REPO_ROOT,
      '.github/workflows/scripts/smoke/golden-path-2-smoke.sh'
    );
    expect(fs.existsSync(smokePath)).toBe(true);
    const stat = fs.statSync(smokePath);
    expect(stat.mode & 0o111, 'smoke 脚本应可执行').toBeGreaterThan(0);
  });

  it('smoke 脚本所有 SELECT count 含时间窗口（防造假）', () => {
    const smokePath = path.join(
      REPO_ROOT,
      '.github/workflows/scripts/smoke/golden-path-2-smoke.sh'
    );
    const c = fs.readFileSync(smokePath, 'utf8');
    const counts = (c.match(/SELECT\s+count/gi) || []).length;
    const windowed = (c.match(/NOW\(\)\s*-\s*interval/gi) || []).length;
    if (counts > 0) {
      expect(
        windowed,
        `${counts} 个 SELECT count 但只有 ${windowed} 个时间窗口约束`
      ).toBeGreaterThanOrEqual(counts);
    }
  });

  it('DEV helper _smoke-feishu-seed.ts 存在 + 含 NODE_ENV + X-Smoke-Token 双门禁', () => {
    const helperPath = path.join(
      REPO_ROOT,
      'apps/api/src/routes/_smoke-feishu-seed.ts'
    );
    expect(fs.existsSync(helperPath)).toBe(true);
    const c = fs.readFileSync(helperPath, 'utf8');
    expect(c).toMatch(/NODE_ENV/);
    expect(c).toMatch(/production/);
    expect(c).toMatch(/X-Smoke-Token/i);
  });

  it('Lead 自验证据 .agent-knowledge/path-2/lead-acceptance-sprint-a.md 存在 + 1KB+ + PASS', () => {
    const evidencePath = path.join(
      REPO_ROOT,
      '.agent-knowledge/path-2/lead-acceptance-sprint-a.md'
    );
    expect(fs.existsSync(evidencePath), 'Lead 自验证据缺失').toBe(true);
    const stat = fs.statSync(evidencePath);
    expect(stat.size, '证据文件 < 1KB 视为造假').toBeGreaterThan(1024);
    const c = fs.readFileSync(evidencePath, 'utf8');
    expect(c).toMatch(/lead_acceptance_status:\s*PASS/);
    const stepCount = (c.match(/^### Step [1-9]/gm) || []).length;
    expect(stepCount, '应有 5+ 步').toBeGreaterThanOrEqual(5);
  });
});
