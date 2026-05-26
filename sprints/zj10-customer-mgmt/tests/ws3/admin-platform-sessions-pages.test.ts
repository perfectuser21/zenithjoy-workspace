import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../../');
const SESSIONS_PAGE = path.join(ROOT, 'apps/dashboard/src/pages/AdminPlatformSessionsPage.tsx');
const LOGS_PAGE = path.join(ROOT, 'apps/dashboard/src/pages/AdminPublishLogsPage.tsx');
const NAV_FILE = path.join(ROOT, 'apps/dashboard/src/config/navigation.config.ts');

describe('WS3 — AdminPlatformSessionsPage + AdminPublishLogsPage [BEHAVIOR]', () => {
  it('AdminPlatformSessionsPage.tsx 文件已创建', () => {
    expect(() => fs.accessSync(SESSIONS_PAGE)).not.toThrow();
  });

  it('AdminPlatformSessionsPage.tsx 调用 platform-sessions 端点', () => {
    const content = fs.readFileSync(SESSIONS_PAGE, 'utf8');
    expect(content).toContain('platform-sessions');
  });

  it('AdminPlatformSessionsPage.tsx 包含 PRD 必填字段（session_id/expires_at）', () => {
    const content = fs.readFileSync(SESSIONS_PAGE, 'utf8');
    expect(content).toContain('session_id');
    expect(content).toContain('expires_at');
  });

  it('AdminPlatformSessionsPage.tsx 含 data-testid="platform-sessions-table-row"', () => {
    const content = fs.readFileSync(SESSIONS_PAGE, 'utf8');
    expect(content).toContain('data-testid="platform-sessions-table-row"');
  });

  it('AdminPlatformSessionsPage.tsx 含 data-testid="session-status"（status 值只显示 active/expired）', () => {
    const content = fs.readFileSync(SESSIONS_PAGE, 'utf8');
    expect(content).toContain('data-testid="session-status"');
    // 不含禁用 status 值
    expect(content).not.toContain("'valid'");
    expect(content).not.toContain("'inactive'");
  });

  it('AdminPublishLogsPage.tsx 文件已创建', () => {
    expect(() => fs.accessSync(LOGS_PAGE)).not.toThrow();
  });

  it('AdminPublishLogsPage.tsx 调用 publish-logs 端点', () => {
    const content = fs.readFileSync(LOGS_PAGE, 'utf8');
    expect(content).toContain('publish-logs');
  });

  it('AdminPublishLogsPage.tsx 包含 PRD 必填字段（log_id/work_id/created_at）', () => {
    const content = fs.readFileSync(LOGS_PAGE, 'utf8');
    expect(content).toContain('log_id');
    expect(content).toContain('work_id');
    expect(content).toContain('created_at');
  });

  it('AdminPublishLogsPage.tsx 通过 tenant_id query param 筛选，不使用禁用 query 名', () => {
    const content = fs.readFileSync(LOGS_PAGE, 'utf8');
    expect(content).toContain('tenant_id');
    expect(content).not.toMatch(/[?&]user=/);
    expect(content).not.toMatch(/[?&]client=/);
  });

  it('AdminPublishLogsPage.tsx 使用 searchParams 读取 URL 中的 tenant_id', () => {
    const content = fs.readFileSync(LOGS_PAGE, 'utf8');
    const hasSearchParams =
      content.includes('useSearchParams') ||
      content.includes('URLSearchParams') ||
      content.includes('searchParams') ||
      content.includes('location.search');
    expect(hasSearchParams).toBe(true);
  });

  it('AdminPublishLogsPage.tsx 含 data-testid="publish-logs-table-row"', () => {
    const content = fs.readFileSync(LOGS_PAGE, 'utf8');
    expect(content).toContain('data-testid="publish-logs-table-row"');
  });

  it('pageComponents 已新增两个页面懒加载映射', () => {
    const content = fs.readFileSync(NAV_FILE, 'utf8');
    expect(content).toContain('AdminPlatformSessionsPage');
    expect(content).toContain('AdminPublishLogsPage');
  });
});
