import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.resolve('packages/db/migrations');

describe('crm_wechat_mapping 迁移 — TDD Red Phase [BEHAVIOR]', () => {
  it('migrations 目录下存在 crm_wechat_mapping 迁移文件', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR);
    const migFile = files.find((f) => f.includes('crm_wechat_mapping'));
    expect(migFile).toBeDefined();
  });

  it('迁移文件含 wechat_contact_id 字段', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR);
    const migFile = files.find((f) => f.includes('crm_wechat_mapping'))!;
    const c = fs.readFileSync(path.join(MIGRATIONS_DIR, migFile), 'utf8');
    expect(c).toContain('wechat_contact_id');
  });

  it('迁移文件含 crm_row_id 字段', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR);
    const migFile = files.find((f) => f.includes('crm_wechat_mapping'))!;
    const c = fs.readFileSync(path.join(MIGRATIONS_DIR, migFile), 'utf8');
    expect(c).toContain('crm_row_id');
  });

  it('迁移文件含 platform 字段', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR);
    const migFile = files.find((f) => f.includes('crm_wechat_mapping'))!;
    const c = fs.readFileSync(path.join(MIGRATIONS_DIR, migFile), 'utf8');
    expect(c).toContain('platform');
  });

  it('迁移文件含 tenant_id 字段', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR);
    const migFile = files.find((f) => f.includes('crm_wechat_mapping'))!;
    const c = fs.readFileSync(path.join(MIGRATIONS_DIR, migFile), 'utf8');
    expect(c).toContain('tenant_id');
  });

  // R2 新增：Risk 4 contact_lost 需要 contact_status 字段支撑
  it('迁移文件含 contact_status 字段（支持 contact_lost 标记，不硬删除）', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR);
    const migFile = files.find((f) => f.includes('crm_wechat_mapping'))!;
    const c = fs.readFileSync(path.join(MIGRATIONS_DIR, migFile), 'utf8');
    expect(c).toContain('contact_status');
  });
});
