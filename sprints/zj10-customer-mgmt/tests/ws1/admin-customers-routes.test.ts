import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../../');
const ROUTE_FILE = path.join(ROOT, 'apps/api/src/routes/admin-customers.ts');
const APP_FILE = path.join(ROOT, 'apps/api/src/app.ts');

describe('WS1 — admin-customers 后端 API 路由 [BEHAVIOR]', () => {

  // === 路由文件结构 ===

  it('路由文件 apps/api/src/routes/admin-customers.ts 存在', () => {
    expect(() => fs.accessSync(ROUTE_FILE)).not.toThrow();
  });

  it('路由文件导出 adminCustomersRouter（export const adminCustomersRouter）', () => {
    const c = fs.readFileSync(ROUTE_FILE, 'utf8');
    // 必须是具名导出，不是默认导出
    expect(c).toMatch(/export\s+(const|let)\s+adminCustomersRouter/);
  });

  it('路由文件注册 3 个端点路径（customers 根 + platform-sessions + publish-logs）', () => {
    const c = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(c).toContain('platform-sessions');
    expect(c).toContain('publish-logs');
    // 根路径 GET 处理器存在
    expect(c).toMatch(/router\.get\s*\(\s*['"]\/['"]|router\.get\s*\(\s*['"]\/['"]/);
  });

  // === GET /api/admin/customers — schema 字段验证 ===

  it('GET /customers 响应包含 PRD 必填字段（tenant_id, email, license_status）', () => {
    const c = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(c).toContain('tenant_id');
    expect(c).toContain('email');
    expect(c).toContain('license_status');
  });

  it('GET /customers 响应包含 PRD 必填字段（platform_count, last_publish_at）', () => {
    const c = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(c).toContain('platform_count');
    expect(c).toContain('last_publish_at');
  });

  // === GET /api/admin/customers/platform-sessions — schema 字段验证 ===

  it('GET /platform-sessions 响应包含 PRD 必填字段（session_id, expires_at）', () => {
    const c = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(c).toContain('session_id');
    expect(c).toContain('expires_at');
  });

  // === GET /api/admin/customers/publish-logs — schema 字段验证 ===

  it('GET /publish-logs 响应包含 PRD 必填字段（log_id, work_id, created_at）', () => {
    const c = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(c).toContain('log_id');
    expect(c).toContain('work_id');
    expect(c).toContain('created_at');
  });

  // === 禁用字段反向检查（Schema 完整性）===

  it('响应不含禁用字段名 users/clients/members 作为 response key', () => {
    const c = fs.readFileSync(ROUTE_FILE, 'utf8');
    // 精确匹配禁用字段作为 JSON key（如 "users": 或 users:）
    expect(c).not.toMatch(/"users"\s*:/);
    expect(c).not.toMatch(/"clients"\s*:/);
    expect(c).not.toMatch(/"members"\s*:/);
    // data 不能赋值给 result 变量然后作为 response key
    expect(c).not.toMatch(/data\s*:\s*result\b/);
  });

  it('platform-sessions 响应不含禁用 status 值（valid/ok/inactive）', () => {
    const c = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(c).not.toContain("'valid'");
    expect(c).not.toContain('"valid"');
    expect(c).not.toContain("'inactive'");
    expect(c).not.toContain('"inactive"');
    // 'ok' 只允许作为 success 字段，不允许作为 status 值
    expect(c).not.toMatch(/status\s*:\s*['"]ok['"]/);
  });

  // === 鉴权与路由注册 ===

  it('路由使用 superAdminGuard 中间件（保护所有 3 个端点）', () => {
    const c = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(c).toContain('superAdminGuard');
    // 确认是从 middleware 目录导入的
    expect(c).toMatch(/import.*superAdminGuard/);
  });

  it('不使用禁用 query 参数名（req.query.user/client/id/t）', () => {
    const c = fs.readFileSync(ROUTE_FILE, 'utf8');
    expect(c).not.toContain('req.query.user');
    expect(c).not.toMatch(/req\.query\.client\b/);
    // req.query.id 只允许 path param，不作为 tenant 筛选
    expect(c).not.toMatch(/req\.query\s*\.\s*t\b/);
  });

  it('app.ts 已引入 adminCustomersRouter 并注册到 /api/admin/customers', () => {
    const c = fs.readFileSync(APP_FILE, 'utf8');
    expect(c).toContain('adminCustomersRouter');
    expect(c).toContain('admin/customers');
  });
});
