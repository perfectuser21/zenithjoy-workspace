import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PAGES = path.resolve(__dirname, '..');

describe('line02 页面不再硬编码占位 tenant [BEHAVIOR]', () => {
  it('DouyinBurnerBindPage 不含 tenant_id=current（已物理删除则直接通过）', () => {
    const filePath = path.join(PAGES, 'DouyinBurnerBindPage.tsx');
    if (!fs.existsSync(filePath)) return;
    const src = fs.readFileSync(filePath, 'utf8');
    expect(src).not.toMatch(/tenant_id=current/);
  });
  it('LeadsPage 不再向请求 body 塞硬编码 TENANT_ID', () => {
    const src = fs.readFileSync(path.join(PAGES, 'LeadsPage.tsx'), 'utf8');
    expect(src).not.toMatch(/tenant_id:\s*TENANT_ID/);
    expect(src).not.toMatch(/const\s+TENANT_ID\s*=\s*['"]e2e-acq-tenant['"]/);
  });
});
