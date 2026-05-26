import { describe, it, expect } from 'vitest';
import { readFileSync, accessSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname_compat = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname_compat, '../../../../');

describe('WS4 — CI session-health-check.yml 扩展 + smoke 脚本 [BEHAVIOR]', () => {
  const ymlPath = resolve(ROOT, '.github/workflows/session-health-check.yml');
  const smokePath = resolve(ROOT, '.github/workflows/scripts/smoke/session-health-smoke.sh');
  const e2ePath = resolve(ROOT, 'sprints/zj-ops1-session-health/e2e-verify.ps1');
  const getYmlContent = () => readFileSync(ymlPath, 'utf8');

  it('session-health-check.yml 使用新命名 DOUYIN_MAIN（替代旧 DOUYIN_COOKIES）', () => {
    const content = getYmlContent();
    expect(content).toContain('DOUYIN_MAIN');
  });

  it('yml 含 ≥35 个 ${{ secrets.XXX }} 引用（32 平台账号 + 3 API key）', () => {
    const content = getYmlContent();
    const matches = content.match(/\$\{\{\s*secrets\./g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(35);
  });

  it('yml 含 FEISHU_BOT_WEBHOOK（飞书双渠道告警专用）', () => {
    const content = getYmlContent();
    expect(content).toContain('FEISHU_BOT_WEBHOOK');
  });

  it('yml 含视频号 Secret SHIPINHAO_MAIN（验证 8 平台全覆盖）', () => {
    const content = getYmlContent();
    expect(content).toContain('SHIPINHAO_MAIN');
  });

  it('session-health-smoke.sh 文件存在', () => {
    expect(() => accessSync(smokePath)).not.toThrow();
  });

  it('smoke 脚本包含实质内容（≥5 行，非 exit 0 占位）', () => {
    const content = readFileSync(smokePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(content.trim()).not.toBe('exit 0');
  });

  it('smoke 脚本使用 SKIP_HTTP_CHECK（离线 CI 模式）', () => {
    const content = readFileSync(smokePath, 'utf8');
    expect(content).toContain('SKIP_HTTP_CHECK');
  });

  it('e2e-verify.ps1 文件存在', () => {
    expect(() => accessSync(e2ePath)).not.toThrow();
  });

  it('e2e-verify.ps1 包含 Playwright 调用并指向 /operator', () => {
    const content = readFileSync(e2ePath, 'utf8');
    expect(content).toMatch(/playwright|Playwright/i);
    expect(content).toMatch(/operator/i);
  });
});
