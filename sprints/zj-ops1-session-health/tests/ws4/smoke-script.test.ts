import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

const workflowPath = '.github/workflows/session-health-check.yml';
const smokePath = '.github/workflows/scripts/smoke/session-health-smoke.sh';
const e2eWindowsPath = '.github/workflows/e2e-windows.yml';

describe('WS4 — CI workflow 更新 + smoke 脚本 + e2e-windows.yml [BEHAVIOR]', () => {
  it('session-health-check.yml 应包含 KUAISHOU_MAIN Secret 引用', () => {
    const wf = readFileSync(workflowPath, 'utf-8');
    expect(wf).toContain('KUAISHOU_MAIN');
  });

  it('session-health-check.yml 应包含所有新增平台 Secret 引用', () => {
    const wf = readFileSync(workflowPath, 'utf-8');
    const required = [
      'KUAISHOU_MAIN', 'XIAOHONGSHU_MAIN', 'SHIPINHAO_MAIN',
      'TOUTIAO_MAIN', 'WEIBO_MAIN', 'ZHIHU_MAIN', 'WECHAT_MAIN',
    ];
    const missing = required.filter(k => !wf.includes(k));
    expect(missing).toHaveLength(0);
  });

  it('session-health-check.yml 应包含 FEISHU_BOT_WEBHOOK Secret 引用', () => {
    const wf = readFileSync(workflowPath, 'utf-8');
    expect(wf).toContain('FEISHU_BOT_WEBHOOK');
  });

  it('session-health-smoke.sh 文件应存在', () => {
    expect(existsSync(smokePath)).toBe(true);
  });

  it('session-health-smoke.sh 应包含 ≥5 行实质内容（不是 exit 0 占位）', () => {
    const smoke = readFileSync(smokePath, 'utf-8');
    const substantialLines = smoke
      .split('\n')
      .filter(line => line.trim() && !line.trim().startsWith('#'));
    expect(substantialLines.length).toBeGreaterThanOrEqual(5);
  });

  it('session-health-smoke.sh 应包含 exit 1 失败退出路径（防假绿）', () => {
    const smoke = readFileSync(smokePath, 'utf-8');
    expect(smoke).toContain('exit 1');
  });

  it('e2e-windows.yml 文件应存在', () => {
    expect(existsSync(e2eWindowsPath)).toBe(true);
  });

  it('e2e-windows.yml 应配置 windows-latest runner', () => {
    const wf = readFileSync(e2eWindowsPath, 'utf-8');
    expect(wf).toContain('windows-latest');
  });

  it('e2e-windows.yml 应包含 workflow_dispatch 触发器', () => {
    const wf = readFileSync(e2eWindowsPath, 'utf-8');
    expect(wf).toContain('workflow_dispatch');
  });
});
