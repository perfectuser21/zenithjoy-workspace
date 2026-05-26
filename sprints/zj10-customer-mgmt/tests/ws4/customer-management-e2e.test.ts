import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../../');
const E2E_FILE = path.join(ROOT, 'apps/dashboard/e2e/customer-management.spec.ts');

describe('WS4 — customer-management E2E spec 文件完整性 [BEHAVIOR]', () => {
  it('E2E spec 文件 apps/dashboard/e2e/customer-management.spec.ts 已创建', () => {
    expect(() => fs.accessSync(E2E_FILE)).not.toThrow();
  });

  it('spec 文件包含 ≥ 4 个 test 覆盖 Golden Path', () => {
    const content = fs.readFileSync(E2E_FILE, 'utf8');
    const testCount = (content.match(/\btest\(/g) || []).length;
    expect(testCount).toBeGreaterThanOrEqual(4);
  });

  it('spec 文件使用 page.route() stub（不依赖真实后端，适合 windows_cloud）', () => {
    const content = fs.readFileSync(E2E_FILE, 'utf8');
    expect(content).toContain('page.route');
  });

  it('spec 文件包含 /admin/customers 概览页 test，含 customers-table-row 断言', () => {
    const content = fs.readFileSync(E2E_FILE, 'utf8');
    expect(content).toContain('/admin/customers');
    expect(content).toContain('customers-table-row');
  });

  it('spec 文件包含 /admin/customers/platform-sessions test，含 session-status 和 active/expired 断言', () => {
    const content = fs.readFileSync(E2E_FILE, 'utf8');
    expect(content).toContain('platform-sessions');
    expect(content).toContain('session-status');
    expect(content).toContain('active');
    expect(content).toContain('expired');
  });

  it('spec 文件包含 /admin/customers/publish-logs test，使用 tenant_id（不用禁用名）', () => {
    const content = fs.readFileSync(E2E_FILE, 'utf8');
    expect(content).toContain('publish-logs');
    expect(content).toContain('tenant_id');
    // 不使用禁用 query 名
    expect(content).not.toContain('tenant_id=undefined');
    expect(content).not.toMatch(/[?&]user=/);
    expect(content).not.toMatch(/[?&]client=/);
  });

  it('spec 文件包含 403 error path test', () => {
    const content = fs.readFileSync(E2E_FILE, 'utf8');
    expect(content).toContain('403');
  });

  it('spec 文件在关键步骤前后调用 page.screenshot()（≥ 8 次）', () => {
    const content = fs.readFileSync(E2E_FILE, 'utf8');
    const screenshotCount = (content.match(/page\.screenshot\(/g) || []).length;
    expect(screenshotCount).toBeGreaterThanOrEqual(8);
  });

  it('spec 文件 stub 中使用 PRD 字段名（success/data/total，非禁用名）', () => {
    const content = fs.readFileSync(E2E_FILE, 'utf8');
    expect(content).toContain('success: true');
    expect(content).toContain('"data"');
    // 不含禁用顶层 key
    expect(content).not.toMatch(/"users"\s*:/);
    expect(content).not.toMatch(/"clients"\s*:/);
    expect(content).not.toMatch(/"members"\s*:/);
  });
});
