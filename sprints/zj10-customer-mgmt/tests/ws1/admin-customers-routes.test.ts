import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../../');
const ROUTE_FILE = path.join(ROOT, 'apps/api/src/routes/admin-customers.ts');
const APP_FILE = path.join(ROOT, 'apps/api/src/app.ts');

describe('WS1 — admin-customers 后端 API 路由 [BEHAVIOR]', () => {
  it('路由文件 apps/api/src/routes/admin-customers.ts 存在', () => {
    expect(() => fs.accessSync(ROUTE_FILE)).not.toThrow();
  });

  it('路由文件导出 adminCustomersRouter', () => {
    const content = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(content).toContain('adminCustomersRouter');
  });

  it('路由文件包含 3 个端点路径（customers + platform-sessions + publish-logs）', () => {
    const content = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(content).toContain('platform-sessions');
    expect(content).toContain('publish-logs');
  });

  it('响应 schema 包含 PRD 必填字段（customers 端点）', () => {
    const content = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(content).toContain('tenant_id');
    expect(content).toContain('email');
    expect(content).toContain('license_status');
    expect(content).toContain('platform_count');
    expect(content).toContain('last_publish_at');
  });

  it('响应 schema 包含 PRD 必填字段（platform-sessions 端点）', () => {
    const content = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(content).toContain('session_id');
    expect(content).toContain('expires_at');
  });

  it('响应 schema 包含 PRD 必填字段（publish-logs 端点）', () => {
    const content = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(content).toContain('log_id');
    expect(content).toContain('work_id');
    expect(content).toContain('created_at');
  });

  it('不含禁用字段名（users/clients/members/result 作为 response key）', () => {
    const content = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(content).not.toMatch(/"users"\s*:/);
    expect(content).not.toMatch(/"clients"\s*:/);
    expect(content).not.toMatch(/"members"\s*:/);
    // result 只允许作为变量名，不允许作为 response key
    expect(content).not.toMatch(/data:\s*result/);
  });

  it('不含禁用 status 值（valid/ok/inactive）', () => {
    const content = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(content).not.toContain("'valid'");
    expect(content).not.toContain("'inactive'");
  });

  it('使用 superAdminGuard 中间件（非超管返回 403）', () => {
    const content = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(content).toContain('superAdminGuard');
  });

  it('不使用禁用 query 参数名（user/client/id/t）', () => {
    const content = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(content).not.toContain('req.query.user');
    expect(content).not.toContain('req.query.client ');
    expect(content).not.toMatch(/req\.query\.id\b/);
    expect(content).not.toMatch(/req\.query\.t\b/);
  });

  it('app.ts 已引入并注册 adminCustomersRouter 到 /api/admin/customers', () => {
    const content = fs.readFileSync(APP_FILE, 'utf8');
    expect(content).toContain('adminCustomersRouter');
    expect(content).toContain('admin/customers');
  });
});
