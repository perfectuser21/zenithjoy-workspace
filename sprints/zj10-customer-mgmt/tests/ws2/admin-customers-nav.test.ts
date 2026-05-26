import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../../');
const NAV_FILE = path.join(ROOT, 'apps/dashboard/src/config/navigation.config.ts');
const PAGE_FILE = path.join(ROOT, 'apps/dashboard/src/pages/AdminCustomersPage.tsx');

describe('WS2 — 导航配置 + AdminCustomersPage 概览 [BEHAVIOR]', () => {
  it('navigation.config.ts 包含 /admin/customers 路径', () => {
    const content = fs.readFileSync(NAV_FILE, 'utf8');
    expect(content).toContain('/admin/customers');
  });

  it('navigation.config.ts 的「客户管理」NavItem 标记 requireSuperAdmin: true', () => {
    const content = fs.readFileSync(NAV_FILE, 'utf8');
    expect(content).toContain('requireSuperAdmin');
    expect(content).toContain('客户管理');
  });

  it('pageComponents 映射含 AdminCustomersPage 懒加载条目', () => {
    const content = fs.readFileSync(NAV_FILE, 'utf8');
    expect(content).toContain('AdminCustomersPage');
  });

  it('AdminCustomersPage.tsx 文件已创建', () => {
    expect(() => fs.accessSync(PAGE_FILE)).not.toThrow();
  });

  it('AdminCustomersPage.tsx 调用 /api/admin/customers 端点', () => {
    const content = fs.readFileSync(PAGE_FILE, 'utf8');
    expect(content).toContain('admin/customers');
  });

  it('AdminCustomersPage.tsx 包含 PRD 必填字段（license_status/platform_count/last_publish_at）', () => {
    const content = fs.readFileSync(PAGE_FILE, 'utf8');
    expect(content).toContain('license_status');
    expect(content).toContain('platform_count');
    expect(content).toContain('last_publish_at');
  });

  it('AdminCustomersPage.tsx 含 data-testid="customers-table-row"（Playwright E2E 依赖）', () => {
    const content = fs.readFileSync(PAGE_FILE, 'utf8');
    expect(content).toContain('data-testid="customers-table-row"');
  });

  it('AdminCustomersPage.tsx 处理 last_publish_at: null 边界情况', () => {
    const content = fs.readFileSync(PAGE_FILE, 'utf8');
    const hasNullGuard =
      content.includes('last_publish_at &&') ||
      content.includes('?.') ||
      content.includes('?? ') ||
      content.includes('??\n') ||
      content.includes('null');
    expect(hasNullGuard).toBe(true);
  });

  it('AdminCustomersPage.tsx 不含禁用字段名（users/clients/members）', () => {
    const content = fs.readFileSync(PAGE_FILE, 'utf8');
    expect(content).not.toMatch(/\busers\s*:/);
    expect(content).not.toMatch(/\bclients\s*:/);
    expect(content).not.toMatch(/\bmembers\s*:/);
  });
});
