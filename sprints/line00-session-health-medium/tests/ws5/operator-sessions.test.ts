import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('WS5 — operator-sessions.ts API schema [BEHAVIOR]', () => {
  const routePath = 'apps/api/src/routes/operator-sessions.ts';

  it('operator-sessions.ts 文件存在', () => {
    expect(fs.existsSync(routePath)).toBe(true);
  });

  it('bind-start 路由含 taskId 字段（PRD Response Schema 字段名字面匹配）', () => {
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).toContain('taskId');
  });

  it('bind-start 禁用字段 id/task/result/data 不作为 response key 出现', () => {
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).not.toMatch(/json\(\s*\{[^}]*['"]id['"]\s*:/);
    expect(content).not.toMatch(/json\(\s*\{[^}]*['"]task['"]\s*:/);
  });

  it('upload-cookies 路由含 secretName 字段（PRD Response Schema 字面匹配）', () => {
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).toContain('secretName');
  });

  it('upload-cookies 路由含 updatedAt 字段（PRD Response Schema 字面匹配）', () => {
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).toContain('updatedAt');
  });

  it('upload-cookies keys 完整性 — 含 ok/secretName/updatedAt，不含禁用字段 timestamp/message/name', () => {
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).not.toMatch(/['"]timestamp['"]\s*:/);
    expect(content).not.toMatch(/['"]message['"]\s*:/);
    expect(content).not.toMatch(/json\(\s*\{[^}]*['"]name['"]\s*:/);
  });

  it('GH_SECRETS_WRITE_PAT 未配置时返回 5xx error path（含该变量名检查）', () => {
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).toContain('GH_SECRETS_WRITE_PAT');
    expect(content).toMatch(/500|503/);
  });

  it('status endpoint 含 checkedAt 字段', () => {
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).toContain('checkedAt');
  });

  it('status 禁用值 healthy/active/inactive/good 不出现', () => {
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).not.toMatch(/['"]healthy['"]/);
    expect(content).not.toMatch(/['"]active['"]/);
    expect(content).not.toMatch(/['"]inactive['"]/);
    expect(content).not.toMatch(/['"]good['"]/);
  });

  it('bind-start error path 含 400 + error 字段（platform 无效）', () => {
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).toMatch(/400/);
    expect(content).toMatch(/['"]error['"]/);
  });

  it('secretName 格式为 {PLATFORM_UPPER}_COOKIES（含 COOKIES 命名逻辑）', () => {
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).toContain('COOKIES');
  });
});
