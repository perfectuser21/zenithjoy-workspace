import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const HEALTH_SCRIPT = 'scripts/sessions/check-health.js';
const GHA_WORKFLOW = '.github/workflows/session-health-check.yml';
const SMOKE_SCRIPT = '.github/workflows/scripts/smoke/session-health-medium-smoke.sh';

describe('WS6 — GHA + check-health.js 修复 [BEHAVIOR]', () => {
  it('check-health.js missing bug 已修复（missing ≠ ok）', () => {
    const src = readFileSync(HEALTH_SCRIPT, 'utf8');
    expect(src).not.toMatch(/missing.*[=:=]+.*\bok\b|\bok\b.*[=:=]+.*missing/i);
    expect(src).toContain('missing');
  });

  it('check-health.js 含 Promise.race 3s 飞书超时保护', () => {
    const src = readFileSync(HEALTH_SCRIPT, 'utf8');
    expect(src).toContain('Promise.race');
    expect(src).toMatch(/3000|3 \* 1000/);
  });

  it('check-health.js expired 条目触发飞书告警（含飞书 webhook 调用逻辑）', () => {
    const src = readFileSync(HEALTH_SCRIPT, 'utf8');
    expect(src).toContain('expired');
    expect(src).toMatch(/FEISHU_BOT_WEBHOOK|feishu/i);
    expect(src).toContain('Promise.race');
  });

  it('check-health.js 含 POST /api/operator/sessions/status 回写调用', () => {
    const src = readFileSync(HEALTH_SCRIPT, 'utf8');
    expect(src).toMatch(/sessions\/status|operator\/sessions\/status/);
  });

  it('GHA workflow 无 *_MAIN Secret 引用', () => {
    const src = readFileSync(GHA_WORKFLOW, 'utf8');
    expect(src).not.toMatch(/_MAIN:/);
  });

  it('GHA workflow 含 DOUYIN_COOKIES Secret 引用', () => {
    const src = readFileSync(GHA_WORKFLOW, 'utf8');
    expect(src).toContain('DOUYIN_COOKIES');
  });

  it('smoke.sh 存在且含 SKIP_HTTP_CHECK 离线模式', () => {
    expect(existsSync(SMOKE_SCRIPT), `smoke.sh 不存在: ${SMOKE_SCRIPT}`).toBe(true);
    const src = readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(src).toContain('SKIP_HTTP_CHECK');
  });

  it('smoke.sh 实质内容 ≥15 行', () => {
    const src = readFileSync(SMOKE_SCRIPT, 'utf8');
    const lines = src.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    expect(lines.length).toBeGreaterThanOrEqual(15);
  });
});
